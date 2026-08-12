# Feature Specification: AI Integration

**Feature Branch**: `005-ai-integration`
**Created**: 2026-04-14
**Last updated**: 2026-08-02
**Status**: Product decisions approved — plan/V-Model/test artifacts remain Draft; release audit ❌ BLOCKED
**Input**: Split from `001-commise-recipe-app` — AI-powered recipe generation (BYOK in-app + external agent platforms via OAuth).

## Dependencies

| Spec                                                        | Relationship                                                                                     |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| [001-commise-recipe-app](../001-commise-recipe-app/spec.md) | **Required** — AI-generated recipes are stored as Recipe entities defined in 001                 |
| [002-user-auth](../002-user-auth/spec.md)                   | **Required** — all AI features require authentication; external agent OAuth builds on auth layer |
| [010-subscriptions](../010-subscriptions/spec.md)           | **Referenced** — AI generation and instruction optimization are premium features                 |

## User Scenarios & Testing _(mandatory)_

### User Story 1 - AI-Powered Recipe Generation and Assistance (Priority: P2)

A user can interact with AI for recipe generation in two ways. **In-app (BYOK)**: The user configures their preferred AI provider (OpenAI, Gemini, Anthropic, etc.) by storing their own API credentials in Commise. When they request a recipe in the app, Commise calls the user's configured provider and returns the result. **Via external agent platforms**: The user interacts with a Commise custom agent inside platforms like ChatGPT or Gemini. The agent can read the user's recipe collection ("What chicken recipes do I have?") and save new recipes to their Commise account — all after the user has authorized the agent via an OAuth consent flow.

**Why this priority**: AI integration is identified as critical for long-term product differentiation and value. The two-direction model (Commise as AI client + Commise as agent tool) maximizes reach — users get AI where they already are, and the app becomes a platform.

**Independent Test**: In-app: configure an AI provider key, request "low-carb Italian dinner for 4," verify recipe is returned and saveable. External agent: authorize a test agent via OAuth, have it read the user's collection and save a new recipe, verify both operations succeed.

**Acceptance Scenarios**:

1. **Given** a user provides criteria (ingredients, dietary needs, cuisine), **When** they request an AI-generated recipe in-app, **Then** the system calls their configured AI provider and returns a complete recipe within 15 seconds.
2. **Given** an AI-generated recipe is displayed, **When** the user chooses to save it, **Then** it is added to their collection as a private recipe they own.
3. **Given** an AI-generated recipe is displayed, **When** the user declines to save, **Then** no recipe is stored.
4. **Given** a user has not configured any AI provider credentials, **When** they attempt to generate a recipe in-app, **Then** the system guides them through provider setup.
5. **Given** a user has authorized a Commise agent on an external platform (e.g., ChatGPT), **When** the agent requests to read the user's recipes, **Then** the system returns the user's collection in a structured format.
6. **Given** a user has authorized a Commise agent on an external platform, **When** the agent creates a recipe on their behalf, **Then** the recipe is saved to the user's collection as a private, owned recipe.
7. **Given** a user has NOT authorized an external agent, **When** the agent attempts to access their account, **Then** the system rejects the request and returns an authorization error.
8. **Given** a user owns a recipe, **When** they request AI optimization of the instructions (simplify or streamline), **Then** the system returns improved instructions that the user can accept or reject. _(Premium feature)_

---

### Edge Cases

**What happens when AI recipe generation fails?** _(Resolved 2026-08-02)_ Each failure mode has a distinct,
tested response: provider error → `502` with a sanitized message and nothing persisted; provider timeout
past the 15 s budget → `504`; circuit open → `503` with `Retry-After`; no provider configured → `422` with
setup guidance (FR-015 scenario 4). No partial data is ever persisted on a failed generation.

**What happens when generation succeeds but returns a LOW-QUALITY result?** _(Resolved 2026-08-02 — owner
decision)_ This is the harder case: the call succeeded and the recipe is well-formed, but wrong — implausible
quantities, unsafe temperatures, steps referencing ingredients that were never listed. The system does **two**
things, and deliberately not a third:

1. **Sanity validation (FR-023)** — deterministic, bounded checks run on every generated recipe before it is
   shown. Failures surface as **warnings on the preview**.
