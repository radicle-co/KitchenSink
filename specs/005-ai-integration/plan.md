# Technical Plan: AI Integration (Feature 005)

**Feature**: `005-ai-integration`
**Phase**: 5 — Product Forge Plan
**Status**: Draft — rewritten 2026-08-02 against the shipped codebase and ADR-0012
**Stack**: TypeScript 5.x, Node.js 24.x, NestJS 11, Drizzle ORM, pg, Vercel AI SDK, AWS Secrets Manager, SQS, Clerk

> **Rewrite note (2026-08-02).** The previous revision (2026-05-10) targeted a codebase that no longer
> exists: it keyed every table off `users(sub)`, a column removed by identity migration `0005`, and
> declared foreign keys to `recipes` / `meal_plans`, which live in **other services' databases**. Both were
> unbuildable. This revision replaces the data model, adopts the composition architecture (005 calls the
> other services rather than writing their tables), adopts `/api/v1/*` per `docs/api-conventions.md`, and
> adds the pattern register that CLAUDE.md requires and the previous revision omitted entirely.

---

## 1. Architecture Overview

### 1.1 Design Principles

- **BYOK-first**: the platform never pays for AI API calls. Users bring their own keys.
- **Composition, not duplication**: 005 owns no recipe, food, or meal-plan data. It **calls** the services
  that own them. There are no cross-service foreign keys anywhere in this feature.
- **Provider-agnostic**: the Vercel AI SDK is the provider adapter. We do not build a second one.
- **Privacy-by-default**: PII never reaches a provider. Prompts are sanitized before construction.
- **Separation of capability from untrusted input** (§1.2): the component that can act as a user never
  processes model output.
- **EU AI Act transparency**: disclosure on every AI-generated surface (FR-022).

### 1.2 Two deployables, and why

| Package                   | Responsibility                                                                        | Holds the Clerk mint key? | Processes untrusted model output? |
| ------------------------- | ------------------------------------------------------------------------------------- | ------------------------- | --------------------------------- |
| `@kitchensink/ai-service` | MCP/OAuth server, agent grants, BYOK key management, generation job intake            | **Yes**                   | **No**                            |
| `@kitchensink/ai-workers` | SQS-driven generation: provider calls, streaming, writing results via service clients | **No**                    | **Yes**                           |

This mirrors the existing `recipe-service` / `recipe-workers` split, so it introduces no new deployment
shape.

**The split is a security boundary, not packaging taste.** ADR-0012 gives `ai-service` the ability to mint
an actor-token session for any user. If the same process also fed user-supplied prompts to an AI provider
and parsed the result, a prompt-injection or SSRF chain would land directly on that capability. Keeping
generation in a worker that has **no** Clerk secret key means the component handling untrusted content
cannot impersonate anyone. Do not merge these two packages.

### 1.3 System Context

```
┌──────────────────────────────────────────────────────────────┐
│  Clients                                                     │
│  [Web] [Mobile]        [External agents: ChatGPT / Claude]   │
└─────────┬──────────────────────────┬─────────────────────────┘
          │ Clerk session token      │ Clerk OAuth access token (DCR)
          ▼                          ▼
┌──────────────────────────────────────────────────────────────┐
│  @kitchensink/ai-service            (ALB priority 400)       │
│                                                              │
│  ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌──────────────┐  │
│  │ByokModule │ │McpModule  │ │GrantPolicy│ │ IntakeModule │  │
│  │(Secrets)  │ │(OAuth2.1) │ │(scopes)   │ │ (enqueue)    │  │
│  └───────────┘ └───────────┘ └───────────┘ └──────────────┘  │
│           owns: kitchensink_ai  ·  CAN mint actor sessions   │
└───────┬──────────────────────────────────────┬───────────────┘
        │ actor-token session                  │ SQS
        ▼                                      ▼
┌────────────────────────┐        ┌──────────────────────────────┐
│ recipe-service         │        │ @kitchensink/ai-workers      │
│ food-service           │◄───────┤ Vercel AI SDK · sanitizer    │
│ (unchanged)            │ clients│ NO Clerk mint key            │
└────────────────────────┘        └──────────────────────────────┘
```

### 1.4 What 005 does NOT own

`recipes`, `ingredients`, `foods`, `meal_plans`, `shopping_lists`. All reads and writes go through
`@kitchensink/recipe-service-client` and `@kitchensink/food-service-client`. Where a downstream service
does not exist yet (006 meal-planning, 007 grocery lists), the call site is **stubbed and registered** in
[`downstream-gaps.md`](./downstream-gaps.md) so the gap becomes a requirement on that feature rather than
an invented table here.

