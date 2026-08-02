# Acceptance Test Plan: AI Integration

**Feature Branch**: `005-ai-integration`
**Created**: 2026-05-09
**Restructured**: 2026-08-02
**Status**: Draft
**Source**: `specs/005-ai-integration/v-model/requirements.md`

---

## ⚠️ ID scheme restructured 2026-08-02 — read before citing an ID

This plan previously used a **per-feature** key: `AT-005-{A..G}` with `ATS-005-{X}{n}` scenarios, where
`005` was the _feature_ number and one test case covered many requirements (`AT-005-B` covered eight).

The deterministic matrix builder (`build-matrix.sh`) links a test case to a requirement by the **numeric
part of the test-case ID** — `ATP-001-A` verifies `REQ-001`, `ATP-NF-005-A` verifies `REQ-NF-005`. Under
the old key, `AT-005-*` resolved to a non-existent `REQ-005`-ish key for everything, so the builder
reported **0/27 coverage** for an acceptance plan that genuinely had coverage.

The plan is therefore re-keyed to **one test case per requirement**: `ATP-{REQ-key}-{X}` with
`SCN-{REQ-key}-{X}{n}` scenarios. Scenario _content_ is preserved; only the keys changed, and scenarios
that genuinely validate two requirements now appear under both (each with its own ID, as the builder's
`SCN → ATP` prefix match requires).

### Old → new ID map (so prior citations stay resolvable)

`peer-review.md` finding **PRF-005-A1** cites the duplicate `AT-005-F`; that duplication is resolved here
— the two sections are now distinct requirement-keyed test cases.

| Old test case  | Old scenarios     | Now verifies                                                                                                           |
| -------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `AT-005-A`     | `ATS-005-A1..A6`  | `ATP-001-A`, `ATP-007-A`, `ATP-NF-005-A`                                                                               |
| `AT-005-B`     | `ATS-005-B1..B10` | `ATP-002-A`, `ATP-003-A`, `ATP-004-A`, `ATP-005-A`, `ATP-006-A`, `ATP-012-A`, `ATP-014-A`, `ATP-015-A`, `ATP-CN-003-A` |
| `AT-005-C`     | `ATS-005-C1..C7`  | `ATP-008-A`, `ATP-009-A`, `ATP-010-A`, `ATP-IF-001-A`, `ATP-IF-002-A`                                                  |
| `AT-005-D`     | `ATS-005-D1..D5`  | `ATP-011-A`, `ATP-IF-003-A`, `ATP-CN-002-A`                                                                            |
| `AT-005-E`     | `ATS-005-E1..E3`  | `ATP-013-A`                                                                                                            |
| `AT-005-F` (1) | `ATS-005-F1..F4`  | `ATP-001-B`, `ATP-007-A`                                                                                               |
| `AT-005-F` (2) | `ATS-005-G1..G4`  | `ATP-NF-001-A`, `ATP-NF-002-A`, `ATP-NF-003-A`, `ATP-NF-004-A`                                                         |

---

## Test Tiers

### Tier 1: Acceptance Test Case (ATP) — one per requirement

### Tier 2: User Story / Requirement

### Tier 3: BDD Scenario (SCN) — Given / When / Then

---

#### Test Case: ATP-001-A (BYOK — user configures their own AI provider credentials)

**Requirement**: REQ-001

| SCN ID     | Scenario                                   | Given                                           | When                                     | Then                                                                                                |
| ---------- | ------------------------------------------ | ----------------------------------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------- |
| SCN-001-A1 | Happy-path provider save                   | User is authenticated                           | User submits a valid API key for OpenAI  | System writes the raw key to AWS Secrets Manager, persists only the ARN, returns masked metadata    |
| SCN-001-A2 | Missing API key                            | User is authenticated, form rendered            | User submits empty `apiKey` field        | System returns 400 `ValidationError`; no DB write, no secret written                                |
| SCN-001-A3 | Invalid provider enum                      | User is authenticated                           | User selects provider `unknown-provider` | System returns 400; no DB write occurs                                                              |
| SCN-001-A4 | Secrets Manager unavailable                | Secrets Manager unreachable or throttled        | User submits a valid API key             | System returns 503 with `Retry-After` (circuit breaker); nothing persisted in Postgres              |
| SCN-001-A5 | DB write fails after the secret is written | Secrets Manager write succeeded, DB write fails | User submits a valid API key             | System deletes the just-written secret (compensating action), returns 503; no orphaned key material |

