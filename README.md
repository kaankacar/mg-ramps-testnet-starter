# MoneyGram Ramps — Testnet Starter (Stellar)

A minimal, **runnable** starter that walks through a full MoneyGram Ramps
**on-ramp (deposit)** and **off-ramp (withdraw)** on Stellar **testnet**, using USDC.
Built so a hackathon builder can go from zero to a working sandbox transaction in a couple of minutes.

**🔗 Live browser demo (no backend):** https://kaankacar.github.io/mg-ramps-testnet-starter/ — runs the entire flow client-side (no install, no backend, no allowlisting). Uses the permissive `extmgxanchor` sandbox.

> There are **two** MoneyGram testnet sandboxes, and this repo supports both — see [Two sandboxes](#two-sandboxes-and-two-apps) below. The `extstellar` ("legacy", production-faithful) one **requires `client_domain`**, so it ships with a tiny co-sign backend (`src/proxy.ts`, deployable to Vercel).

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
- ⚠️ **Withdraw is self-demonstrable on testnet; deposit is not.** In a **withdraw**
  (USDC → cash) *your wallet* sends the USDC on-chain, so you see the whole thing
  settle (verified: a 10 USDC payment to MoneyGram's withdraw account). In a
  **deposit** (cash → USDC) *MoneyGram* sends the USDC, but only **after cash is
  paid** at a store — and the sandbox has ~12 fixed test locations (none in the
  Philippines) with completion simulated by MoneyGram's onboarding team. So a
  deposit will sit at "go pay cash" and never credit on its own. This is expected,
  not a bug; on mainnet the same deposit completes for real once cash is paid.

## Two sandboxes (and two apps)

MoneyGram runs two distinct testnet sandboxes. Same testnet USDC issuer, both send `CORS: *`, but they differ in one decisive way:

| | `extmgxanchor` (newer) | `extstellar` (legacy, production-faithful) |
|---|---|---|
| Path | `/stellarsepservice` | `/stellaradapterservice` (same as mainnet) |
| SEP-10 `client_domain` | **not required** — any friendbot account authenticates | **required** — rejects with `client_domain is required` |
| Backend needed? | **No** — pure client-side | **Yes** — a server must co-sign the challenge |
| App in this repo | `docs/index.html` (GitHub Pages) | `docs/legacy.html` (+ `src/proxy.ts` / Vercel function) |
| Min amounts | deposit/withdraw 15 | deposit/withdraw 1 |

The legacy sandbox mirrors production (`stellar.moneygram.com/stellaradapterservice`), so it's the better **rehearsal** for a real integration — but it needs the `client_domain` handshake, which is why it ships with a backend.

### Running the legacy app locally

```bash
cp .env.example .env       # set CLIENT_DOMAIN_SIGNING_SECRET=S... (the secret of your
                           # stellar.toml's SIGNING_KEY); CLIENT_DOMAIN=your.domain
npm run proxy              # serves docs/ + co-signs at /api/sep10/challenge
# open http://localhost:8765/legacy.html
```

The proxy does exactly **one** privileged thing: fetch MoneyGram's SEP-10 challenge with your `client_domain` and co-sign it with your signing key. The secret stays server-side (gitignored `.env`); the browser only adds the user's own account signature and then talks to MoneyGram directly.

### Deploying the legacy app (Vercel)

`docs/` is served statically and `api/sep10/challenge.js` becomes the co-sign function — same `/api/sep10/challenge` path as the local proxy, so the frontend is unchanged.

```bash
npm i -g vercel            # or use: npx vercel
vercel login
vercel env add CLIENT_DOMAIN_SIGNING_SECRET production   # paste the signing secret
vercel --prod
```

Set `CLIENT_DOMAIN` (and optionally `MG_HOME` / `MG_AUTH`) as env vars too if you're not using the defaults. **Never commit the secret** — it lives only in Vercel's env. The deployed URL's `/` serves the legacy wallet.

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