---

## 2. Data Model

005 owns exactly one logical database, `kitchensink_ai`, following the per-service pattern
(`kitchensink_recipes`, food). **No table in this feature references a table owned by another service.**

Ownership is keyed by the **app ULID** (`users.id` in identity), carried in the verified token. It is
stored as `user_id TEXT` with **no foreign key** — identical to the deliberate choice recipe-service made
(`recipes.owner_id`, "No FK, no local users table (D2)"). A cross-database FK is not expressible.

### 2.1 `ai_generation_records`

Audit and provenance for every generation request (FR-022, EU AI Act).

```sql
CREATE TABLE ai_generation_records (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              TEXT NOT NULL,              -- app ULID; no FK (cross-service)
  job_id               UUID NOT NULL UNIQUE,
  idempotency_key      TEXT NOT NULL UNIQUE,       -- SQS is at-least-once; see §5.1
  generation_type      TEXT NOT NULL CHECK (generation_type IN
                         ('recipe','meal_plan','shopping_list','recipe_optimization')),
  status               TEXT NOT NULL DEFAULT 'pending' CHECK (status IN
                         ('pending','streaming','complete','failed')),
  provider             TEXT NOT NULL CHECK (provider IN ('openai','anthropic','gemini')),
  model_id             TEXT,
  input_token_count    INT,
  output_token_count   INT,
  estimated_cost_usd   NUMERIC(8,6),
  source_prompt_hash   TEXT,                       -- SHA-256 of the sanitized prompt; no raw prompts
  output_entity_id     TEXT,                       -- opaque id returned by the owning service
  output_entity_kind   TEXT CHECK (output_entity_kind IN ('recipe','meal_plan','shopping_list')),
  acted_via_agent      TEXT,                       -- MCP client_id when the call came from an agent
  error_message        TEXT,
  started_at           TIMESTAMPTZ DEFAULT NOW(),
  completed_at         TIMESTAMPTZ,
  created_at           TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_ai_gen_user   ON ai_generation_records(user_id);
CREATE INDEX idx_ai_gen_job    ON ai_generation_records(job_id);
CREATE INDEX idx_ai_gen_status ON ai_generation_records(status);
```

`output_entity_id` is `TEXT`, not a typed FK — the entity lives in another service's database.
`provider` drops the previous revision's `byok_*` variants: BYOK is a property of the key, not the vendor,
and the old CHECK omitted `byok_gemini` while §7 silently dropped the constraint entirely.

### 2.2 `user_byok_keys`

Only the Secrets Manager ARN. The raw key is never in Postgres.

```sql
CREATE TABLE user_byok_keys (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     TEXT NOT NULL,
  provider    TEXT NOT NULL CHECK (provider IN ('openai','anthropic','gemini')),
  secret_arn  TEXT NOT NULL,
  key_version INT NOT NULL DEFAULT 1,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT user_byok_keys_user_provider_unique UNIQUE (user_id, provider)
);
```

> **Fixes a defect that would have broken approved decision D-005.** The previous revision declared
> `user_sub ... NOT NULL UNIQUE`, a **column-level** unique — one key per _user_. D-005 approved one key
> per _provider_, up to three at once, and asserted the schema "already enforces uniqueness on
> `(user_id, provider)`". It did not. The composite constraint above is the one D-005 describes.

### 2.3 `mcp_agent_grants`

Our authorization record for an external agent. **Renamed** from `mcp_oauth_consents` because ADR-0012
makes this grant _ours_, not Clerk's OAuth consent — the two are now distinct things and must not share a
name.

```sql
CREATE TABLE mcp_agent_grants (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      TEXT NOT NULL,
  client_id    TEXT NOT NULL,                 -- DCR-issued OAuth client
  client_label TEXT,                          -- display name for the settings UI
  scopes       TEXT[] NOT NULL,               -- our scopes: 'recipes:read', 'recipes:create'
  granted_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at   TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  revoked_at   TIMESTAMPTZ,                   -- NULL = active; set = revoked (FR-021)
  CONSTRAINT mcp_agent_grants_user_client_unique UNIQUE (user_id, client_id)
);

CREATE INDEX idx_mcp_grants_user   ON mcp_agent_grants(user_id);
CREATE INDEX idx_mcp_grants_active ON mcp_agent_grants(user_id, client_id) WHERE revoked_at IS NULL;
```