---

#### Test Case: ATP-001-B (BYOK — credential lifecycle management)

**Requirement**: REQ-001

| SCN ID     | Scenario                                 | Given                                               | When                                            | Then                                                                                     |
| ---------- | ---------------------------------------- | --------------------------------------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------- |
| SCN-001-B1 | User lists configured providers          | User has openai and gemini configured               | User calls `GET /api/v1/ai/byok/keys`           | System returns provider metadata only — no raw key, no ciphertext, no ARN                |
| SCN-001-B2 | User deletes a provider                  | User has gemini configured                          | User calls `DELETE /api/v1/ai/byok/keys/gemini` | Row removed **and** the Secrets Manager secret deleted; gemini not used as fallback      |
| SCN-001-B3 | Three providers coexist (decision D-005) | User configures openai, then anthropic, then gemini | User lists keys                                 | All three are active simultaneously; re-saving openai replaces it and bumps `keyVersion` |

---

#### Test Case: ATP-002-A (In-app AI recipe generation)

**Requirement**: REQ-002

| SCN ID     | Scenario           | Given                                              | When                             | Then                                                                   |
| ---------- | ------------------ | -------------------------------------------------- | -------------------------------- | ---------------------------------------------------------------------- |
| SCN-002-A1 | Generation success | User has OpenAI provider configured with valid key | User submits generation criteria | System calls the configured provider and returns a recipe draft        |
| SCN-002-A2 | Provider API error | Provider returns non-2xx or network failure        | Generation request submitted     | System returns 502 with a sanitized message; no partial data persisted |

---

#### Test Case: ATP-003-A (Generation latency — 15-second budget)

**Requirement**: REQ-003

| SCN ID     | Scenario                   | Given                                       | When                         | Then                                      |
| ---------- | -------------------------- | ------------------------------------------- | ---------------------------- | ----------------------------------------- |
| SCN-003-A1 | Draft returned within 15 s | User has a valid provider configured        | Generation request submitted | Recipe draft returned in ≤ 15 s (SC-003)  |
| SCN-003-A2 | Generation timeout (>15 s) | User has a valid but slow/degraded provider | Generation request submitted | System returns 504 `ProviderTimeoutError` |

---

#### Test Case: ATP-004-A (Preview before save)

**Requirement**: REQ-004

| SCN ID     | Scenario                   | Given                             | When                           | Then                                                            |
| ---------- | -------------------------- | --------------------------------- | ------------------------------ | --------------------------------------------------------------- |
| SCN-004-A1 | Preview shown, not saved   | Generation succeeded              | Draft returned to the user     | Preview displayed with accept/reject; **nothing persisted yet** |
| SCN-004-A2 | Draft expired (TTL 10 min) | User does not act for 10+ minutes | User submits save after expiry | System returns 404; user must re-generate                       |

---

#### Test Case: ATP-005-A (Accepted recipe saved to the user's collection)

**Requirement**: REQ-005

| SCN ID     | Scenario           | Given                    | When               | Then                                                                    |
| ---------- | ------------------ | ------------------------ | ------------------ | ----------------------------------------------------------------------- |
| SCN-005-A1 | User accepts draft | Recipe preview displayed | User clicks "Save" | Recipe saved to the user's collection; 201 with recipeId; draft cleared |

---

#### Test Case: ATP-006-A (Declined recipe is never stored)

**Requirement**: REQ-006

| SCN ID     | Scenario           | Given                    | When                 | Then                                                       |
| ---------- | ------------------ | ------------------------ | -------------------- | ---------------------------------------------------------- |
| SCN-006-A1 | User rejects draft | Recipe preview displayed | User clicks "Reject" | System returns 204; **no recipe persisted**; draft cleared |

---

#### Test Case: ATP-007-A (Setup guidance when no provider is configured)

**Requirement**: REQ-007

| SCN ID     | Scenario                             | Given                           | When                               | Then                                                                    |
| ---------- | ------------------------------------ | ------------------------------- | ---------------------------------- | ----------------------------------------------------------------------- |
| SCN-007-A1 | No provider configured on generation | User has no provider configured | User requests AI recipe generation | System returns 422 with a setup-guide payload (providers + setup links) |
| SCN-007-A2 | All providers deleted                | User has deleted every provider | Provider resolution runs           | `NoProviderConfiguredError` raised, mapped to 422 with the setup guide  |

