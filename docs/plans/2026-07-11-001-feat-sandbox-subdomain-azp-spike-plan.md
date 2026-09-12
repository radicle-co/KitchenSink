---
date: 2026-07-11
type: feat
origin: docs/brainstorms/2026-07-10-sandbox-subdomain-azp-spike-requirements.md
target_branch: 001-commise-recipe-app
---

# feat: Sandbox per-PR subdomains — Option B′ feasibility spike

**Target:** this plan is implemented on the `001-commise-recipe-app` worktree branch and ships in its PR. All paths are relative to that branch, where `recipe-service` exists and the shared verifier is `clerkVerify.ts` (camelCase, per `docs/CODING_STANDARDS.md §1` shared-package regime — NOT kebab; do not rename it).

## Summary

Prove end-to-end that sandbox previews can move to per-PR subdomains without weakening `azp` enforcement, and decide go/no-go. Add a self-owned `azp`-predicate mode to the shared `@kitchensink/clerk-verify` verifier so **every** consumer inherits it, wire all three consumers (identity, food-service, recipe-service) to it stage-gated, stand up one throwaway subdomain against the shared sandbox Clerk instance, and confirm a real sign-in mints a matching `azp` that the predicate accepts and that the browser session survives navigation. Settle whether `@clerk/expo` tokens carry `azp` in the same pass.

Terminology: the origin doc calls the artifact "the validator"; this plan calls the shared-package change "the predicate" and the whole self-owned check "the keeper" — same thing.

## Problem Frame

Sandbox previews are path-routed on one origin because `azp` binds to the browser origin and the SDK matches it by exact string; per-PR subdomains would need an unbounded allowlist and would 401 (origin: `docs/architecture/decisions/0001-sandbox-front-end-addressing.md`). The reframe: the exact-match is our code, not a Clerk constraint. `packages/shared/clerk-verify/src/clerkVerify.ts` passes `authorizedParties` to `@clerk/backend`'s `verifyToken`; if we instead validate the signature-verified `azp` ourselves against an anchored pattern scoped to our own preview domain, per-PR subdomains become viable with enforcement still on. Because the seam is the shared verifier, the capability is repo-wide.

That rests on facts this spike verifies: Clerk's shared dev instance actually mints a token from a per-PR subdomain (gated by FAPI wildcard-subdomain CORS), the resulting `azp` is the subdomain origin, the admission generalizes to a second unregistered host, and the browser session works on the subdomain (not just token mint). A latent question rides along — the verifier skips the `azp` check only when the allowlist is unset, but all three services require it non-empty, so if `@clerk/expo` tokens omit `azp` they already 401 against the enforcing services.

## Requirements

Traced from origin (`docs/brainstorms/2026-07-10-sandbox-subdomain-azp-spike-requirements.md`).

**Predicate (the keeper — repo-wide)**

- R1. `@kitchensink/clerk-verify` gains a self-owned `azp` predicate: when a pattern is configured it validates the verified `azp` against an anchored, dot-escaped, ReDoS-safe pattern instead of handing `authorizedParties` to `verifyToken`. All consumers inherit it. (origin R1)
- R2. The predicate accepts a genuine matching `azp` and rejects (→ 401) a non-matching one, including adversarial near-misses. (origin R2)
- R3. Exact-match list mode is unchanged when no pattern is configured. (origin R3 — prod parity)
- R4. Absent `azp` is admitted only against a positive native-token signal (a Clerk client-type/claim), never by `azp`-absence alone. (origin R4)

**Service wiring (all three consumers)**

- R5. identity, food-service, and recipe-service each gain stage-gated config to run predicate mode on sandbox while keeping exact-match on prod, with validation that rejects both "pattern + list set" and "neither set" (the latter would fail-open to skip-`azp`). (origin R1)

**Spike environment**

- R6. One fixed throwaway subdomain serves the sandbox web app over HTTPS, with `basePath` disabled to mirror the migrated target; not per-PR CI provisioning. (origin R5)
- R7. Clerk's wildcard-subdomain FAPI CORS allowance is enabled on the shared sandbox dev instance, its exact granted scope recorded, and reversible. (origin R6)

**Verification**

- R8. After sign-in on the subdomain, the minted token's decoded `azp` equals the subdomain's `https://` origin. (origin R7)
- R9. A backend in predicate mode accepts the real subdomain token, and the session persists across at least one authenticated navigation on the subdomain. (origin R8)
- R10. A second never-registered subdomain also mints an accepted token, proving the allowance is genuinely wildcard. (origin R9)
- R11. A real `@clerk/expo` token is decoded; the native-admission rule (R4) is set from the finding and the prod implication recorded. (origin R10)
- R12. The spike concludes with an explicit go/no-go, ADR-0001 is corrected where disproven, and any untested migration risk (e.g., basePath×subdomain) is flagged. (origin R11)