`revoked_at TIMESTAMPTZ` replaces the previous `is_revoked BOOLEAN`: it records _when_, which the audit
trail needs, and makes the partial index above expressible. Scope names are **ours** — Clerk does not
support custom OAuth scopes (ADR-0012).

### 2.4 `prompt_templates`

Versioned system prompts. `created_by` is retained for the V2 user-fork path (OQ-4) but not exercised in
V1.

```sql
CREATE TABLE prompt_templates (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_key          TEXT NOT NULL,
  version               INT  NOT NULL DEFAULT 1,
  system_prompt         TEXT NOT NULL,
  user_prompt_template  TEXT NOT NULL,
  model_recommendations TEXT[],
  is_active             BOOLEAN NOT NULL DEFAULT true,
  created_by            TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT prompt_templates_key_version_unique UNIQUE (template_key, version)
);
```

The previous revision declared `template_key TEXT NOT NULL UNIQUE` **and** a unique `(template_key,
version)` index — mutually contradictory, since the column-level unique makes versioning impossible. Only
the composite constraint survives.

---

## 3. API Contracts

All endpoints are served under `/api/v1/*` per [`docs/api-conventions.md`](../../docs/api-conventions.md)
(GR-002), via `app.setGlobalPrefix('api/v1', { exclude: ['health'] })`. `/health` stays unprefixed — ECS
and ALB health checks target it.

### 3.0 Contract ownership and drift (GR-015)

