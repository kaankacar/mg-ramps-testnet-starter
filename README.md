# MoneyGram Ramps — Testnet Starter (Stellar)

A minimal, **runnable** starter that walks through a full MoneyGram Ramps
**on-ramp (deposit)** and **off-ramp (withdraw)** on Stellar **testnet**, using USDC.
Built so a hackathon builder can go from zero to a working sandbox transaction in a couple of minutes.

**🔗 Live browser demo:** https://kaankacar.github.io/mg-ramps-testnet-starter/ — runs the entire flow client-side (no install, no backend, no allowlisting).

## TL;DR — what this proves

- ✅ **You can integrate MoneyGram on testnet with ZERO allowlisting.** Any
  friendbot-funded account can authenticate (SEP-10) and start a deposit/withdraw
  (SEP-24) against MoneyGram's sandbox. The "allowlist your domain" form +
  `client_domain` + a hosted `stellar.toml` are **production** concerns — not
  required for testnet. (Verified live against the sandbox.)
- ✅ **The on-chain asset is always USDC.** There is no "PHP token." Local
  currency (Philippine Peso, etc.) only shows up at the **physical MoneyGram cash
  point** in production. On testnet the entire cash leg is **simulated** — no real
  money, no real KYC. So a PH hackathon project demonstrates the *mechanism*; real
  pesos only move on mainnet at a real MoneyGram location.

## Requirements

- Node **20.12+** (uses native `.env` loading and runs TypeScript via `tsx`). Tested on Node 24.

## Quickstart

```bash
npm install

npm run deposit     # on-ramp:  cash -> USDC
npm run withdraw    # off-ramp: USDC -> cash
npm run auth        # just print a SEP-10 JWT

# optional: pass an amount (MoneyGram limits: deposit 15–950, withdraw 15–2500)
npm run deposit 20
```

Each command:

1. generates (or reuses) a testnet account, funds it via **friendbot**, adds a **USDC trustline**
2. authenticates with MoneyGram via **SEP-10**
3. starts a **SEP-24** transaction and prints an **interactive URL**
4. polls the transaction status — and for `withdraw`, **auto-submits the on-chain USDC payment** once the anchor is ready

Open the printed `https://extramps.moneygram.com…` URL in a browser to complete the
simulated KYC + cash step. To reuse one account between runs:

```bash
cp .env.example .env   # then set STELLAR_SECRET=S...
```

## The flow

```
  your app                         MoneyGram sandbox (testnet)
  ────────                         ───────────────────────────
  friendbot fund + USDC trustline
  SEP-10  GET /auth?account=G...  ─────────►  challenge (XDR)
          sign with user key
          POST /auth  {transaction} ───────►  JWT
  SEP-24  POST /transactions/deposit/interactive (Bearer JWT)
                                   ─────────►  { url, id }
          open url in browser  ────────────►  simulated KYC + cash UI
          poll  GET /transaction?id=...  ──►  status: ... -> completed
  (withdraw only) when status = pending_user_transfer_start:
          send USDC payment to withdraw_anchor_account (+memo)
```

## Testnet endpoints (verified live)

| | Value |
|---|---|
| Anchor home domain | `extmgxanchor.moneygram.com` |
| SEP-10 auth | `https://extmgxanchor.moneygram.com/stellarsepservice/auth` |
| SEP-24 | `https://extmgxanchor.moneygram.com/stellarsepservice/sep24` |
| Asset | `USDC` / `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5` (Circle testnet USDC) |
| Limits | deposit 15–950, withdraw 15–2500 USDC |
| Network | `Test SDF Network ; September 2015` |

## Going to production (mainnet)

When the builder is ready for real money:

1. Point the anchor at **`stellar.moneygram.com`** (mainnet — different SIGNING_KEY/endpoints).
2. Get **allowlisted** by MoneyGram: host a `stellar.toml` with a `SIGNING_KEY` and
   pass `client_domain` in SEP-10 so MoneyGram can attribute requests to your wallet.
   (Example we set up: `https://kaankacar.github.io/.well-known/stellar.toml`.)
3. Production access also requires a **commercial/compliance agreement** with MoneyGram —
   it is not self-serve like the sandbox.

## References

- Official MVP wallet (full reference): https://github.com/stellar/moneygram-access-wallet-mvp
- Integration guide: https://developers.stellar.org/docs/build/apps/moneygram-access-integration-guide
- SEP-10 (auth): https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0010.md
- SEP-24 (deposit/withdraw): https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0024.md