2. **Regenerate (FR-024)** — the user can discard and retry from the preview without re-entering criteria.
3. **It does NOT auto-discard or block the save.** The checks are heuristics; a heuristic must not silently
   delete a result the user may want. The user always decides.

**Accepted limitation**: sanity validation catches implausible _values_, not bad _cooking_. A recipe that is
technically valid and simply unappetising will pass. FR-022's guard message remains the mitigation for that
class, and it is not claimed to be more.

## Requirements _(mandatory)_

### Functional Requirements

**AI Integration**

- **FR-015**: System MUST allow users to configure their preferred AI provider (e.g., OpenAI, Gemini, Anthropic) by securely storing their own API credentials (BYOK model).
- **FR-016**: System MUST call the user's configured AI provider to generate recipes based on criteria (ingredients, dietary restrictions, cuisine, calorie targets) and return results within the app.
- **FR-017**: System MUST allow users to preview AI-generated recipes before optionally saving them to their collection.
- **FR-018**: System MUST expose an OAuth 2.1-protected API that allows authorized external agents (e.g., ChatGPT GPT Actions, Gemini Extensions) to read the user's recipe collection and create recipes on their behalf. Users MUST explicitly grant consent before any agent can access their account. Read access (`recipes:read`) and write access (`recipes:create`) are separate grants requiring separate, clearly labeled consent steps; users may grant read without granting write, and the two MUST be presented as two distinct checkboxes, never a bundled grant. **The consent surface is Commise's own UI, and the grant is stored in Commise's own record — it is NOT the identity provider's consent screen.** Identity is proven by the provider's OAuth flow; authorization (which scopes an agent holds) is owned and enforced by Commise. _(Decision D-001, 2026-05-10; mechanism revised 2026-08-02 — see ADR-0012)_

    > **Why the mechanism changed.** The original wording implied the identity provider would render the two consent checkboxes. It cannot: Clerk supports only a fixed scope set (`profile`, `email`, `public_metadata`, `private_metadata`, `openid`, `user:org:read`) and custom OAuth scopes are not available, so `recipes:read` / `recipes:create` cannot exist as provider scopes. The requirement's **intent is unchanged** — separate, independently grantable, revocable consent — only the surface that renders it and the store that holds it. This also makes revocation immediate (a record update checked per call) rather than bounded by token refresh.

- **FR-019**: System MUST allow recipe owners to request AI-powered optimization of recipe instructions (simplify language or streamline cooking steps). _(Premium)_
- **FR-020**: AI-generated recipes saved by users (whether via in-app generation or external agent) MUST be treated as private, user-owned recipes. Default visibility is always `private`. External agents MUST NOT set visibility to any value other than `private` on initial save; the `recipe_save` MCP tool must reject non-private visibility payloads with `400`. Users may change visibility through the standard recipe settings flow after saving. _(Decision D-004, 2026-05-10)_
- **FR-021**: System MUST allow users to revoke external agent authorizations at any time from their account settings.
- **FR-022**: System MUST display a confidence indicator and guard message on every AI-generated output surface (web and mobile). The standard guard message is: "AI-generated content may be inaccurate. Verify before use." Nutrition-adjacent outputs additionally display: "This is not medical advice. Consult a qualified professional." The guard message is not dismissible on first view; after 3 views it may collapse to an icon with tooltip but cannot be disabled. This requirement is not user-configurable. **The confidence indicator's basis is the FR-023 sanity-validation result plus the generating provider/model identity — it is NOT a model-reported quality score, which we have no reliable way to obtain.** _(Decision D-003, 2026-05-10; resolves W-003 from verify-report.md)_

- **FR-023**: System MUST run deterministic sanity validation on every AI-generated recipe before presenting
  it, and MUST surface any failed check as a **non-blocking warning** on the preview surface (web and mobile).
  Validation covers at minimum: ingredient quantities within plausible ranges for the stated servings; cooking
  temperatures and times within safe bounds; every step referencing only ingredients present in the ingredient
  list; and all required Recipe fields present. The system MUST NOT auto-discard, auto-correct, or block saving
  on a failed check — these are heuristics and the user decides. _(Resolves the low-quality Edge Case,
  2026-08-02)_