**Normative sources**: [`docs/CODING_STANDARDS.md` §15](../../docs/CODING_STANDARDS.md) ·
[`GR-015`](../governance-rules.md#gr-015-api-contract-ownership) ·
[ADR-0014](../../docs/architecture/decisions/0014-service-owned-api-contracts.md). Bindings for this feature
only; the rule lives there and wins on any detail.

| Role                                  | Binding for 005                                                                                                                      |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Owning service (**authors** the zod)  | `@kitchensink/ai-service` — `packages/services/ai-service/src/**/*.schema.ts`, beside each controller                                |
| Schema package (generated, committed) | `@kitchensink/schema-ai` — `packages/schemas/ai` — **new package, does not exist yet**                                               |
| Consuming clients / apps              | `@commise/web`, `@commise/mobile`; `@kitchensink/ai-workers` for the intake/job shapes it shares with the service                    |
| 005 as a **client** of others (§15-b) | `@kitchensink/recipe-service-client` → `@kitchensink/schema-recipe`; `@kitchensink/food-service-client` → `@kitchensink/schema-food` |

**The service MUST**: author every BYOK, generation-intake, job-status, streaming-chunk and optimize-preview
shape as zod in `ai-service` beside its controller; validate its own requests with that same zod via
`nestjs-zod`'s `createZodDto`; generate and commit `@kitchensink/schema-ai`; derive `openapi.yaml` from the zod
(outbound only — never a codegen input); and keep every `*.schema.ts` importing **only `zod` and other
`*.schema.ts` files** — no Nest symbol, no Secrets Manager type, no provider SDK type.

**Every client MUST** (separately mandatory): import its wire types **and** zod from `@kitchensink/schema-ai`
and **declare no AI-service request or response shape of its own**. Two cases carry real risk here:

- **The streaming surface.** `POST /api/v1/ai/generate/recipe/stream` emits partial objects then
  `{ done: true }`. The **partial/chunk envelope is a wire shape** and belongs in the schema package —
  hand-writing it in the web and mobile stream readers is how a chunk shape drifts on two platforms
  independently. The zod for a partial is a `Partial`/`.partial()` **derivation** of the full shape, not a
  second declaration.
- **`ai-workers` is a consumer too.** It shares the job/intake envelope with `ai-service`; that envelope is
  authored once as zod and imported, never re-declared per deployable.
- A divergent consumer shape (a preview view model, a job-progress badge model) is **DERIVED** with
  `Pick` / `Omit` / `Partial`. Reference: `packages/apps/commise/features/recipes/src/filters/model.ts`.
- **A new AI endpoint is not complete until its types are reachable from `@kitchensink/schema-ai`.**

**Drift gates** — inherited from GR-015 §15-c, all three: turbo `inputs` rebuild, regenerate-and-diff CI gate,
`CONTRACT_HASH` boot assertion.

### ⛔ 005's provider boundary is the SHARPEST third-party case in the portfolio (GR-015 §15-d)

**Model output is untrusted input by this plan's own §1.2 security boundary.** Everything on the provider side
is governed by §15-d, not §15-b:

- **LLM provider responses** (via the Vercel AI SDK — Anthropic, OpenAI, and any other) and **structured
  generation output** MUST be **validated at the boundary with zod** before any field is used, logged, or
  persisted. We do not serve those APIs, cannot author their types, and they change without telling us.
- **Clerk's OAuth 2.1 / dynamic-client-registration surface** (ADR-0012) is likewise third-party: validated at
  the boundary, its shapes not folded into `@kitchensink/schema-ai`.
- These clients **MAY declare their own types**, and the normalized shape we hand onward deliberately differs
  from the raw provider payload.
- **No OpenAPI document is written for a provider API we do not serve.**
- **Converging these schemas away would delete the exact parse that keeps prompt-injected or malformed model
  output from reaching `ai-service`'s Clerk-actor-token capability.** On this feature that is not a style
  question — it is the control §1.2 is built on. `packages/clients/usda` is the reference pattern.

⚠️ **Note the asymmetry, because it is easy to get backwards:** a generated recipe that 005 saves goes through
`recipeServiceClient.createRecipe()`, whose shape **is** ours and **is** governed by §15-b (imported from
`@kitchensink/schema-recipe`, never re-declared). The model's raw output on the way in is §15-d. Same request
path, opposite rules.

### 3.0a Input validation (GR-016) — and model output is INPUT, not a response

**Normative sources**: [`docs/CODING_STANDARDS.md` §15.4](../../docs/CODING_STANDARDS.md) ·
[`GR-016`](../governance-rules.md#gr-016-input-validation-at-every-boundary) ·
[ADR-0015](../../docs/architecture/decisions/0015-input-validation-at-every-boundary.md). §3.0 decides **who
authors** the zod; GR-016 decides **where it runs**. Bindings for this feature only.

- **One mechanism, one `400`.** Every BYOK, generation-intake, job-status, streaming and optimize-preview
  input — body, path params, query params, `Idempotency-Key` — is parsed by `ai-service`'s own `*.schema.ts`
  zod via `createZodDto` + **`nestjs-zod`'s** `ZodValidationPipe`. New services start with one mechanism; there
  is no `class-validator` residue to inherit here, and none is introduced.
- **⚠️ A model's output is INPUT to us — validating it is 16-a/16-d work, NOT the response validation GR-016
  §16-g defers.** §1.2 already treats model output as untrusted and §3.0 requires the provider boundary parse;
  GR-016 makes it **mandatory** before any field is used, logged, or persisted. Do not let §16-g's deferral be
  read as licence to skip it: §16-g is about **the bodies `ai-service` emits**, not the bodies a provider
  emits.
- **⛔ THE FLOOR, reached through the model.** A generated recipe saved via
  `recipeServiceClient.createRecipe()` writes 001's `integer` (`int4`) columns — **`servings`,
  `prepTimeMinutes`, `cookTimeMinutes`, `totalTimeMinutes`, `timerSeconds`**, capped at **2,147,483,647**. An
  LLM is a very plausible source of `servings: 9999999999`, and structured-output mode does not bound
  magnitudes. So the **structured-generation schema carries those bounds** (it is a `Partial`-style derivation
  of the recipe wire zod, per §3.0, not a second declaration), and the outbound `createRecipe` body is
  validated against `@kitchensink/schema-recipe` **before the call**. A model-produced out-of-range integer
  must fail as a **generation-quality error we own**, never as a `500` from the recipe service's `INSERT`.
- **Prompt/intake bounds are part of the contract**, not a runtime guard: input length, attachment count and
  any list arity that drives provider spend belong in the intake zod so a client sees the same limit the
  service enforces. Unbounded free text on a **metered** path is a cost incident, not just a validation gap.
- **BYOK bodies: validate the shape, never echo the value.** `POST /api/v1/ai/byok/keys` accepts a
  provider-scoped secret. The schema bounds provider enum, key shape and length; the validation **error must
  not** include the offending value, and no key material appears in a `400` body or a log line. (§3.1 already
  states the response carries metadata, never the key — this is the request-side half of that rule.)
- **Non-HTTP ingress is in scope.** `@kitchensink/ai-workers` **parses the job/intake envelope on receipt**,
  against the same authored zod the service publishes (§3.0). "The service put it on the queue" is an
  assumption about a deploy, and the two deployables version independently.
- **Streaming is a validated surface too.** Each emitted chunk conforms to the authored partial envelope; a
  client parsing chunks with the schema package's zod is the receipt-side parse GR-016 §16-c.3 requires of
  consumers — again, not the deferred server-side response validation.
- **Unknown keys are a stated choice per surface** (`z.object` strips silently; `z.strictObject` rejects).
  Portfolio default is **OPEN** (GR-016 OPEN-GR-016-B).
- **⛔ Response validation on `ai-service`'s own responses is DEFERRED (GR-016 §16-g).** Do not add it, and do
  not conflate it with the provider-boundary parse above.

### 3.1 BYOK key management (`ai-service`)

| Method   | Path                             | Behaviour                                                                                                     |
| -------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `POST`   | `/api/v1/ai/byok/keys`           | Validate → test-call the provider → write to Secrets Manager → store ARN. `201` with metadata, never the key. |
| `GET`    | `/api/v1/ai/byok/keys`           | Metadata only.                                                                                                |
| `DELETE` | `/api/v1/ai/byok/keys/:provider` | Delete from Secrets Manager, then the row. `204`.                                                             |

### 3.2 Generation (`ai-service` intake → `ai-workers`)

| Method | Path                                | Behaviour                                                                  |
| ------ | ----------------------------------- | -------------------------------------------------------------------------- |
| `POST` | `/api/v1/ai/generate/recipe`        | `202 { jobId, status, estimatedWaitSeconds }`. Requires `Idempotency-Key`. |
| `GET`  | `/api/v1/ai/generate/recipe/:jobId` | Job status; `404` if not the caller's job.                                 |
| `POST` | `/api/v1/ai/generate/recipe/stream` | `text/event-stream`; partial objects then `{ done: true }`.                |
| `POST` | `/api/v1/ai/generate/meal-plan`     | **Stubbed** — `downstream-gaps.md` DG-001 (006).                           |
| `POST` | `/api/v1/ai/generate/shopping-list` | **Stubbed** — `downstream-gaps.md` DG-002 (007).                           |
| `POST` | `/api/v1/ai/recipes/:id/optimize`   | Premium-gated (D-002). Returns a preview; never auto-saves.                |

Saving a previewed recipe is **not** a local insert: `ai-service` calls
`recipeServiceClient.createRecipe()` with `visibility: 'private'` (FR-020 / D-004).

### 3.3 Prompt templates (admin)

`GET /api/v1/ai/prompts`, `PUT /api/v1/ai/prompts/:templateKey` — admin scope required via the existing
`ScopesGuard` + `@RequireScopes` pattern.

### 3.4 Agent grants (FR-021)

| Method   | Path                                | Behaviour                                           |
| -------- | ----------------------------------- | --------------------------------------------------- |
| `GET`    | `/api/v1/ai/agents`                 | Active grants for the settings UI.                  |
| `POST`   | `/api/v1/ai/agents/:clientId/grant` | Writes the two-checkbox consent result (D-001).     |
| `DELETE` | `/api/v1/ai/agents/:clientId`       | Sets `revoked_at`. Effective on the next tool call. |

### 3.5 MCP server — per ADR-0012

**Read [`ADR-0012`](../../docs/architecture/decisions/0012-mcp-agent-credential-bridge.md) before changing
anything in this section.** What it fixes: Clerk cannot express our scopes (no custom OAuth scopes), so
Clerk proves _identity_ and we own the _grant_.

**Discovery** — RFC-mandated, served at the domain root, **unprefixed**:

- `GET /.well-known/oauth-protected-resource` — RFC 9728 metadata.
- `GET /.well-known/oauth-authorization-server` — the Clerk instance's AS metadata.

**Protocol**: `POST /api/v1/ai/mcp` — JSON-RPC 2.0, single and batch. Unknown method → `-32601`.

**Auth chain** (each step is a test case in `tasks.md`):

1. Agent presents a Clerk **OAuth access token**; verified via `@clerk/mcp-tools`, yielding the user id.
   Dynamic Client Registration **must be enabled** on the instance.
2. `GrantPolicy` loads `mcp_agent_grants` for `(user_id, client_id)`. Missing, revoked, or expired → deny.
   It fails **closed**: a database error is a denial, never an allow.
3. The tool's required scope is checked against the grant. `recipe_save` requires `recipes:create`.
4. To call downstream, `ai-service` mints a **Clerk actor token** (`actor.sub` = its machine identity) and
   uses the resulting session token. Downstream services verify it with their existing
   `@kitchensink/clerk-verify` path — **no change to their trust model**.

**Tools**: `recipes_list`, `recipe_get`, `recipe_save`, `ingredient_search` (V1); `meal_plans_list`,
`meal_plan_get` are **stubbed** pending 006 (DG-001).

**The `azp` seam.** An actor-token session carries no browser-origin `azp`. Admission reuses the existing
mechanism — `assertAzpMatchesPattern` admits an `azp`-less token only on a **positive claim signal** — via
a sibling of `isNativeClientToken` keyed on the `act` claim **and scoped to our actor `sub`**. Keying on
bare `act` presence would admit any impersonated session, including support-staff impersonation. Do not
loosen this to "azp absent → allow"; that is the bypass the gate exists to prevent.

---

### 3.6 The `/api/v1/*` migration already SHIPPED — 005 inherits it, it does not perform it

**This section previously scoped the migration into 005. That work landed on `main` first** (ADR-0011,
`docs/architecture/decisions/0011-api-version-prefix.md`; commits `daac10c6`, `9658ed05`, `22e8ef15`,
`ac06d703`, `dcd13187`, `1422c4b8`). What was a prerequisite is now a constraint to conform to, so the
section is rewritten rather than deleted — the reasoning that made it a blocker is still the reasoning
that makes the remaining items load-bearing.

**What shipped, and how it differs from what this section originally prescribed:**

| Surface                                                                  | Shipped state                                                                     |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| `recipe-service`, `food-service`, `identity` controllers                 | Canonically `/api/v1/*`, with the bare `/v1/*` retained as a **deprecated alias** |
| `@kitchensink/recipe-service-client`, `@kitchensink/food-service-client` | Dial `/api/v1/*`                                                                  |
| Web + mobile                                                             | Dial `/api/v1/*`                                                                  |
| Playwright interception (`tests/e2e/utils/recipeApi.ts`)                 | Glob is `**/api/v1/**`                                                            |
| k6 (`packages/tools/loadtest/`), CI probes, post-deploy food smoke       | On `/api/v1/*`                                                                    |
| `/health`                                                                | Still unprefixed, as this section required                                        |

**The mechanism is NOT `setGlobalPrefix`.** This section originally prescribed
`setGlobalPrefix('api/v1', { exclude: ['health'] })`. What shipped is a **dual-path controller** —
`@Controller(['api/v1/foods', 'v1/foods'])` — because a global prefix serves exactly one shape and would
have broken every already-shipped consumer. That difference matters to 005: a global prefix added later
would silently drop the alias.

**The alias is deliberate and is not 005's to retire.** It exists because its consumers cannot be fixed by
redeploying this repo — already-shipped mobile builds and cached web bundles have their endpoints inlined
from build-time `NEXT_PUBLIC_*` values, the Clerk dashboard holds the webhook URL, and
`POST /v1/internal/account/erasure` is dialed service-to-service by independently-deployed identity
Lambdas. Both halves are pinned by tests that fail if either path disappears:
`packages/services/recipe-service/src/common/__tests__/api-route-paths.test.ts`,
`packages/services/identity/tests/api-route-paths.test.ts`, and the over-the-wire
`packages/services/identity/tests/e2e/deprecated-path-alias.e2e.test.ts`. **Retiring the alias is a
separate decision with its own consumer-drain evidence, tracked against ADR-0011 — it is explicitly OUT
of 005's scope.**

**What actually remains for 005** is conformance of its OWN surface, which is much narrower:

1. **Every new 005 endpoint is born canonical `/api/v1/*`** — `/api/v1/ai/*` and the MCP surface. They get
   **no bare-`/v1/` alias**: nothing has ever shipped on them, so there is no legacy consumer to protect,
   and minting an alias for a brand-new path manufactures exactly the debt ADR-0011 is trying to retire.
2. **005's clients, mocks and load scripts are written against `/api/v1/*` from the start** — there is no
   migration step, only a convention to follow.
3. **The Playwright hazard is now inverted.** The interception glob is `**/api/v1/**`, and Clerk's Frontend
   API serves at the bare `/v1/*`, so Clerk requests no longer enter the handler. Any 005 suite that
   _widens_ a route glob back toward `**/v1/**` recaptures Clerk, 404s `getToken()`, and hangs every
   request awaiting a token. The pass-through reasoning is recorded in `recipeApi.ts` — do not widen the
   glob without restoring it.

**Correction to this section's original table:** it listed `identity-service` as serving `v1/account`.
It does not — identity serves `api/v1/users` and `api/v1/admin/users`; `account` is recipe-service's
(`api/v1/account`). DG-004's subscription-tier lookup reads `accounts.subscription_tier` and is deferred
to feature 010 regardless, so no identity endpoint moves for 005.

### 3.7 Sanity validation and regenerate (FR-023 / FR-024)

Resolves the low-quality Edge Case. Two mechanisms, and deliberately not a third.

**`RecipeSanityValidator` — a pure Specification/policy module.** It takes a generated draft and returns a
list of findings; it has no I/O and makes no decisions. Checks are deterministic and bounded:

| Check                 | Rule                                                                  |
| --------------------- | --------------------------------------------------------------------- |
| Quantity plausibility | Per-ingredient amount within a plausible band for the stated servings |
| Thermal bounds        | Cooking temperature and time within safe cooking ranges               |
| Referential integrity | Every ingredient named in a step exists in the ingredient list        |
| Structural            | All required Recipe fields present (delegated to the 001 contract)    |

**It is advisory, and that is enforced structurally.** The validator returns findings; only the preview
layer decides what to render. It has no path to discard, mutate, or block a save. This is why it is a pure
function returning data rather than a guard returning a verdict — a heuristic must not be able to delete a
result the user may want. `SCN-016-A5` asserts a draft failing every check still saves.

**This is also what makes FR-022's confidence indicator honest.** The indicator displays the validation
result plus the generating provider/model — both things we actually know. It is explicitly **not** a
model-reported quality score; we have no reliable way to obtain one, and implying otherwise would be
false precision on a compliance-adjacent surface.

**Regenerate** re-runs generation against the stored criteria for a job. It is a new provider call spending
the user's own BYOK credit, so it carries the same `Idempotency-Key` discipline, the same one-concurrent-
generation-per-user limit (`429`), and the same monthly quota as an initial request. The superseded draft is
discarded without persistence — FR-017/REQ-006 semantics are unchanged by a retry.

**Accepted limitation, stated in the spec:** this catches implausible _values_, not bad _cooking_. A
technically valid but unappetising recipe passes. FR-022's guard message remains the mitigation for that,
and is not claimed to be more.

## 4. Pattern Register

Required by CLAUDE.md's design-pattern-first mandate; absent from the previous revision.

| Pattern                            | Where                            | Note                                                                                                                                          |
| ---------------------------------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| **Gateway / API composition**      | `ai-service` as a whole          | The feature's defining shape: owns AI concerns, delegates domain data to owning services.                                                     |
| **Adapter**                        | Provider resolution              | **Intent already satisfied by the Vercel AI SDK.** `ProviderFactory` is a thin resolver, not a second abstraction layer. Do not add one.      |
| **Registry + discriminated union** | MCP tool dispatch                | Tool name → handler, exhaustive `switch`. This IS the Visitor intent; no visitor machinery.                                                   |
| **Policy module**                  | `GrantPolicy`                    | One authoritative place for scope checks **and** the D-004 private-visibility invariant.                                                      |
| **Command**                        | `AiGenerationJob`                | Carries its own idempotency key; the unit of retry.                                                                                           |
| **Circuit breaker**                | Provider + Secrets Manager calls | From a library (`opossum` / `cockatiel`). The previous revision's `@CircuitBreaker` decorator referenced a NestJS module that does not exist. |
| **Rate limiting**                  | Per-user / per-grant throttles   | `@nestjs/throttler`, already a repo dependency. Do not hand-roll.                                                                             |
| **Specification / policy (pure)**  | `RecipeSanityValidator`          | Returns findings, never a verdict — it structurally cannot discard or block a save (FR-023).                                                  |
| **Repository**                     | Drizzle DALs                     | Matches recipe-service.                                                                                                                       |

---

## 5. Resilience

### 5.1 Idempotency (missing entirely from the previous revision)

SQS is **at-least-once**. Without a key, a redelivered job charges the user's provider twice and can create
a duplicate recipe. `ai_generation_records.idempotency_key` is `UNIQUE`; the worker claims a job by
inserting it and treats a uniqueness violation as "already handled".

### 5.2 Throttles

- One concurrent generation per user → `429`.
- Per-grant rate limit on MCP tool calls; a sudden bulk read is an alertable anomaly (ADR-0012).
- Pro tier: 500 generations/month (OQ-2 governs granularity).

### 5.3 Circuit breakers

Around provider calls and Secrets Manager fetches. Open circuit → `503` with `Retry-After`.

### 5.4 PII sanitization

`SanitizeService` runs in **`ai-workers`**, before prompt construction: pseudonymize identifiers, strip
email / phone / name / account ids, map health conditions to dietary categories, preserve allergies. Only
the SHA-256 of the sanitized prompt is stored.

### 5.5 EU AI Act

Disclosure on every AI surface (FR-022), from `@commise/features-ai` so web and mobile share one
implementation (GR-010 AC-010-c). Strings are localized via `@commise/i18n` — a legally mandated
disclosure is the worst possible place for a hard-coded literal.

---

## 6. Infrastructure

| Resource     | Name                                                                                            |
| ------------ | ----------------------------------------------------------------------------------------------- |
| ALB priority | **400** (identity 100, food 200, recipe 300)                                                    |
| Per-PR band  | Must be **disjoint** from food (10000) and recipe (30000)                                       |
| SQS + DLQ    | `ai-generation-queue`, `ai-generation-dlq` (maxReceive 3)                                       |
| Secrets      | `byok/{userId}/{provider}`; the Clerk mint key is scoped to the `ai-service` task role **only** |
| Database     | `kitchensink_ai`                                                                                |

Per-PR previews tag `Environment=pr-{N}` (ADR-0005).

---

## 7. Implementation Order

Sequenced **after 006 and 007** per the owner's standing decision.

> **Note for whenever that is revisited:** the _technical_ reason for this ordering is gone. The previous
> revision had to follow 006/007 because its schema declared foreign keys into their tables. This revision
> has none — meal-plan and shopping-list generation are stubbed calls (`downstream-gaps.md`). 005 is
> therefore free to run in GR-006 **Phase 2**, parallel with 004/008/010, whenever the owner chooses. The
> only remaining dependency is functional: those two generators cannot be demonstrated end-to-end until
> their services exist.

1. **5A Foundation** — `kitchensink_ai` migration, Drizzle schemas, BYOK + Secrets Manager.
2. **5B MCP + grants** — OAuth discovery, DCR enablement, `GrantPolicy`, tool registry, actor-token
   bridge, the `act` admission gate in `@kitchensink/clerk-verify`.
3. **5C Generation** — intake, SQS, `ai-workers`, sanitizer, streaming.
4. **5D Composition** — recipe/food client wiring; stubs registered for 006/007.
5. **5E Surfaces** — `@commise/features-ai` shared components; web + mobile in lockstep (Principle VIII).
6. **5F Compliance & hardening** — disclosures, audit, circuit breakers, throttles, k6.

---

## 8. Open Questions

| #    | Question                                             | Status                                                       |
| ---- | ---------------------------------------------------- | ------------------------------------------------------------ |
| OQ-1 | Gemini GCP region                                    | Open — before GA                                             |
| OQ-2 | Quota granularity: per type or total                 | Open — Product                                               |
| OQ-3 | MCP client registration UI                           | **Resolved** — DCR is automatic (ADR-0012); no portal needed |
| OQ-4 | User-forked prompt templates                         | Deferred to V2                                               |
| OQ-5 | OpenAI / Anthropic DPA + SCCs                        | Open — blocks EU traffic                                     |
| OQ-6 | Nutrition advice risk classification (EU AI Act)     | Open — Legal                                                 |
| OQ-7 | Does `verifyClerkToken` introspect over the network? | **New** — a per-tool-call round trip is an SC-003 risk       |
| OQ-8 | Can a new user sign up mid-OAuth flow from ChatGPT?  | **New** — spike against sandbox before claiming support      |
| OQ-9 | Clerk custom OAuth scopes                            | **New** — if shipped, consent can move back to Clerk         |

---

## 9. Spec changes this plan forces

- **FR-018** — consent is presented by **our** UI, not Clerk's; Clerk cannot express custom scopes. The
  requirement's intent (two distinct checkboxes, read grantable without write) is unchanged.
- **V-Model artifacts** — `provider_configs` / `agent_consent_records` must be renamed to
  `user_byok_keys` / `mcp_agent_grants`. Every V-Model test case currently targets tables no migration
  creates.
- **Endpoints** — all `/ai/*` references become `/api/v1/ai/*`.
- **`api.commise.io`** — does not exist; the domain is `commise.app`.
