// Vercel serverless function — the one privileged step of the LEGACY MoneyGram
// flow (extstellar.moneygram.com), which requires SEP-10 client_domain.
//
// It fetches the SEP-10 challenge from MoneyGram with our client_domain and
// co-signs it with the client_domain signing key. That secret lives ONLY in this
// function's environment (Vercel env var CLIENT_DOMAIN_SIGNING_SECRET) and never
// reaches the browser. Everything else (account signing, the JWT exchange, all
// SEP-24 calls) happens client-side, directly against MoneyGram (CORS: *).
//
// Mirrors src/proxy.ts (the local `npm run proxy`) so docs/legacy.html works the
// same whether it's talking to the local proxy or this deployed function.
//
// Route: GET /api/sep10/challenge?account=G...

import { Keypair, TransactionBuilder, StrKey } from "@stellar/stellar-sdk";

const CLIENT_DOMAIN = process.env.CLIENT_DOMAIN || "kaankacar.github.io";
const MG_HOME = process.env.MG_HOME || "extstellar.moneygram.com";
const MG_AUTH = process.env.MG_AUTH || "https://extstellar.moneygram.com/stellaradapterservice/auth";

export default async function handler(req, res) {
  // Allow cross-origin use too (e.g. a frontend hosted elsewhere). Testnet only.
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();

  const secret = process.env.CLIENT_DOMAIN_SIGNING_SECRET;
  if (!secret) return res.status(500).json({ error: "server misconfigured: missing CLIENT_DOMAIN_SIGNING_SECRET" });

  const account = (req.query?.account || "").toString();
  if (!StrKey.isValidEd25519PublicKey(account)) return res.status(400).json({ error: "invalid account" });

  try {
    const chalUrl = `${MG_AUTH}?account=${account}&home_domain=${MG_HOME}&client_domain=${CLIENT_DOMAIN}`;
    const chal = await (await fetch(chalUrl)).json();
    if (!chal.transaction || !chal.network_passphrase) {
      return res.status(502).json({ error: "challenge fetch failed", detail: chal });
    }

    const tx = TransactionBuilder.fromXDR(chal.transaction, chal.network_passphrase);
    tx.sign(Keypair.fromSecret(secret)); // co-sign with the allowlisted client_domain key
    return res.status(200).json({ transaction: tx.toXDR(), network_passphrase: chal.network_passphrase });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
