// End-to-end test of the LEGACY flow THROUGH the local proxy:
//   fresh account -> proxy co-signs challenge -> account signs -> MoneyGram JWT -> interactive URL
// Proves the backend-proxy client_domain path actually issues a token (the part we
// couldn't verify before without the signing secret).

import { Keypair, TransactionBuilder, Networks, Operation, Asset, BASE_FEE, Horizon } from "@stellar/stellar-sdk";

const PROXY = "http://localhost:8765";
const MG_AUTH = "https://extstellar.moneygram.com/stellaradapterservice/auth";
const SEP24 = "https://extstellar.moneygram.com/stellaradapterservice/sep24";
const USDC = new Asset("USDC", "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5");
const horizon = new Horizon.Server("https://horizon-testnet.stellar.org");

const kp = Keypair.random();
console.log("fresh account:", kp.publicKey());

// fund + trustline
await fetch(`https://friendbot.stellar.org/?addr=${kp.publicKey()}`);
let acct = await horizon.loadAccount(kp.publicKey());
const tl = new TransactionBuilder(acct, { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
  .addOperation(Operation.changeTrust({ asset: USDC })).setTimeout(60).build();
tl.sign(kp);
await horizon.submitTransaction(tl);
console.log("funded + USDC trustline: OK");

// 1) proxy co-signs the challenge with the client_domain key
const chal = await (await fetch(`${PROXY}/api/sep10/challenge?account=${kp.publicKey()}`)).json();
if (!chal.transaction) throw new Error("proxy challenge failed: " + JSON.stringify(chal));
console.log("proxy returned co-signed challenge: OK");

// 2) account adds its signature, 3) exchange for JWT directly at MoneyGram
const tx = TransactionBuilder.fromXDR(chal.transaction, chal.network_passphrase);
tx.sign(kp);
const authRes = await fetch(MG_AUTH, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ transaction: tx.toXDR() }),
});
const authBody = await authRes.json();
if (!authBody.token) throw new Error(`SEP-10 JWT failed (HTTP ${authRes.status}): ${JSON.stringify(authBody)}`);
console.log("SEP-10 JWT via legacy + client_domain: OK (len", authBody.token.length, ")");

// 4) start interactive withdraw + deposit
for (const kind of ["withdraw", "deposit"] as const) {
  const r = await fetch(`${SEP24}/transactions/${kind}/interactive`, {
    method: "POST",
    headers: { Authorization: `Bearer ${authBody.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ asset_code: "USDC", account: kp.publicKey(), amount: "100" }),
  });
  const d = await r.json();
  console.log(`${kind} interactive: HTTP ${r.status} id=${d.id} url=${(d.url || "").slice(0, 64)}…`);
}