---

#### Test Case: ATP-008-A (Agent may READ the recipe collection)

**Requirement**: REQ-008

| SCN ID     | Scenario                        | Given                                         | When                                        | Then                                                           |
| ---------- | ------------------------------- | --------------------------------------------- | ------------------------------------------- | -------------------------------------------------------------- |
| SCN-008-A1 | Read scope grants read access   | Agent holds a valid token with `recipes:read` | Agent requests the user's recipe collection | System returns the collection                                  |
| SCN-008-A2 | Read scope does NOT grant write | Consent stored with `recipes:read` only       | Agent calls a `recipes:create` operation    | System returns 403 — read may be granted without write (D-001) |

---

#### Test Case: ATP-009-A (Agent may CREATE recipes on the user's behalf)

**Requirement**: REQ-009

| SCN ID     | Scenario                 | Given                                     | When                                 | Then                                                          |
| ---------- | ------------------------ | ----------------------------------------- | ------------------------------------ | ------------------------------------------------------------- |
| SCN-009-A1 | Create with write scope  | Consent stored including `recipes:create` | Agent creates a recipe               | Recipe created on the user's behalf; 201 returned             |
| SCN-009-A2 | Agent-created is private | Consent includes `recipes:create`         | Agent submits `visibility: 'public'` | Rejected 400 — agents may only create private recipes (D-004) |

---

#### Test Case: ATP-010-A (Explicit consent required before any agent access)

**Requirement**: REQ-010

| SCN ID     | Scenario                   | Given                                        | When                                  | Then                                                               |
| ---------- | -------------------------- | -------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------ |
| SCN-010-A1 | Agent initiates OAuth flow | External agent platform begins authorization | Agent redirects the user to authorize | System redirects to Clerk with `code_challenge`, `state`, `nonce`  |
| SCN-010-A2 | User grants consent        | Callback received with valid state           | User approves agent access            | Grant stored with scopes and timestamp; user returned to the agent |
| SCN-010-A3 | User denies consent        | Callback received                            | User rejects authorization            | Redirect with `access_denied`; **no tokens and no grant stored**   |

---

#### Test Case: ATP-011-A (Unauthorized agents are rejected)

**Requirement**: REQ-011

| SCN ID     | Scenario          | Given                                  | When                           | Then                                                                |
| ---------- | ----------------- | -------------------------------------- | ------------------------------ | ------------------------------------------------------------------- |
| SCN-011-A1 | Expired token     | Agent holds an expired token           | Agent calls any agent endpoint | System returns 401; the agent must refresh                          |
| SCN-011-A2 | Consent revoked   | The user revoked consent               | Agent makes an API call        | Grant lookup fails closed → 403, even with an otherwise valid token |
| SCN-011-A3 | No token provided | Request missing `Authorization` header | Any agent endpoint called      | System returns 401                                                  |

---

#### Test Case: ATP-012-A (AI-saved recipes are private and user-owned)

**Requirement**: REQ-012

| SCN ID     | Scenario                   | Given                              | When                 | Then                                                                     |
| ---------- | -------------------------- | ---------------------------------- | -------------------- | ------------------------------------------------------------------------ |
| SCN-012-A1 | In-app save is private     | User accepts an AI-generated draft | Recipe is persisted  | Stored as a private, user-owned recipe regardless of the service default |
| SCN-012-A2 | Agent save is also private | Agent has `recipes:create`         | Agent saves a recipe | Stored private; a non-private payload is rejected 400 (D-004)            |

---

#### Test Case: ATP-013-A (Consent revocation)

**Requirement**: REQ-013

| SCN ID     | Scenario                            | Given                             | When                                     | Then                                                                |
| ---------- | ----------------------------------- | --------------------------------- | ---------------------------------------- | ------------------------------------------------------------------- |
| SCN-013-A1 | User revokes agent consent          | A grant exists for the user/agent | User clicks "Revoke" in account settings | Grant marked revoked; subsequent agent calls return 403             |
| SCN-013-A2 | Revoked agent presents a new token  | Consent is revoked                | Agent presents a newly issued token      | Grant is checked first → 403; a fresh token does not restore access |
| SCN-013-A3 | User re-authorizes after revocation | Consent was revoked               | User completes a new consent flow        | New grant created; agent regains access                             |

