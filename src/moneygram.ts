// Minimal MoneyGram Ramps client for Stellar TESTNET (sandbox).
// Implements just the two SEPs you need: SEP-10 (auth) + SEP-24 (deposit/withdraw).
// All endpoints/values below were verified live against MoneyGram's sandbox.

import {
  Keypair,
  TransactionBuilder,
  Networks,
  Operation,
  Asset,
  Memo,
  BASE_FEE,
  Horizon,
} from "@stellar/stellar-sdk";

export const TESTNET = {
  horizonUrl: "https://horizon-testnet.stellar.org",
  friendbotUrl: "https://friendbot.stellar.org",
  networkPassphrase: Networks.TESTNET,

  // MoneyGram sandbox (from https://extmgxanchor.moneygram.com/.well-known/stellar.toml)
  anchorHomeDomain: "extmgxanchor.moneygram.com",
  webAuthEndpoint: "https://extmgxanchor.moneygram.com/stellarsepservice/auth",
  sep24: "https://extmgxanchor.moneygram.com/stellarsepservice/sep24",

  // Asset is always USDC. Local currency (PHP, etc.) only exists at the
  // physical MoneyGram cash point in production — on testnet it is simulated.
  usdc: new Asset("USDC", "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5"),
};

const horizon = new Horizon.Server(TESTNET.horizonUrl);

/** Create+fund the account (friendbot) if needed, and ensure a USDC trustline exists. */
export async function ensureFundedWithUsdcTrustline(kp: Keypair): Promise<void> {
  let account;
  try {
    account = await horizon.loadAccount(kp.publicKey());
  } catch {
    const res = await fetch(`${TESTNET.friendbotUrl}/?addr=${kp.publicKey()}`);
    if (!res.ok) throw new Error(`friendbot funding failed: HTTP ${res.status}`);
    account = await horizon.loadAccount(kp.publicKey());
  }

  const hasTrustline = account.balances.some(
    (b) => "asset_code" in b && b.asset_code === "USDC" && b.asset_issuer === TESTNET.usdc.getIssuer(),
  );
  if (hasTrustline) return;

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: TESTNET.networkPassphrase,
  })
    .addOperation(Operation.changeTrust({ asset: TESTNET.usdc }))
    .setTimeout(60)
    .build();
  tx.sign(kp);
  await horizon.submitTransaction(tx);
}

/** SEP-10: fetch the challenge, sign it, exchange it for a JWT. */
export async function authenticate(kp: Keypair): Promise<string> {
  const challengeUrl = `${TESTNET.webAuthEndpoint}?account=${kp.publicKey()}&home_domain=${TESTNET.anchorHomeDomain}`;
  const challenge = (await (await fetch(challengeUrl)).json()) as {
    transaction: string;
    network_passphrase: string;
  };

  const tx = TransactionBuilder.fromXDR(challenge.transaction, challenge.network_passphrase);
  tx.sign(kp);

  const res = await fetch(TESTNET.webAuthEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transaction: tx.toXDR() }),
  });
  const body = (await res.json()) as { token?: string };
  if (!body.token) throw new Error(`SEP-10 failed (HTTP ${res.status}): ${JSON.stringify(body)}`);
  return body.token;
}

export interface InteractiveResponse {
  type: string;
  url: string;
  id: string;
}

/** SEP-24: start an interactive deposit ("on-ramp": cash -> USDC) or withdraw ("off-ramp": USDC -> cash). */
export async function startInteractive(
  kind: "deposit" | "withdraw",
  token: string,
  account: string,
  amount?: string,
): Promise<InteractiveResponse> {
  const body: Record<string, string> = { asset_code: "USDC", account };
  if (amount) body.amount = amount;

  const res = await fetch(`${TESTNET.sep24}/transactions/${kind}/interactive`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as Partial<InteractiveResponse> & { error?: string };
  if (!res.ok || !data.url || !data.id) {
    throw new Error(`SEP-24 ${kind} failed (HTTP ${res.status}): ${JSON.stringify(data)}`);
  }
  return data as InteractiveResponse;
}

export interface Sep24Transaction {
  id: string;
  status: string;
  amount_in?: string;
  amount_out?: string;
  withdraw_anchor_account?: string;
  withdraw_memo?: string;
  withdraw_memo_type?: string;
  message?: string;
  more_info_url?: string;
  [key: string]: unknown;
}

/** SEP-24: poll a single transaction's current state. */
export async function getTransaction(token: string, id: string): Promise<Sep24Transaction> {
  const res = await fetch(`${TESTNET.sep24}/transaction?id=${id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = (await res.json()) as { transaction?: Sep24Transaction };
  if (!data.transaction) throw new Error(`getTransaction failed (HTTP ${res.status}): ${JSON.stringify(data)}`);
  return data.transaction;
}

/** For withdrawals: once the anchor is ready, send it the USDC it asked for. */
export async function sendWithdrawalPayment(kp: Keypair, tx: Sep24Transaction): Promise<string> {
  if (!tx.withdraw_anchor_account || !tx.amount_in) {
    throw new Error("transaction not ready for payment (missing withdraw_anchor_account / amount_in)");
  }
  const account = await horizon.loadAccount(kp.publicKey());

  let memo: Memo | undefined;
  if (tx.withdraw_memo && tx.withdraw_memo_type) {
    if (tx.withdraw_memo_type === "hash") memo = Memo.hash(Buffer.from(tx.withdraw_memo, "base64"));
    else if (tx.withdraw_memo_type === "id") memo = Memo.id(tx.withdraw_memo);
    else memo = Memo.text(tx.withdraw_memo);
  }

  const builder = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: TESTNET.networkPassphrase,
  })
    .addOperation(
      Operation.payment({
        destination: tx.withdraw_anchor_account,
        asset: TESTNET.usdc,
        amount: tx.amount_in,
      }),
    )
    .setTimeout(120);
  if (memo) builder.addMemo(memo);

  const payment = builder.build();
  payment.sign(kp);
  const result = await horizon.submitTransaction(payment);
  return result.hash;
}
