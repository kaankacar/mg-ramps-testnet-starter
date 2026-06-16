// Side-by-side test of MoneyGram's two testnet sandboxes:
//   - extmgxanchor.moneygram.com  (/stellarsepservice)   <- the one our demo uses
//   - extstellar.moneygram.com    (/stellaradapterservice) <- the one in the friend's guide
// Runs SEP-10 auth, fetches SEP-24 /info, and starts withdraw + deposit interactive,
// all against a fresh friendbot-funded account with NO client_domain.

import {
  Keypair,
  TransactionBuilder,
  Networks,
  Operation,
  Asset,
  BASE_FEE,
  Horizon,
} from "@stellar/stellar-sdk";

const USDC = new Asset("USDC", "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5");
const horizon = new Horizon.Server("https://horizon-testnet.stellar.org");

interface Env {
  label: string;
  homeDomain: string;
  webAuth: string;
  sep24: string;
}

const ENVS: Env[] = [
  {
    label: "extmgxanchor (/stellarsepservice) — ours",
    homeDomain: "extmgxanchor.moneygram.com",
    webAuth: "https://extmgxanchor.moneygram.com/stellarsepservice/auth",
    sep24: "https://extmgxanchor.moneygram.com/stellarsepservice/sep24",
  },
  {
    label: "extstellar (/stellaradapterservice) — friend's guide",
    homeDomain: "extstellar.moneygram.com",
    webAuth: "https://extstellar.moneygram.com/stellaradapterservice/auth",
    sep24: "https://extstellar.moneygram.com/stellaradapterservice/sep24",
  },
];

async function ensureFunded(kp: Keypair) {
  let account;
  try {
    account = await horizon.loadAccount(kp.publicKey());
  } catch {
    const res = await fetch(`https://friendbot.stellar.org/?addr=${kp.publicKey()}`);
    if (!res.ok) throw new Error(`friendbot failed: HTTP ${res.status}`);
    account = await horizon.loadAccount(kp.publicKey());
  }
  const hasTl = account.balances.some(
    (b: any) => b.asset_code === "USDC" && b.asset_issuer === USDC.getIssuer(),
  );
  if (!hasTl) {
    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(Operation.changeTrust({ asset: USDC }))
      .setTimeout(60)
      .build();
    tx.sign(kp);
    await horizon.submitTransaction(tx);
  }
}

async function authenticate(env: Env, kp: Keypair): Promise<string> {
  const url = `${env.webAuth}?account=${kp.publicKey()}&home_domain=${env.homeDomain}`;
  const challenge = (await (await fetch(url)).json()) as any;
  if (!challenge.transaction) throw new Error(`no challenge: ${JSON.stringify(challenge)}`);
  const tx = TransactionBuilder.fromXDR(challenge.transaction, challenge.network_passphrase);
  tx.sign(kp);
  const res = await fetch(env.webAuth, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transaction: tx.toXDR() }),
  });
  const body = (await res.json()) as any;
  if (!body.token) throw new Error(`SEP-10 fail HTTP ${res.status}: ${JSON.stringify(body)}`);
  return body.token;
}

async function startInteractive(
  env: Env,
  kind: "deposit" | "withdraw",
  token: string,
  account: string,
): Promise<any> {
  const res = await fetch(`${env.sep24}/transactions/${kind}/interactive`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ asset_code: "USDC", account, amount: "100" }),
  });
  return { http: res.status, data: await res.json() };
}

async function run(env: Env) {
  console.log("\n========================================================");
  console.log(env.label);
  console.log("========================================================");

  // /info first (public, no auth)
  try {
    const info = await (await fetch(`${env.sep24}/info`)).json();
    console.log("SEP-24 /info withdraw.USDC:", JSON.stringify((info as any)?.withdraw?.USDC));
    console.log("SEP-24 /info deposit.USDC :", JSON.stringify((info as any)?.deposit?.USDC));
  } catch (e: any) {
    console.log("/info ERROR:", e.message);
  }

  const kp = Keypair.random();
  console.log("fresh account:", kp.publicKey());
  try {
    await ensureFunded(kp);
    console.log("funded + USDC trustline: OK");
  } catch (e: any) {
    console.log("funding ERROR:", e.message);
    return;
  }

  let token: string;
  try {
    token = await authenticate(env, kp);
    console.log("SEP-10 JWT: OK (len", token.length, ")");
  } catch (e: any) {
    console.log("SEP-10 ERROR:", e.message);
    return;
  }

  for (const kind of ["withdraw", "deposit"] as const) {
    try {
      const r = await startInteractive(env, kind, token, kp.publicKey());
      console.log(`${kind} interactive: HTTP ${r.http} id=${r.data?.id} url=${r.data?.url}`);
    } catch (e: any) {
      console.log(`${kind} ERROR:`, e.message);
    }
  }
}

for (const env of ENVS) {
  await run(env);
}