---

#### Test Case: ATP-014-A (Premium instruction optimization)

**Requirement**: REQ-014

| SCN ID     | Scenario                            | Given                           | When                                   | Then                                               |
| ---------- | ----------------------------------- | ------------------------------- | -------------------------------------- | -------------------------------------------------- |
| SCN-014-A1 | Premium user optimizes instructions | User has a premium subscription | User requests instruction optimization | System returns optimized instructions as a preview |

---

#### Test Case: ATP-015-A (Accept or reject an optimization)

**Requirement**: REQ-015

> Recovered coverage: these scenarios existed as `ATS-005-B9`/`B10` but `REQ-015` was never listed on any
> old test case, so it read as uncovered.

| SCN ID     | Scenario                  | Given                            | When                 | Then                                                  |
| ---------- | ------------------------- | -------------------------------- | -------------------- | ----------------------------------------------------- |
| SCN-015-A1 | User accepts optimization | Optimized instructions displayed | User clicks "Accept" | Optimized instructions persisted; 200 returned        |
| SCN-015-A2 | User rejects optimization | Optimized instructions displayed | User clicks "Reject" | 200 returned with the original instructions unchanged |

---

#### Test Case: ATP-016-A (Sanity validation warns, never blocks)

**Requirement**: REQ-016

> Resolves the low-quality Edge Case. The checks are heuristics, so every scenario below asserts the
> **non-blocking** property as hard as it asserts detection — a validator that silently discarded a result
> would be a worse failure than the one it guards against.

| SCN ID     | Scenario                               | Given                                                             | When                    | Then                                                                                    |
| ---------- | -------------------------------------- | ----------------------------------------------------------------- | ----------------------- | --------------------------------------------------------------------------------------- |
| SCN-016-A1 | Implausible quantity is warned         | A draft calls for 3 tbsp salt for 2 servings                      | Preview is rendered     | A non-blocking warning is shown; the recipe is still previewable **and still saveable** |
| SCN-016-A2 | Unsafe temperature is warned           | A draft specifies 400 °C for 5 minutes                            | Preview is rendered     | A non-blocking warning is shown; save is **not** blocked                                |
| SCN-016-A3 | Step references an unlisted ingredient | A step uses "the tamarind" but tamarind is not in the ingredients | Preview is rendered     | A non-blocking warning identifies the step and the missing ingredient                   |
| SCN-016-A4 | Clean draft produces no warnings       | A plausible, well-formed draft                                    | Preview is rendered     | Zero warnings; the confidence indicator reflects a clean validation result (FR-022)     |
| SCN-016-A5 | Validation never auto-discards         | A draft failing every check                                       | User chooses to save it | The recipe saves successfully — the system warned and the user decided                  |

---

#### Test Case: ATP-017-A (Regenerate from preview)

**Requirement**: REQ-017

| SCN ID     | Scenario                          | Given                               | When                               | Then                                                                                               |
| ---------- | --------------------------------- | ----------------------------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------- |
| SCN-017-A1 | Regenerate reuses criteria        | A preview is displayed              | User chooses "Regenerate"          | A new generation runs against the **same criteria** without re-entry; a new draft replaces the old |
| SCN-017-A2 | Cost implication is evident       | A preview is displayed              | The regenerate affordance is shown | The UI makes clear the retry spends the user's own provider credit (BYOK)                          |
| SCN-017-A3 | Same limits as initial generation | A regeneration is already in flight | User triggers another              | Rejected `429` — regeneration obeys the same per-user concurrency limit                            |
| SCN-017-A4 | Discarded draft is not persisted  | A preview is displayed              | User regenerates                   | The superseded draft is discarded and never persisted (FR-017/REQ-006 semantics hold)              |

---

#### Test Case: ATP-NF-001-A (Strict TypeScript)

**Requirement**: REQ-NF-001

| SCN ID        | Scenario                                    | Given                | When               | Then                          |
| ------------- | ------------------------------------------- | -------------------- | ------------------ | ----------------------------- |
| SCN-NF-001-A1 | All TypeScript compiles with `strict: true` | Source files changed | `tsc --strict` run | Exit code 0; zero type errors |

---

#### Test Case: ATP-NF-002-A (JSDoc on exports)

**Requirement**: REQ-NF-002