---

## Key Technical Decisions

- **Predicate lives in `@kitchensink/clerk-verify`, repo-wide.** The exact-match already lives there and is shared by identity/food-service/recipe-service; the predicate sits beside it so all three inherit it from one authoritative implementation. (see origin: "Own the `azp` check")
- **Shared verifier stays camelCase.** `clerkVerify.ts` follows `docs/CODING_STANDARDS.md §1` shared-package regime; kebab is NestJS-only. A rename to `clerk-verify.ts` would violate the standard — do not apply one.
- **Pattern and allowlist are mutually exclusive AND exhaustive, stage-gated.** Exactly one must be set per stage: pattern replaces the list on sandbox; prod sets the list and no pattern (path unchanged). Config validation rejects "both set" and "neither set" — the latter matters because an empty allowlist makes `verifyToken` skip the `azp` check entirely (fail-open).
- **The predicate is a security boundary.** Anchored both ends, dot-escaped, no unbounded quantifier (ReDoS-safe), scoped to the domain we control DNS for, adversarially tested.
- **Absent-`azp` admission needs a positive signal.** "Accept if `azp` absent" would let any client with an `azp`-less token bypass the origin check; R4 requires a native-token claim to admit, and the exact signal is set from U5's decode of a real native token.
- **Spoof-rejection proven at unit level; genuine-accept + session proven live.** We can't mint a token with a forged `azp` against the real instance, so R2's rejection path is unit-proven; the live sign-in proves real-mint + genuine-accept + session persistence.
- **Live proof runs on the migrated shape.** The subdomain serves the app with `basePath` disabled, because prior preview auth failures lived in the basePath×Clerk-routing interaction; a proof under current basePath config would not represent the basePath-stripped migration target.

---

## Implementation Units

### U1. Self-owned `azp` predicate in `@kitchensink/clerk-verify`

- **Goal:** Add an optional `azp`-pattern mode to the shared verifier that validates the verified `azp` itself, with a positive-signal native-token admission rule.
- **Requirements:** R1, R2, R3, R4
- **Dependencies:** none
- **Files:** `packages/shared/clerk-verify/src/clerkVerify.ts`, `packages/shared/clerk-verify/src/__tests__/clerkVerify.test.ts`
- **Approach:** Extend `ClerkVerifyConfig` with an optional authorized-party pattern and an optional native-admission predicate. When the pattern is present, pass `authorizedParties: undefined` to `verifyToken` and, after verification, test `payload['azp']` against the pattern; on mismatch throw `ClerkVerificationError`. A pure helper builds the anchored, dot-escaped `RegExp` from a base domain so callers pass a domain, not a raw regex. Absent `azp` is admitted only when the native-admission predicate matches a positive claim (set in U5), otherwise rejected. Leave the list path untouched when no pattern is set.
- **Execution note:** Test-first — this replaces a security control.
- **Patterns to follow:** `ClerkVerificationError` + `isClerkVerificationError` custom-error/guard convention in the file; the existing `asNonEmptyString`/`asRecord` pure coercers.
- **Test scenarios:**
    - Covers AE2. Genuine token whose `azp` matches the pattern → claims returned.
    - Covers AE3. `azp` is a sibling look-alike (`https://pr-1.evil.commise.app`), an unanchored suffix/prefix match, trailing content after the host, or a near-miss label (`pr-1x` for `pr-1`) → `ClerkVerificationError`.
    - Absent `azp`, no native signal → `ClerkVerificationError`. Absent `azp` WITH the native signal present → accepted. Absent `azp` with native signal on a token whose `azp` (if present) would mismatch → still governed by the pattern, not bypassed.
    - Regression: no pattern configured + non-empty allowlist → still delegates exact-match to `verifyToken`.
    - Pattern-builder helper escapes dots and anchors both ends.
- **Verification:** New and existing `clerkVerify` tests pass; list-mode behavior provably unchanged.

### U2. Wire predicate config into all three services (stage-gated, exhaustive validation)