- **FR-024**: System MUST allow a user to regenerate from the preview surface without re-entering their
  criteria. Regeneration issues a new generation request against the user's configured provider and is
  therefore **billable to the user's own BYOK account**; the system MUST make that cost implication evident and
  MUST apply the same per-user concurrency and rate limits as an initial generation. _(Resolves the low-quality
  Edge Case, 2026-08-02)_

### Non-Functional Requirements _(constitution-derived)_

- **NFR-001**: All TypeScript MUST compile with `strict: true`; no `any` used outside explicitly marked test doubles. (Constitution Principle I)
- **NFR-002**: All exported functions and interfaces MUST carry JSDoc documentation. (Principle II)
- **NFR-003**: Any UI component MUST expose an accessible name queryable via `getByRole`/`getByLabel` in Playwright tests. (Principles IV & VII)
- **NFR-004**: Color MUST NOT be the sole conveyor of state; icon or text label pairing required. (Principle VII)

### Key Entities

- **AI Provider Config**: Stores a user's BYOK credentials for their chosen AI provider (e.g., OpenAI API key). Encrypted at rest via AWS Secrets Manager (ARN stored in Postgres; raw key never in DB). One active key per provider; up to all three providers (OpenAI, Anthropic, Gemini) may be configured simultaneously. Storing a new key for a provider replaces the existing one. _(Decision D-005, 2026-05-10)_
- **Agent Authorization**: Represents a user's OAuth grant to an external agent platform. Tracks which platform, granted scopes (`recipes:read`, `recipes:create`), grant date, and revocation status. Read and write scopes are granted separately. Users can revoke at any time.

## API Contract & Input Validation (GR-015 / GR-016)

> This section **applies existing portfolio rules to 005's own packages** and **mints no new FR numbers**
> (GR-003), the way 011/012/013/014 do. Where [`plan.md`](./plan.md) already decided something, the decision is
> cited rather than re-made. Every existence claim was checked against the tree on **2026-08-12**.
>
> ⛔ **None of 005's packages exist yet** — verified 2026-08-12: there is no `packages/services/ai-service`, no
> `packages/services/ai-workers`, no `packages/schemas/ai`, and no `packages/clients/ai-service`. That makes
> 005 the feature GR-017 was written for: a **NEW** service owes its authored zod, its `contract:generate`
> script, its committed schema package with a derived `openapi.yaml`, its `CONTRACT_HASH` boot assertion,
> **`nestjs-zod`'s** `ZodValidationPipe`, `z.strictObject()` on mutating bodies, and validated non-HTTP ingress
> **on the day its package is created** — not "when it has clients". 005 therefore starts clean, with no
> `class-validator` residue to inherit and none introduced.

### Contract ownership (GR-015)

_The service authors it; clients declare nothing — and the provider boundary is the sharpest inverted case in
the portfolio._