| SCN ID        | Scenario                      | Given                 | When                 | Then                           |
| ------------- | ----------------------------- | --------------------- | -------------------- | ------------------------------ |
| SCN-NF-002-A1 | Exported functions have JSDoc | New function exported | Build/lint step runs | Zero JSDoc violations reported |

---

#### Test Case: ATP-NF-003-A (Accessible names)

**Requirement**: REQ-NF-003

| SCN ID        | Scenario                      | Given                 | When                                                        | Then                                             |
| ------------- | ----------------------------- | --------------------- | ----------------------------------------------------------- | ------------------------------------------------ |
| SCN-NF-003-A1 | UI component accessible names | UI component rendered | Playwright queries `getByRole('button', { name: /save/i })` | Element found without an `aria-label` workaround |

---

#### Test Case: ATP-NF-004-A (Colour is not the sole state conveyor)

**Requirement**: REQ-NF-004

| SCN ID        | Scenario                          | Given                                     | When                      | Then                                                     |
| ------------- | --------------------------------- | ----------------------------------------- | ------------------------- | -------------------------------------------------------- |
| SCN-NF-004-A1 | Colour is not sole state conveyor | UI component with a coloured status shown | Accessibility linter runs | Icon + text pairing present; zero WCAG contrast failures |

---

#### Test Case: ATP-NF-005-A (Credential custody — no key material in the app DB)

**Requirement**: REQ-NF-005

| SCN ID        | Scenario                                  | Given                     | When                    | Then                                                                                               |
| ------------- | ----------------------------------------- | ------------------------- | ----------------------- | -------------------------------------------------------------------------------------------------- |
| SCN-NF-005-A1 | Stored row holds an ARN only              | User has saved a BYOK key | The DB row is inspected | Row holds a `secret_arn`; the raw key is absent from Postgres in **any** form, ciphertext included |
| SCN-NF-005-A2 | Key retrievable only from Secrets Manager | User has saved a BYOK key | Secrets Manager is read | The value under `byok/{userId}/{provider}` equals the submitted key                                |
| SCN-NF-005-A3 | Deletion leaves no orphan                 | User deletes the key      | Teardown completes      | Row gone **and** the secret deleted                                                                |

---

#### Test Case: ATP-IF-001-A (OAuth authorization-code endpoint)

**Requirement**: REQ-IF-001

| SCN ID        | Scenario                   | Given                                            | When                               | Then                                                                                                       |
| ------------- | -------------------------- | ------------------------------------------------ | ---------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| SCN-IF-001-A1 | Authorization URL shape    | Agent begins authorization                       | Authorization endpoint is called   | Redirect carries `code_challenge`, `state`, `nonce`                                                        |
| SCN-IF-001-A2 | State mismatch on callback | Tampered `state` submitted                       | Callback handler receives it       | Flow aborts; no tokens exchanged                                                                           |
| SCN-IF-001-A3 | Code-verifier mismatch     | Valid state, tampered verifier                   | Code exchanged with wrong verifier | Flow aborts; no tokens exchanged                                                                           |
| SCN-IF-001-A4 | Consent state expires      | User is slow through consent (past the 60 s TTL) | Callback arrives after expiry      | User receives a retryable **expiry** error, distinguishable from a tampering rejection (closes PRF-005-A4) |

---

#### Test Case: ATP-IF-002-A (Scopes `recipes:read` and `recipes:create`)

**Requirement**: REQ-IF-002

| SCN ID        | Scenario                    | Given                           | When                      | Then                                                     |
| ------------- | --------------------------- | ------------------------------- | ------------------------- | -------------------------------------------------------- |
| SCN-IF-002-A1 | Read-only grant is honoured | Grant holds `recipes:read` only | Agent attempts a write    | 403 — the two scopes are independently grantable (D-001) |
| SCN-IF-002-A2 | Both scopes granted         | Grant holds read **and** create | Agent reads, then creates | Both succeed                                             |

---

#### Test Case: ATP-IF-003-A (Structured recipe collection for agents)

**Requirement**: REQ-IF-003

| SCN ID        | Scenario                       | Given                                    | When                                 | Then                                                                              |
| ------------- | ------------------------------ | ---------------------------------------- | ------------------------------------ | --------------------------------------------------------------------------------- |
| SCN-IF-003-A1 | Collection returned structured | Agent holds a valid `recipes:read` grant | Agent requests the recipe collection | Collection returned in the documented structured format, scoped to that user only |

---

