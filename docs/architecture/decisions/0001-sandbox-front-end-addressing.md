# 0001 — Sandbox front-end addressing: path-based PR routing, not per-PR subdomains

- **Status:** Superseded by [0033](0033-sandbox-previews-on-per-pr-subdomains.md)
- **Date:** 2026-06-14
- **Area:** sandbox deploy topology · web/mobile serving · Clerk session-token auth
- **Related:** service-side Clerk session-token verification (PR #39), `.github/workflows/sandbox-deploy.yml`, `packages/services/identity/src/auth/clerkAuth.service.ts`

⚠️ **This is the historical record of a decision that was reversed.** It is kept because it explains why the
`basePath` machinery exists and what the path-routed posture was, which is still the rollback shape. What it
DECIDED is no longer in force: previews are addressed by per-PR subdomain, and the reasoning that overturned
this one — including the measurements — is in [ADR-0033](0033-sandbox-previews-on-per-pr-subdomains.md).
Read that one for anything current.

## Context

- The **sandbox identity service is a single shared, persistent environment**. Every per-PR front-end
  authenticates against it.
- All sandbox front-ends authenticate against **one shared Clerk dev instance** (`pk_test`).
- The identity service verifies the Clerk session token itself and enforces the token's **`azp`** claim.
- It was inferred that per-PR subdomains would each mint an unbounded `azp` a shared allowlist could not
  enumerate. ⚠️ That inference is what ADR-0033 overturned; `azp` enforcement is our own code, and it
  validates against an anchored pattern rather than a list.
- Re-routing the identity service changes nothing here — `azp` keys on the **web app's** origin, not the
  API's address.

## Decision

1. **Serve all sandbox web previews from one stable origin** — `sandbox.commise.app` — selecting the PR by
   **URL path** (`sandbox.commise.app/pr-{N}`), so every preview shares one `azp`.
2. **Manifest query params select static resources** (proposed sub-mechanism, never built): because previews
   share one origin, the app resolves which PR's bundle to load from a parameter rather than the host.
3. **Mobile is exempt by nature.** `@clerk/expo` tokens have no browser Origin, so `azp` is typically absent
   and Clerk skips the check when it is.

## Consequences

**Positive**

- `azp` enforcement remains enabled in sandbox without an unbounded allowlist.
- One sandbox web origin means one TLS cert path, one Clerk allowed-origin, and simpler CORS.

**Negative / costs**

- No per-PR-isolated front-end URL. Previews share an origin, so they share ClerkJS browser and session
  state per origin — running several PRs' UIs truly in parallel is not possible.
- The app must carry PR context in the path and route on it, which is more app-side routing logic than
  host-based selection would need.

## Alternatives considered

- **Per-PR subdomains with prod-only `azp` enforcement** — rejected here for giving up defence-in-depth
  parity on sandbox. ADR-0033 takes the subdomains WITHOUT giving that up, which is what made it viable.
- **Wildcard or pattern `azp`** — recorded here as "not possible, Clerk matches by exact string". That is
  true of the SDK and false of our own enforcement, and it is the specific error ADR-0033 corrects.
