// CLI entry point.  Usage:
//   npm run deposit    (on-ramp: cash -> USDC)
//   npm run withdraw   (off-ramp: USDC -> cash)
//   npm run auth       (just print a SEP-10 JWT)

import { Keypair } from "@stellar/stellar-sdk";
import {
  TESTNET,
  ensureFundedWithUsdcTrustline,
  authenticate,
  startInteractive,
  getTransaction,
  sendWithdrawalPayment,
} from "./moneygram.ts";

// Load .env if present (Node 20.12+). Defaults work fine without it.
try {
  process.loadEnvFile();
} catch {
  /* no .env — using defaults */
}

const command = (process.argv[2] ?? "deposit") as "deposit" | "withdraw" | "auth";
const amount = process.argv[3]; // optional, e.g. `npm run deposit 20`
const pollLimit = Number(process.env.POLL_LIMIT ?? 120);

// User account: reuse STELLAR_SECRET from .env, or generate a throwaway testnet one.
let kp: Keypair;
if (process.env.STELLAR_SECRET) {
  kp = Keypair.fromSecret(process.env.STELLAR_SECRET);
} else {
  kp = Keypair.random();
  console.log("No STELLAR_SECRET set — generated a throwaway TESTNET account:");
  console.log(`  PUBLIC: ${kp.publicKey()}`);
  console.log(`  SECRET: ${kp.secret()}   (testnet only — add to .env to reuse)\n`);
}

console.log("MoneyGram Ramps — TESTNET sandbox");
console.log(`Anchor: ${TESTNET.anchorHomeDomain}\n`);

await ensureFundedWithUsdcTrustline(kp);
console.log("✓ account funded + USDC trustline ready");

const token = await authenticate(kp);
console.log("✓ SEP-10 authenticated");

if (command === "auth") {
  console.log(`\nJWT:\n${token}`);
  process.exit(0);
}

const { url, id } = await startInteractive(command, token, kp.publicKey(), amount);
console.log(`✓ SEP-24 ${command} started — transaction ${id}\n`);
console.log("👉 Open this URL in a browser to complete the (simulated) flow:");
console.log(`   ${url}\n`);

console.log(`Polling status every 5s (up to ${pollLimit}x)…`);
const TERMINAL = new Set(["completed", "refunded", "expired", "error", "no_market", "too_small", "too_large"]);

for (let i = 0; i < pollLimit; i++) {
  await new Promise((r) => setTimeout(r, 5000));
  const tx = await getTransaction(token, id);
  console.log(`  status: ${tx.status}${tx.message ? ` — ${tx.message}` : ""}`);

  // Off-ramp: when the anchor is waiting for the user's funds, send the USDC.
  if (command === "withdraw" && tx.status === "pending_user_transfer_start") {
    console.log("  anchor ready — submitting on-chain USDC payment…");
    const hash = await sendWithdrawalPayment(kp, tx);
    console.log(`  ✓ payment submitted: ${hash}`);
  }

  if (TERMINAL.has(tx.status)) {
    console.log(`\nDone. Final status: ${tx.status}`);
    process.exit(0);
  }
}

console.log("\nStopped polling (POLL_LIMIT reached). Re-run the command or open the URL to continue.");