**Normative sources**: [`docs/CODING_STANDARDS.md` §15](../../docs/CODING_STANDARDS.md) ·
[`GR-015`](../governance-rules.md#gr-015-api-contract-ownership) ·
[`GR-017`](../governance-rules.md#gr-017-contract--validation-conformance-for-every-new-service-client-and-app) ·
[ADR-0014](../../docs/architecture/decisions/0014-service-owned-api-contracts.md). Full bindings:
[`plan.md` → _3.0 Contract ownership and drift_](./plan.md#30-contract-ownership-and-drift-gr-015).

| Role                                                            | Binding for 005                                                                                                                                                                                                           |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Owning service (**authors** the zod)                            | `@kitchensink/ai-service` — `packages/services/ai-service/src/**/*.schema.ts`, beside each controller. **Does not exist yet.**                                                                                            |
| Second deployable in scope                                      | `@kitchensink/ai-workers` — a **consumer** of 005's own job/intake envelope, bound by the client half below. **Does not exist yet.**                                                                                      |
| Schema package (**GENERATED and committed; never hand-edited**) | `@kitchensink/schema-ai` — `packages/schemas/ai`. **Does not exist yet.**                                                                                                                                                 |
| Consuming client                                                | `@kitchensink/ai-service-client` — `packages/clients/ai-service`, scaffolded by this feature's own **T003**. ⚠️ The plan's role table omits it; it is named here so the client half has an owner. **Does not exist yet.** |
| Consuming apps                                                  | `@commise/web`, `@commise/mobile`                                                                                                                                                                                         |
| 005 as a **client** of ours (§15-b)                             | `@kitchensink/recipe-service-client` → `@kitchensink/schema-recipe`; `@kitchensink/food-service-client` → `@kitchensink/schema-food`                                                                                      |
| **Third-party boundaries (§15-d — EXEMPT, inverted)**           | LLM providers via the Vercel AI SDK (Anthropic, OpenAI, Gemini) and Clerk's OAuth 2.1 / dynamic-client-registration surface (ADR-0012)                                                                                    |

**The service MUST** author every BYOK, generation-intake, job-status, **streaming-chunk** and optimize-preview
shape as **zod in `ai-service`** beside its controller; **validate its own requests with that same zod** via
`nestjs-zod`'s `createZodDto`; generate and commit `@kitchensink/schema-ai`; and keep every `*.schema.ts`
importing **only `zod` and other `*.schema.ts` files** — no Nest symbol, no Secrets Manager type, no provider
SDK type.

`@kitchensink/schema-ai` will be a committed **COPY** of that zod — not a transformation, because zod schemas
are runtime values and cannot be derived from themselves, and every package here exports raw `./src/*.ts` so
there is no bundle-into-`dist` path. It exports the **zod**, the **`z.infer` types**, a **`CONTRACT_HASH`**, a
**barrel**, and a **DERIVED `openapi.yaml`** — outbound only, for `oasdiff`, docs and integrators, and **never a
codegen input** (routing types through JSON Schema loses `readonly`, branded and template-literal types and
flattens discriminated unions).

**The CLIENT's obligation — separately mandatory.** Mandating only the service half is exactly how the client
half got skipped portfolio-wide (276 + 144 lines of redeclared wire types survived behind green builds), which
is why 005 states it as its own obligation rather than a consequence.

- Every consumer imports its wire **types AND its runtime zod** from `@kitchensink/schema-ai` and **declares no
  AI-service request or response shape of its own** — including **type-only**, and including inside
  `packages/apps/**` feature packages (GR-015 §15-b.4, GR-017 §17-b.1).
- **⛔ The streaming surface is the load-bearing case, and the chunk envelope is a wire contract 005 OWNS.**
  `POST /api/v1/ai/generate/recipe/stream` emits partial objects then `{ done: true }`. That partial/chunk
  envelope belongs in the schema package: hand-writing it in the web and mobile stream readers is how a chunk
  shape drifts on **two platforms independently**. The zod for a partial is a `Partial` / `.partial()`
  **derivation** of the full shape, **not a second declaration**.
- **`ai-workers` is a consumer too.** It shares the job/intake envelope with `ai-service`; that envelope is
  **authored once** as zod and imported, **never re-declared per deployable** — the two version independently.
- A divergent consumer shape (a preview view model, a job-progress badge model) is **DERIVED** with
  `Pick` / `Omit` / `Partial`, never independently declared. Reference implementation:
  `packages/apps/commise/features/recipes/src/filters/model.ts`.
- **Responses are validated ON RECEIPT by the consumer**, at the moment the body arrives (GR-016 §16-c.3) —
  including each streamed chunk.
- **A new AI endpoint is not complete until its types are reachable from `@kitchensink/schema-ai`.** "The
  preview screen will add the type" is a **contract fork**, not a task.

**CLIENT WORK IS ITS OWN DELIVERABLE, with its own tasks** (GR-017 §17-e.12) — the portfolio's most common
violation, measured across all fourteen feature specs. The schema package, `@kitchensink/ai-service-client`,
receipt validation, and a **contract-skew guard** are **tasks** in [`tasks.md`](./tasks.md), not consequences of
finishing the service. The guard pattern to copy is
`packages/clients/{food-service,recipe-service}/src/contractSkew.ts`.

**Drift gates** — inherited from GR-015 §15-c, all three required, none reinvented here:

1. **Rebuild (turbo):** `$TURBO_ROOT$`-anchored **`inputs`** covering
   `packages/services/ai-service/src/**/*.schema.ts`. ⚠️ **`inputs`, NOT `dependsOn`** — a `dependsOn` edge
   closes the cycle `client → schema → service → client` (as `recipe-service` does by devDepending on its own
   client for the contract test tier) and turbo rejects the graph. Ordering was never the requirement: the
   generated files are committed, so `build` only compiles what is on disk. What is needed is **cache
   invalidation** when an authored schema changes.
2. **Correctness (CI):** regenerate and fail on any diff against the committed artifacts — the strong gate, and
   the only one that catches a hand-edited generated file. `ai-service` declares a `contract:generate` script so
   the repo-wide `contract:verify` discovers it (GR-017 §17-a.2).
3. **Skew (runtime):** the `CONTRACT_HASH` **boot assertion**, which fails the boot on mismatch — the only layer
   that can catch a deployed `ai-service` running ahead of `ai-workers` or a released mobile binary.

⚠️ `oasdiff breaking` is worth adding with its blind spot stated: `@nestjs/swagger` emits **no response
schema** for a handler returning an `interface`, so until every response type is zod-derived that check cannot
see response changes — most of what actually breaks a client. On a **streaming** surface it sees even less.

⛔ **THE THIRD-PARTY EXCEPTION (GR-015 §15-d) — 005's provider boundary is the SHARPEST case in the portfolio.**

- **LLM provider responses** (via the Vercel AI SDK — Anthropic, OpenAI, Gemini, and any future provider) and
  **structured-generation output** **MUST be validated at the boundary with zod** before any field is used,
  logged, or persisted. We do not serve those APIs, cannot author their types, and they change without telling
  us.
- **Clerk's OAuth 2.1 / dynamic-client-registration surface** (ADR-0012, FR-018's mechanism) is likewise
  third-party: validated at the boundary, and its shapes **not folded into `@kitchensink/schema-ai`**.
- These clients **MAY declare their own types**, and the normalized shape we hand onward **deliberately differs**
  from the raw provider payload.
- **No OpenAPI document is written for a provider API we do not serve.**
- **Converging these schemas away would delete the exact parse that keeps prompt-injected or malformed model
  output from reaching `ai-service`'s Clerk-actor-token capability.** That is not a style question on this
  feature — it is the control the security boundary is built on. `packages/clients/usda` is the reference
  implementation and its `schemas.ts` must never be "converged": doing so replaces a **checked parse** with
  **unchecked trust** in a remote party's JSON, a **security regression, not a cleanup**.

⚠️ **Note the asymmetry, because it is easy to get backwards.** A generated recipe that 005 saves goes out
through `recipeServiceClient.createRecipe()`, whose shape **is ours** and **is** governed by §15-b (imported
from `@kitchensink/schema-recipe`, never re-declared). The model's raw output on the way **in** is §15-d. **Same
request path, opposite rules.**

### Input validation — where that zod RUNS (GR-016)

**Normative sources**: [`docs/CODING_STANDARDS.md` §15.4](../../docs/CODING_STANDARDS.md) ·
[`GR-016`](../governance-rules.md#gr-016-input-validation-at-every-boundary) ·
[`GR-017`](../governance-rules.md#gr-017-contract--validation-conformance-for-every-new-service-client-and-app) ·
[`GR-018`](../governance-rules.md#gr-018-one-rejection-path-and-invalid-input-is-never-retried) ·
[ADR-0015](../../docs/architecture/decisions/0015-input-validation-at-every-boundary.md). Full bindings:
[`plan.md` → _3.0a Input validation_](./plan.md#30a-input-validation-gr-016--and-model-output-is-input-not-a-response).
The section above decides **who authors** the contract; this one is where it **runs**. It adds no FR (GR-003) —
FR-020's private-visibility rejection, FR-023's sanity validation and FR-024's limits already state their
requirements.

- **One mechanism, one `400`.** Every BYOK, generation-intake, job-status, streaming and optimize-preview
  input — body, path params, query params, `Idempotency-Key` — is parsed by `ai-service`'s own `*.schema.ts` zod
  via `createZodDto` + **`nestjs-zod`'s** `ZodValidationPipe`, registered on the **`APP_PIPE`** token. A new
  service starts with **one** mechanism and keeps it: `@Body() body: unknown` plus a per-method `safeParse` is
  not a validation strategy, because it relocates the parse into the method body where it is **optional by
  construction** and gets skipped on the next endpoint.
- **⚠️ The pipe hazard is invisible in review, so state the pipe and TEST it.** Under Nest's **own** built-in
  `ValidationPipe`, a `createZodDto` DTO **validates nothing while looking correctly wired** — the schema is
  present, the DTO is referenced, the route reads as validated, and no input is checked. It already bit
  identity's `PATCH /users/me`, a route that writes user data. The **only** thing that catches it is a test that
  posts a **known-bad body to a real route** and asserts the `400`. On 005 the route to write that test against
  first is `POST /api/v1/ai/byok/keys`.
- **`z.strictObject()` for every mutating request body** — the portfolio default, ruled 2026-08-12 in GR-017
  §17-c, which **closes OPEN-GR-016-B** (the plan still records it as OPEN; it is not). Plain `z.object()`
  survives only on a **read** surface with a **documented forward-compatibility reason at the schema**. The
  ruling picks the failure that is **visible**: on a mutating body a silently stripped unknown key is a `200`
  plus a partial write the caller was told succeeded. As a **new** service, 005 has no legacy `z.object()` to
  migrate — it starts strict.
- **⚠️⚠️ MODEL OUTPUT IS _INPUT_, NOT A RESPONSE — and parsing it is NOT the deferred work of GR-016 §16-g.**
  This is the single sharpest point in 005's contract posture. An LLM's output arrives from a party we do not
  control, so it is parsed at the boundary **exactly like any other untrusted upstream body** (§15-d), before any
  field is used, logged, or persisted. §16-g defers **the bodies `ai-service` EMITS**; it says nothing about the
  bodies a **provider** emits, and reading it as licence to skip the provider parse inverts the rule. GR-017
  §17-f exists to keep the two apart: a **consumer** parsing what it **received** is REQUIRED; a **producing
  service** parsing what it **emits** is DEFERRED.
- **⛔ THE STORAGE FLOOR, reached THROUGH the model.** A generated recipe saved via
  `recipeServiceClient.createRecipe()` writes 001's `integer` (`int4`) columns — **`servings`,
  `prepTimeMinutes`, `cookTimeMinutes`, `totalTimeMinutes`, `timerSeconds`**, capped at **2,147,483,647**. An LLM
  is a very plausible source of `servings: 9999999999`, and structured-output mode **does not bound magnitudes**.
  So the structured-generation schema **carries those bounds** (as a `Partial`-style **derivation** of the recipe
  wire zod, never a second declaration), and the outbound `createRecipe` body is validated against
  `@kitchensink/schema-recipe` **before the call** (GR-016 §16-c.2). A model-produced out-of-range integer must
  fail as a **generation-quality error we own** — surfaced through FR-023's sanity validation — never as a `500`
  from the recipe service's `INSERT`.
    - ⚠️ **This is an ASSERTION between two independently authored artifacts, NEVER a derivation.** Zod is
      **not** generated from drizzle and a `*.schema.ts` **never imports a storage type** — GR-015 §15-a.5 is
      unchanged. Enforcement is the per-service parity test GR-017 §17-d requires, over the shared machinery
      already in `@kitchensink/contract-gen` (`src/storage-capacity.ts`), which **derives** the bounded-column
      set from the drizzle tables via `collectBoundedColumns` and requires a stated `why` for each exemption, with
      mapping completeness asserted **in both directions**. `ai-service`'s own bounded columns — provider enum,
      job status enum, retry/attempt counters — are in scope the day the table exists.
    - ⚠️ **A floor is not a target.** Prompt and preview text will sit in PostgreSQL `text()` columns, i.e.
      **unbounded**, so **prompt/intake bounds are a product decision 005 owns** — and they are part of the
      **contract**, not a runtime guard: input length, attachment count and any list arity that drives provider
      spend belong in the intake zod so a client sees the same limit the service enforces. **Unbounded free text
      on a METERED path is a cost incident**, not merely a validation gap (FR-024 makes regeneration billable to
      the user's own BYOK account).
- **BYOK bodies: validate the SHAPE, never echo the VALUE.** `POST /api/v1/ai/byok/keys` accepts a
  provider-scoped secret. The schema bounds the provider enum, key shape and length; the validation **error must
  not** include the offending value, and **no key material appears in a `400` body or a log line**. This is the
  request-side half of the rule that the response carries metadata and never the key.
- **FR-020's visibility rejection belongs in the TYPE, not a branch.** An external agent MUST NOT set any
  visibility other than `private` on initial save. Prefer making the illegal state **unrepresentable** in the
  `recipe_save` tool's wire schema over a refinement someone can forget — the same pattern
  `004-FR-025`'s provenance whitelist uses. The `400` is then the schema's, on the one rejection path.
- **Non-HTTP ingress this feature owns, enumerated** (a Nest pipe reaches none of them): the **generation job
  queue** between `ai-service` (intake, `202`) and `@kitchensink/ai-workers`. The worker **parses the job/intake
  envelope on receipt** against the same authored zod the service publishes — "the service put it on the queue"
  is an assumption about a **deploy**, and the two deployables version independently. **An invalid payload is
  NEVER retried** (GR-018 §18-b): there is no caller to answer, so a shape rejection is recorded with its
  `reason` and the message is **completed or dead-lettered once**, with an alarm on DLQ depth. The legitimate
  retry is a **transient dependency** failure — a provider `5xx`, a rate-limit `429`, a database timeout — which
  is a different condition with a different `reason`.
- **⚠️ 005 exposes no third-party webhook today**, so GR-018 §18-c's `2xx` inversion does not currently bind it:
  every ingress above is either **our own caller** (which gets the `400`/`403` GR-016 §16-a.3 requires, because
  our callers do not blind-retry) or a **queue consumer with no caller** (which dead-letters). If a provider
  completion callback is ever added, it needs **both** controls in that order — **authenticate it, then validate
  its schema** — because a signature proves **origin, not shape**.
- **Identifiers are never sentinels (GR-019).** `jobId`, the provider key's ARN reference, the agent
  authorization id and the owner `sub` are typed **required** wherever consumed — never optional-with-a-default,
  never `'unknown'`, `''` or `0`, including as a map key, a **metrics dimension** (which matters here because
  spend is attributed per user) or a branch condition. The **only** paths where an absent id is permitted are
  **create/upsert** — a generation job's id, an agent authorization record — where the id is **generated** as a
  ULID. An unresolvable principal is a **rejection**, never a default: when the id is a principal, defaulting it
  means the **authorization decision was made by a string literal**, which is precisely the hole ADR-0012's
  actor-token bridge must not open.
- **⛔ Server-side RESPONSE validation on `ai-service`'s OWN responses is DEFERRED by owner decision (GR-016
  §16-g) and MUST NOT be "completed"** — and it must not be conflated with the provider-boundary parse above,
  which is **required**. Each emitted chunk conforms to the authored partial envelope, and a **client** parsing
  chunks with the schema package's zod is the **receipt-side** parse §16-c.3 requires of consumers, not the
  deferred emission-side one. Reversing the deferral needs its own proposal under the governance amendment
  process.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-003**: AI-generated recipes are returned to the user within 15 seconds of the request.

## Assumptions

- AI integration operates in two directions: (1) **BYOK in-app** — users store their own AI provider API keys (OpenAI, Gemini, Anthropic, etc.) and Commise calls the provider on their behalf; (2) **External agent platform** — Commise exposes an OAuth 2.0 API that custom agents on platforms like ChatGPT and Gemini use to read/write recipes on behalf of authorized users.
- External agent platform integrations (ChatGPT GPT Actions, Gemini Extensions, etc.) will conform to each platform's required auth flow, which is typically OAuth 2.0 authorization code.

## Clarifications

- **C-002 (AI Integration Model)**: AI integration operates as two distinct patterns: **(1) BYOK in-app** — users configure their preferred AI provider (OpenAI, Gemini, Anthropic) by storing their own API credentials; Commise calls the provider to generate recipes within the app. **(2) External agent platform** — Commise exposes an OAuth 2.1 API so custom agents on ChatGPT, Gemini, etc. can read the user's recipe collection and create recipes on their behalf. Users must explicitly authorize agents via OAuth consent and can revoke access at any time. Read (`recipes:read`) and write (`recipes:create`) scopes require separate consent steps. Both directions produce private, user-owned recipes. _(D-001, D-004)_
