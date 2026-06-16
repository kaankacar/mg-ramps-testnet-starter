// Tiny backend proxy for the LEGACY MoneyGram sandbox (extstellar.moneygram.com),
// which requires SEP-10 client_domain. The ONLY thing that must stay server-side is
// the client_domain signing secret — so this proxy does exactly one privileged thing:
// fetch the SEP-10 challenge from MoneyGram with our client_domain and co-sign it.
//
// Everything else (the user signing with their own account key, exchanging the
// challenge for a JWT, and all SEP-24 calls) happens in the browser, directly
// against MoneyGram (their endpoints send CORS: *).
//
// The signing secret is read from .env (gitignored) and never reaches the browser.
//
//   npm run proxy   ->   http://localhost:8765/legacy.html

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { extname, normalize, join } from "node:path";
import { Keypair, TransactionBuilder, StrKey } from "@stellar/stellar-sdk";

// Load .env (Node >=20.12). Safe to call even if the file is missing.
try { process.loadEnvFile(); } catch { /* env may be provided by the shell */ }

const PORT = Number(process.env.PORT || 8765);
const CLIENT_DOMAIN = process.env.CLIENT_DOMAIN || "kaankacar.github.io";
const MG_HOME = process.env.MG_HOME || "extstellar.moneygram.com";
const MG_AUTH = process.env.MG_AUTH || "https://extstellar.moneygram.com/stellaradapterservice/auth";
const SECRET = process.env.CLIENT_DOMAIN_SIGNING_SECRET;

if (!SECRET) {
  console.error("Missing CLIENT_DOMAIN_SIGNING_SECRET in .env — cannot co-sign. Aborting.");
  process.exit(1);
}
const signer = Keypair.fromSecret(SECRET);

const DOCS = fileURLToPath(new URL("../docs/", import.meta.url));
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

function json(res: import("node:http").ServerResponse, code: number, body: unknown) {
  const s = JSON.stringify(body);
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(s) });
  res.end(s);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://localhost:${PORT}`);

  // --- the one privileged endpoint: co-sign a SEP-10 challenge ---
  if (url.pathname === "/api/sep10/challenge") {
    try {
      const account = url.searchParams.get("account") || "";
      if (!StrKey.isValidEd25519PublicKey(account)) return json(res, 400, { error: "invalid account" });

      const chalUrl = `${MG_AUTH}?account=${account}&home_domain=${MG_HOME}&client_domain=${CLIENT_DOMAIN}`;
      const upstream = await fetch(chalUrl);
      const chal = (await upstream.json()) as { transaction?: string; network_passphrase?: string; error?: string };
      if (!chal.transaction || !chal.network_passphrase) {
        return json(res, 502, { error: "challenge fetch failed", detail: chal });
      }

      const tx = TransactionBuilder.fromXDR(chal.transaction, chal.network_passphrase);
      tx.sign(signer); // co-sign with the allowlisted client_domain key
      return json(res, 200, { transaction: tx.toXDR(), network_passphrase: chal.network_passphrase });
    } catch (e) {
      return json(res, 500, { error: (e as Error).message });
    }
  }

  // --- static file serving from docs/ ---
  let pathname = url.pathname === "/" ? "/legacy.html" : url.pathname;
  const filePath = normalize(join(DOCS, pathname));
  if (!filePath.startsWith(DOCS)) return json(res, 403, { error: "forbidden" }); // path traversal guard
  try {
    const data = await readFile(filePath);
    res.writeHead(200, { "Content-Type": MIME[extname(filePath)] || "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
  }
});

server.listen(PORT, () => {
  console.log(`Legacy proxy running:  http://localhost:${PORT}/legacy.html`);
  console.log(`  client_domain : ${CLIENT_DOMAIN}`);
  console.log(`  signing key   : ${signer.publicKey()}`);
  console.log(`  upstream auth : ${MG_AUTH}`);
});