#### Test Case: ATP-CN-002-A (Authentication required for all AI features)

**Requirement**: REQ-CN-002

| SCN ID        | Scenario                                | Given                     | When                                        | Then               |
| ------------- | --------------------------------------- | ------------------------- | ------------------------------------------- | ------------------ |
| SCN-CN-002-A1 | Unauthenticated user attempts in-app AI | No session token present  | User calls `/api/v1/ai/generate/recipe`     | System returns 401 |
| SCN-CN-002-A2 | Unauthenticated agent surface           | No `Authorization` header | Any `/api/v1/ai/*` or agent endpoint called | System returns 401 |

---

#### Test Case: ATP-CN-003-A (Premium gate on generation and optimization)

**Requirement**: REQ-CN-003

| SCN ID        | Scenario                           | Given                              | When                            | Then                                              |
| ------------- | ---------------------------------- | ---------------------------------- | ------------------------------- | ------------------------------------------------- |
| SCN-CN-003-A1 | Free-tier user attempts generation | User authenticated but not premium | User requests recipe generation | Rejected **server-side** (D-002); no AI call made |

---

#### Test Case: ATP-CN-001-A (AI-saved recipes conform to the spec-001 Recipe contract)

**Requirement**: REQ-CN-001

> **Closes peer-review finding PRF-005-A3.** That finding rejected the previous _Inspection_-only
> verification as insufficient for a P1 cross-spec dependency: "If the spec 001 Recipe schema changes
> (e.g. a required field is added), the AI integration could silently break with no test catching the
> regression." These scenarios are executable and exercise the **real** recipe-service contract rather
> than a stub — the only way the regression PRF-005-A3 describes can actually be caught.
>
> Under the 2026-08-02 architecture (`plan.md` §1.4) 005 owns no `recipes` table; it calls
> `@kitchensink/recipe-service-client`. The contract under test is therefore the client + service
> boundary, not a local schema.

| SCN ID        | Scenario                             | Given                                             | When                                           | Then                                                                                                             |
| ------------- | ------------------------------------ | ------------------------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| SCN-CN-001-A1 | AI recipe satisfies the 001 contract | A generated draft is accepted by the user         | 005 calls `recipeServiceClient.createRecipe()` | Recipe-service returns 201 and the persisted recipe validates against the spec-001 `RecipeDetail` contract       |
| SCN-CN-001-A2 | Required-field regression is caught  | Spec 001 adds or tightens a required Recipe field | The AI save path runs against the real client  | The call fails loudly (schema validation error), not silently — the regression PRF-005-A3 asks us to catch       |
| SCN-CN-001-A3 | Ownership and provenance are set     | A generated draft is accepted                     | The recipe is persisted                        | `ownerId` is the acting user's app ULID and the recipe is private; 005 never writes the `recipes` table directly |

---

#### Test Case: ATP-IF-004-A (Equivalent web and mobile workflows)

**Requirement**: REQ-IF-004

> The old plan listed REQ-IF-004 under the second `AT-005-F` but supplied **no scenario**, so it was
> never actually covered — the multi-requirement structure hid that. Parity is required by Constitution
> Principle VIII (lockstep release) and asserted by the paired Playwright + Maestro suites
> (`tasks.md` T-076 / T-077).

| SCN ID        | Scenario                            | Given                              | When                                         | Then                                                                                               |
| ------------- | ----------------------------------- | ---------------------------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| SCN-IF-004-A1 | BYOK setup exists on both platforms | A user with no provider configured | The BYOK flow is exercised on web and mobile | Both complete provider setup with equivalent steps and outcomes (Playwright T-076 + Maestro T-077) |
| SCN-IF-004-A2 | Generation + preview parity         | A user with a configured provider  | Generation and preview exercised on both     | Both reach a preview with accept/reject, and both display the FR-022 guard message                 |
| SCN-IF-004-A3 | Agent consent + revocation parity   | A user with an agent grant         | Consent and revocation exercised on both     | Both present the two independent scope checkboxes (D-001) and both can revoke                      |
| SCN-IF-004-A4 | Shared implementation, not a fork   | The guard banner rendered on both  | The component source is inspected            | Both render from `@commise/features-ai`; a per-platform duplicate violates GR-010 AC-010-c         |

---

## Acceptance Criteria per REQ