- **Goal:** Let identity, food-service, and recipe-service each run predicate mode on sandbox while prod keeps exact-match, with fail-closed config validation.
- **Requirements:** R1, R3, R5
- **Dependencies:** U1
- **Files:** the config schema + `ClerkAuthService`/guard for each consumer — `packages/services/identity/src/config/env.schema.ts` and `packages/services/identity/src/auth/clerkAuth.service.ts`; `packages/services/food-service/src/config/*` and `packages/services/food-service/src/auth/foodAuth.guard.ts`; `packages/services/recipe-service/src/config/config.types.ts` and `packages/services/recipe-service/src/auth/clerkAuth.service.ts` — plus each service's config + auth test files
- **Approach:** Add a per-stage authorized-party pattern config alongside `CLERK_AUTHORIZED_PARTIES` in each service. In each zod schema, `superRefine` enforces exactly one of {pattern, list} per stage — reject "both set" and "neither set" — and forbid the pattern on prod-like stages. Each auth entry passes the pattern to the verifier when configured, else the existing list. No change to enforcement middleware/guards beyond the config wiring.
- **Execution note:** Test-first — config validation is the guard that keeps prod on exact-match and prevents fail-open.
- **Patterns to follow:** the existing stage-gated `superRefine` in `packages/services/identity/src/config/env.schema.ts`; `parseCommaList` in the recipe/identity `clerkAuth.service.ts`.
- **Test scenarios (per service):**
    - Pattern + list both set → config validation error.
    - Neither pattern nor list set → config validation error (fail-open guard).
    - Pattern set on a prod-like stage → config validation error.
    - Pattern set on sandbox → auth path calls the verifier in predicate mode.
    - No pattern (prod shape) → auth path uses the list, unchanged.
- **Verification:** Each service's config tests cover both stages and both invalid cases; all three services' typecheck and existing auth tests stay green.

### U3. Stand up throwaway spike subdomains + enable FAPI wildcard-subdomain CORS

- **Goal:** Serve the sandbox web app on fixed subdomains over HTTPS (basePath disabled) and let them reach Clerk's FAPI to mint tokens.
- **Requirements:** R6, R7, R10
- **Dependencies:** none
- **Files:** none (ops/config against the shared sandbox environment and the Clerk dashboard)
- **Approach:** Point two fixed hosts (e.g. `pr-spike.sandbox.commise.app` and a second `pr-spike2.sandbox.commise.app`, both under the existing `*.commise.app` cert) at the sandbox web app served with `basePath` disabled. Enable the wildcard-subdomain allowance on the shared sandbox Clerk dev instance. Record the exact domain scope Clerk grants (confirm it is `*.sandbox.commise.app`, not broader) and the rollback step so the shared instance can be reverted.
- **Test expectation:** none — infrastructure/dashboard change, verified by the round-trip in U4.
- **Verification:** Both subdomains serve the app over HTTPS with no basePath prefix; the Clerk change, its granted scope, and its revert step are written down.

### U4. Prove the live round-trip, session, and wildcard generality

