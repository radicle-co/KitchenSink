---
date: 2026-07-10
topic: sandbox-subdomain-azp-spike
---

# Sandbox per-PR subdomains — Option B′ feasibility spike

## Summary

Prove, end-to-end on one throwaway subdomain, that sandbox previews can move to per-PR subdomains without weakening `azp` enforcement: sign in on a per-PR-style host, confirm Clerk mints a usable `azp`, and have a backend accept it through our own anchored-regex `azp` check (pass for a genuine token, reject for a spoofed one). The self-owned check lands in the shared `@kitchensink/clerk-verify` verifier so **every** consumer (identity, food-service, recipe-service) inherits it, not recipe-service alone. Settle the mobile-`azp` question in the same sitting. The output is a go/no-go on migrating sandbox previews to subdomains.

## Update (2026-07-12) — partial result: preliminary GO

Two of the three unknowns are now settled without a full live sign-in:

- **U1/U2 (the keeper) shipped** — the self-owned anchored-regex `azp` predicate is built, unit-tested, and wired stage-gated into all three services (prod stays exact-match). This is what makes bounded per-PR patterns enforceable without an unbounded allowlist.
- **FAPI CORS confirmed live** — the sandbox dev Frontend API (`nice-fowl-6.clerk.accounts.dev`) reflects **any** `Origin` in `Access-Control-Allow-Origin` (including `pr-9001.sandbox.commise.app`), with credentials. So a subdomain sign-in is accepted and mints `azp = that subdomain` — and no "allowed subdomains" toggle is needed (that's prod-only; dev isn't origin-restricted). The regex-`azp` guard is therefore essential, not optional, on the dev sandbox.

**Preliminary recommendation: GO.** Remaining to fully confirm: one real browser sign-in on a live `pr-N.sandbox.commise.app` to decode the token and see `azp` = the subdomain literally (near-certain), and the mobile-`azp` decode (needs a real `@clerk/expo` token). See `docs/architecture/decisions/0001-sandbox-front-end-addressing.md` (Update 2026-07-12) and the migration plan.

## Problem Frame

Sandbox previews are served from one origin (`sandbox.commise.app`) with the PR in the URL path, because `azp` (the token's authorized-party claim) binds to the browser origin and Clerk's SDK matches it by exact string — per-PR subdomains would each mint a different, unbounded `azp` the shared allowlist can't enumerate, so every preview would 401. That reasoning is recorded in `docs/architecture/decisions/0001-sandbox-front-end-addressing.md`.

The reframe: the exact-match is _our_ code, not a Clerk constraint. `verifyClerkToken` passes `authorizedParties` to `@clerk/backend`'s `verifyToken`; if we instead validate the signature-verified `azp` ourselves against an anchored pattern scoped to our own preview domain, per-PR subdomains become viable with `azp` enforcement still on — no unbounded allowlist, no wildcard handed to Clerk. Because the check lives in the shared verifier, the capability is repo-wide by construction.

That rests on two facts this spike verifies: Clerk's shared dev instance actually mints a token from a per-PR subdomain (gated by its FAPI wildcard-subdomain CORS), and the resulting `azp` is the subdomain origin. A latent question rides along — the verifier only skips the `azp` check when the allowlist is unset, but our services require it non-empty, so if `@clerk/expo` tokens omit `azp` they already 401 against the enforcing services. The same predicate work is where that gets settled.

## Requirements

**Predicate (the keeper — repo-wide)**

- R1. `@kitchensink/clerk-verify` gains a self-owned `azp` predicate: when a pattern is configured it validates the verified `azp` against an anchored, dot-escaped, ReDoS-safe pattern scoped to the controlled preview domain, instead of delegating exact-match to Clerk. Every consumer (identity, food-service, recipe-service) inherits it.
- R2. The predicate accepts a genuine token whose `azp` matches and rejects (opaque failure → 401) one whose `azp` does not, including adversarial near-misses.
- R3. The existing exact-match list mode is unchanged when no pattern is configured (prod parity).
- R4. Absent `azp` is admitted only against a **positive** signal that identifies a genuine native token (a Clerk client-type/claim), never by mere `azp`-absence — so the check cannot be bypassed by any client able to obtain an `azp`-less token.

**Spike environment**

- R5. One fixed throwaway subdomain serves the sandbox web app over HTTPS; not per-PR CI provisioning.
- R6. Clerk's wildcard-subdomain (FAPI CORS) allowance is enabled on the shared sandbox dev instance, its exact granted scope recorded, and reversible.

**Verification**

- R7. After sign-in on the subdomain, the minted token's decoded `azp` equals the subdomain's `https://` origin.
- R8. A backend running predicate mode accepts the real subdomain token, and the browser session persists across at least one authenticated navigation on the subdomain (not a token decode alone).
- R9. A second, never-individually-registered subdomain also mints an accepted token — proving the allowance is genuinely wildcard, not a per-origin registration.
- R10. A real `@clerk/expo` token is decoded to determine whether it carries `azp`; the native-admission rule (R4) is set from that finding and the prod implication recorded.
- R11. The spike concludes with an explicit go/no-go, and ADR-0001 is corrected where the spike disproves it.

## Scope Boundaries

**Deferred to Follow-Up Work (only if the spike returns "go")**

- The migration itself: per-PR subdomain provisioning in CI, replacing the CloudFront + KeyValueStore host-swap router, wildcard DNS automation, and retiring path routing.
- Removing the web app's `basePath` machinery.

**Outside this spike**

- Any prod change; prod retains exact-match, single-origin `azp` enforcement.
- The Lambda@Edge `Origin`-canonicalization / Clerk Proxy route (blocked on dev instances) and per-PR satellite domains.

## Dependencies / Assumptions

- The shared sandbox Clerk **dev** instance is the mint authority; enabling wildcard-subdomain CORS on it affects all previews. Reversible.
- The `*.commise.app` wildcard cert already covers the spike subdomains; a DNS record for each fixed scratch host is the only new addressing.
- **Assumption to verify (this is the spike):** the dev-instance FAPI accepts the subdomain origins with wildcard-subdomain enabled, and stamps `azp` as the origin.
- **Naming:** the shared verifier file is `clerkVerify.ts` (camelCase) per `docs/CODING_STANDARDS.md §1` — the shared/frontend regime, not the NestJS kebab regime. Do not "rename" it to kebab.

## Outstanding Questions

**Deferred to planning**

- How to stand up the fixed scratch subdomains (static DNS → the running sandbox app vs. a minimal ephemeral deploy).
- Whether U4's live-proof backend runs locally (networkless verify) or against a deployed service.

## Sources / Research

- `docs/architecture/decisions/0001-sandbox-front-end-addressing.md` — the path-routing decision this spike tests; its "wildcard/pattern `azp` — not possible" line is corrected on a "go".
- `packages/shared/clerk-verify/src/clerkVerify.ts` — where `authorizedParties` is passed to `verifyToken` and `azp` is surfaced (the seam the predicate changes).
- Verified against `@clerk/backend` `assertAuthorizedPartiesClaim`: matching is literal `Array.includes`, and the SDK skip fires only when `authorizedParties` is unset — the basis for the mobile concern and the predicate design.