| REQ ID     | Pre-condition               | Success Condition                                                                                          | Technique                                     |
| ---------- | --------------------------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| REQ-001    | Authenticated user          | Key stored in Secrets Manager; only the ARN persisted; metadata-only response                              | Statement Coverage + Equivalence Partitioning |
| REQ-002    | Valid provider configured   | Provider called; recipe draft returned                                                                     | Statement Coverage                            |
| REQ-003    | Valid provider configured   | Recipe draft returned within 15 s                                                                          | Latency Boundary Test (15 s threshold)        |
| REQ-004    | Generation succeeded        | Preview shown; nothing persisted before acceptance                                                         | State Transition Testing                      |
| REQ-005    | Draft accepted              | Recipe saved to the user's collection                                                                      | Statement Coverage                            |
| REQ-006    | Draft declined              | No recipe persisted                                                                                        | Statement Coverage                            |
| REQ-007    | No provider configured      | 422 with setup guidance                                                                                    | Equivalence Partitioning                      |
| REQ-008    | Valid read grant            | Collection returned                                                                                        | Interface Contract Testing                    |
| REQ-009    | Valid create grant          | Recipe created, private                                                                                    | Interface Contract Testing                    |
| REQ-010    | Consent flow completed      | Grant stored only on explicit approval                                                                     | State Transition Testing                      |
| REQ-011    | Unauthorized agent          | 401/403, fails closed                                                                                      | Fault Injection                               |
| REQ-012    | AI recipe saved by any path | Stored private and user-owned                                                                              | Statement Coverage                            |
| REQ-013    | Grant exists                | Revocation immediate on next call                                                                          | State Transition Testing                      |
| REQ-014    | Premium user                | Optimization returned as a preview                                                                         | Statement Coverage                            |
| REQ-015    | Optimization displayed      | Accept persists, reject leaves original                                                                    | State Transition Testing                      |
| REQ-NF-001 | Source changed              | `tsc --strict` exits 0                                                                                     | Inspection                                    |
| REQ-NF-002 | New exports                 | Zero JSDoc violations                                                                                      | Inspection                                    |
| REQ-NF-003 | New UI components           | `getByRole`/`getByLabel` queries succeed                                                                   | Playwright Integration Test                   |
| REQ-NF-004 | New UI with colour state    | Icon + text pairing on all colour-gated states                                                             | Accessibility Inspection                      |
| REQ-NF-005 | API key written             | Row holds only a Secrets Manager ARN; the raw key is absent from Postgres in ANY form, ciphertext included | Inspection (code review + DB dump check)      |
| REQ-IF-001 | Agent OAuth initiation      | Authorization URL carries `code_challenge`, `state`, `nonce`                                               | Interface Contract Test                       |
| REQ-IF-002 | Consent grant               | Stored scopes include `recipes:read` and `recipes:create`, independently grantable                         | Statement Coverage                            |
| REQ-IF-003 | Authorized agent query      | Collection returned in the documented structured format                                                    | Interface Contract Test                       |
| REQ-IF-004 | Web and mobile surfaces     | Equivalent workflows on both platforms                                                                     | Playwright + Maestro parity                   |
| REQ-CN-001 | Recipe entity storage       | AI-saved recipe stored per the 001 contract                                                                | Inspection — see PRF-005-A3                   |
| REQ-CN-002 | Unauthenticated request     | All `/api/v1/ai/*` and agent endpoints return 401                                                          | Fault Injection                               |
| REQ-CN-003 | Non-premium user            | Generation/optimization rejected server-side                                                               | Decision Table Testing                        |

---

## Release Gates

**Gate 1 — Functional**

- [ ] Every requirement with an ATP has all its scenarios executed
- [ ] The two known gaps (REQ-CN-001, REQ-IF-004) are closed or formally waived in `waivers.md`

**Gate 2 — Security**

- [ ] API keys held only in AWS Secrets Manager; DB dump check proves no key material (plaintext OR ciphertext) in Postgres
- [ ] No raw API key appears in any log, error message, or response body
- [ ] Unauthenticated requests to `/api/v1/ai/*` and agent endpoints return 401
- [ ] Unauthorized agent requests return 403
- [ ] A read-only grant cannot produce a write downstream

**Gate 3 — Quality**

- [ ] `tsc --strict` exits 0; zero JSDoc violations
- [ ] Every new UI component is queryable via `getByRole`/`getByLabel`
- [ ] Colour is never the sole conveyor of state