- **Goal:** Confirm the mint premise, the genuine-accept path, session persistence, and that admission generalizes beyond one host.
- **Requirements:** R8, R9, R10
- **Dependencies:** U2, U3
- **Files:** none (manual/exploratory; findings recorded in U6's writeup)
- **Approach:** Sign in on the first spike subdomain; decode the minted token; confirm `azp` equals the subdomain origin (R8). With a consumer service configured in predicate mode for that domain — run **locally**, since verification is networkless against the public `CLERK_JWT_KEY` and recipe-service is not deployed — call a protected endpoint with the real token and confirm success, then confirm the browser session persists across at least one authenticated navigation on the subdomain (R9). Repeat sign-in on the second, never-individually-registered subdomain and confirm its token is also accepted (R10). The rejection path is not exercised live (see KTD); it is U1's unit tests.
- **Execution note:** Characterization/observation — record decoded `azp`, HTTP outcomes, session behavior, and the second-host result.
- **Test expectation:** none — live verification; automated equivalents live in U1 (rejection) and U2 (predicate wiring).
- **Verification:** Decoded `azp` matches origin; protected endpoint succeeds; session survives a navigation; second host also accepted — all recorded.

### U5. Settle the mobile `azp` question and set the native-admission signal

- **Goal:** Determine whether `@clerk/expo` tokens carry `azp` and set U1's positive native-admission signal from the finding.
- **Requirements:** R4, R11
- **Dependencies:** U1
- **Files:** `packages/shared/clerk-verify/src/clerkVerify.ts` and its test file (to encode the native-admission signal)
- **Approach:** Obtain a real token from the `@commise/mobile` app (`getToken()` from `@clerk/expo`), base64-decode the payload, and record whether `azp` and which distinguishing claims are present. Set U1's native-admission predicate to that positive signal (e.g. a Clerk client-type/session claim) — never bare `azp`-absence — and add the covering test. Document the prod implication: the `azp`-enforcing services would currently reject an `azp`-less mobile token, a possible existing bug.
- **Test scenarios:**
    - Native-admission signal accepts a real native-shaped token and still rejects a web token with a mismatched/absent `azp` lacking the signal.
- **Verification:** Presence/absence of `azp` and the distinguishing claim on a real native token is recorded; the native-admission test passes; the prod implication is written down.

### U6. Go/no-go writeup and ADR correction

- **Goal:** Turn the R8–R11 results into an explicit recommendation, fix the disproven ADR claim, and flag residual migration risk.
- **Requirements:** R12
- **Dependencies:** U4, U5
- **Files:** `docs/architecture/decisions/0001-sandbox-front-end-addressing.md`, plus a short findings note under `docs/` if needed
- **Approach:** Record decoded `azp`, endpoint + session outcomes, the second-host result, and the mobile finding, then state go or no-go. Correct ADR-0001's "Wildcard / pattern `azp` — Not possible" line to reflect that pattern validation is possible at our layer. Record the shared-instance CORS change, its granted scope, and rollback. Explicitly flag any migration risk the spike did not fully cover (e.g., if U4 could not disable basePath, note basePath×subdomain routing as unverified).
- **Test expectation:** none — documentation.
- **Verification:** ADR-0001 no longer asserts pattern `azp` is impossible; the recommendation is grounded in recorded R8–R11 results; residual risks are named.

---

## Scope Boundaries

**Deferred to Follow-Up Work (only if the spike returns "go")**

- The migration itself: per-PR subdomain provisioning in CI, replacing the CloudFront + KeyValueStore host-swap router, wildcard DNS automation, and retiring path routing.
- Removing the web app's `basePath` machinery (`packages/apps/commise/web/src/lib/basePath.ts` and the prefix-aware Clerk matcher in `packages/apps/commise/web/src/middleware.ts`).

**Outside this spike**

- Any prod change; prod retains exact-match, single-origin `azp` enforcement.
- The Lambda@Edge `Origin`-canonicalization / Clerk Proxy route (blocked on dev instances) and per-PR satellite domains.

---

## System-Wide Impact

- **Auth boundary, repo-wide.** U1 changes the shared verifier all three backend services depend on; U2 wires the config into each. The list path must stay byte-identical when no pattern is set (R3); the predicate path is additive and stage-gated, so prod behavior is unchanged for every service.
- **Shared sandbox Clerk instance.** U3 mutates a shared dev instance (wildcard-subdomain CORS), affecting every existing path-routed preview. The change is a widening, its granted scope is recorded, and it is reversible; U6 records the rollback.

---

## Risks & Dependencies

- **The mint premise may fail (R8).** If the dev-instance FAPI does not accept the subdomain origin or does not stamp `azp` as that origin, Option B′ fails at U4 and the go/no-go is "no" — an acceptable outcome.
- **The "wildcard" may be a managed registration list (R10).** If the second unregistered host is rejected, per-PR provisioning must register every origin in Clerk — an operational blocker the go/no-go must surface, caught by U4's second-host check.
- **Session behavior may differ on subdomains (R9).** A subdomain can mint a token yet exhibit different cookie/handshake behavior; U4 verifies session persistence, not just mint.
- **Absent-`azp` mobile tokens may surface a live bug (R11).** If native tokens omit `azp`, the deployed `azp`-enforcing services reject them today; U5 records this and it becomes its own fix.
- **Dependency:** the `*.commise.app` wildcard cert already covers the scratch subdomains; only DNS records are new.

---

## Sources / Research

- `docs/architecture/decisions/0001-sandbox-front-end-addressing.md` — the path-routing decision whose premise this spike tests; its "wildcard/pattern `azp` — not possible" line is corrected in U6.
- `docs/CODING_STANDARDS.md §1` — the two naming regimes; basis for keeping `clerkVerify.ts` camelCase.
- `packages/shared/clerk-verify/src/clerkVerify.ts` — where `authorizedParties` is passed to `verifyToken` and `azp` is surfaced (the seam U1 changes).
- Consumers wired in U2: `packages/services/identity/src/auth/clerkAuth.service.ts`, `packages/services/food-service/src/auth/foodAuth.guard.ts`, `packages/services/recipe-service/src/auth/clerkAuth.service.ts`.
- `packages/services/identity/src/config/env.schema.ts` — stage-gated `superRefine` config-validation pattern to mirror.
- Verified against `@clerk/backend` `assertAuthorizedPartiesClaim`: matching is literal `Array.includes`, and the SDK skip fires only when `authorizedParties` is unset — the basis for R4/U5's mobile concern and U1's predicate design.
