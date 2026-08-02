# Tasks: AI Integration (Feature 005)

**Feature**: `005-ai-integration`
**Generated**: 2026-08-02 (full regeneration — supersedes the 2026-06-02 list)
**Source**: `plan.md` (2026-08-02), `spec.md`, `product-spec/`, ADR-0012, `downstream-gaps.md`
**Total tasks**: 98

> **Why this is a replacement, not an edit.** The previous list targeted a package the plan no longer
> defines (`packages/services/ai-integration`, 37 refs), a dropped table (`mcp_oauth_consents`), a
> non-existent CDK path (`packages/cdk/`), and pre-GR-002 endpoints (`/ai/*`). It was also sequenced
> code-first and omitted every mandated test tier except unit/integration.

## Conventions

- **TDD is enforced by ordering.** Every `Test-first: true` task precedes the task it covers. The
  Phase 5B→6 Red gate requires those tests to be **confirmed failing** before implementation starts.
- **Test paths follow `docs/CODING_STANDARDS.md §7`**: unit `__tests__/*.test.ts`; backend integration
  `tests/*.integration.test.ts`; backend e2e `tests/e2e/*.e2e.test.ts`; Playwright `tests/e2e/*.spec.ts`;
  Maestro `.maestro/**/*.yaml`; k6 `packages/tools/loadtest/`.
- **Backend files are kebab `name.role.ts` (§1a); frontend is camelCase/PascalCase (§1b).**
- Sizes: `XS` ≤1h · `S` ≤½d · `M` ≤1d · `L` ≤2d · `XL` >2d (decompose).

## Story → FR map

| US     | Title                            | FRs            |
| ------ | -------------------------------- | -------------- |
| US-001 | Configure AI provider (BYOK)     | FR-015         |
| US-002 | Generate recipe in-app           | FR-016         |
| US-003 | Preview and save                 | FR-017, FR-020 |
| US-004 | External agent access            | FR-018, FR-020 |
| US-005 | Revoke agent access              | FR-021         |
| US-006 | Instruction optimization (prem.) | FR-019         |
| US-007 | Guard messaging + confidence     | FR-022         |

---

## Phase 5A — Foundation

- [ ] **T001** Scaffold `@kitchensink/ai-service` (NestJS)
      Paths: `packages/services/ai-service/package.json, packages/services/ai-service/tsconfig.json, packages/services/ai-service/vitest.config.ts, packages/services/ai-service/vitest.integration.config.ts, packages/services/ai-service/vitest.e2e.config.ts`
      Implements: NFR-001 · Constitution V
      Notes: All four shared tooling deps; `setGlobalPrefix('api/v1', { exclude: ['health'] })`. Three vitest configs from day one — integration/e2e must never bleed into `test`.
      Size: M

- [ ] **T002** Scaffold `@kitchensink/ai-workers`
      Paths: `packages/services/ai-workers/package.json, packages/services/ai-workers/tsconfig.json, packages/services/ai-workers/vitest.config.ts, packages/services/ai-workers/vitest.integration.config.ts`
      Implements: NFR-001
      Notes: Unit config MUST exclude `**/__tests__/integration/**`. No Clerk secret key in this package — ever (plan §1.2).
      Size: S

- [ ] **T003** Scaffold `@kitchensink/ai-service-client`
      Paths: `packages/clients/ai-service/package.json, packages/clients/ai-service/tsconfig.json, packages/clients/ai-service/vitest.config.ts, packages/clients/ai-service/vitest.integration.config.ts`
      Implements: NFR-001 · §14.2
      Size: S

- [ ] **T004** Scaffold `@commise/features-ai`
      Paths: `packages/apps/commise/features/ai/package.json, packages/apps/commise/features/ai/tsconfig.json, packages/apps/commise/features/ai/vitest.config.ts`
      Implements: NFR-003, NFR-004 · GR-010 AC-010-c
      Notes: `@commise/*` per §5.1 (product scope). One implementation for web + mobile.
      Size: S

- [ ] **T005** Unit tests: Drizzle schema shape + constraints
      Paths: `packages/services/ai-service/src/database/schema/__tests__/schema.test.ts`
      Test-first: true
      Implements: FR-015, FR-018, NFR-001
      Notes: Assert the **composite** unique on `(user_id, provider)` and `(template_key, version)`, and that no column-level unique exists on `user_byok_keys.user_id` — the defect that broke D-005.
      Size: S

- [ ] **T006** Drizzle schemas for the four tables
      Paths: `packages/services/ai-service/src/database/schema/ai-generation-records.ts, packages/services/ai-service/src/database/schema/user-byok-keys.ts, packages/services/ai-service/src/database/schema/mcp-agent-grants.ts, packages/services/ai-service/src/database/schema/prompt-templates.ts`
      Implements: FR-015, FR-018, FR-021, NFR-001, NFR-002
      Notes: `user_id TEXT`, **no FK** (cross-service). No column references another service's table.
      Size: M

- [ ] **T007** Integration test: migration creates tables, indexes, constraints
      Paths: `packages/services/ai-service/tests/migration.integration.test.ts`
      Test-first: true
      Implements: FR-015, FR-018
      Notes: Real Postgres. Prove the partial index `WHERE revoked_at IS NULL` exists and that a second key for the same `(user_id, provider)` is rejected while a _different_ provider is accepted.
      Size: M

- [ ] **T008** Migration `0001_ai_initial.sql`
      Paths: `packages/services/ai-service/src/database/migrations/0001_ai_initial.sql`
      Implements: FR-015, FR-018, FR-021
      Size: M

- [ ] **T009** Unit tests: env schema (Zod)
      Paths: `packages/services/ai-service/src/config/__tests__/env.schema.test.ts`
      Test-first: true
      Implements: NFR-001
      Notes: Missing/blank values must fail loudly. `process.env['KEY']` bracket notation only.
      Size: S

- [ ] **T010** Config module + env schema
      Paths: `packages/services/ai-service/src/config/env.schema.ts, packages/services/ai-service/src/config/config.types.ts`
      Implements: NFR-001, NFR-002
      Notes: `AI_DB_NAME` defaults to `kitchensink_ai`.
      Size: S

### BYOK (US-001 / FR-015)

- [ ] **T011** Unit tests: `ByokService` CRUD
      Paths: `packages/services/ai-service/src/byok/__tests__/byok.service.test.ts`
      Test-first: true
      Implements: FR-015
      Notes: Mock Secrets Manager. Assert the raw key never appears in a list response or a persisted row. Include the negative: a get for another user's key returns nothing.
      Size: M

- [ ] **T012** `ByokService`
      Paths: `packages/services/ai-service/src/byok/byok.service.ts`
      Implements: FR-015, NFR-001, NFR-002
      Notes: `@sideEffect` on every I/O method. Never caches raw keys in memory.
      Size: M

- [ ] **T013** Unit tests: key format validation + provider test-call
      Paths: `packages/services/ai-service/src/byok/__tests__/byok.validator.test.ts`
      Test-first: true
      Implements: FR-015
      Notes: Valid/invalid prefixes per provider; a failed provider test-call must reject **before** anything is written to Secrets Manager.
      Size: S

- [ ] **T014** `byok.validator.ts`
      Paths: `packages/services/ai-service/src/byok/byok.validator.ts`
      Implements: FR-015, NFR-001
      Size: S

- [ ] **T015** Integration test: BYOK against real Secrets Manager + Postgres
      Paths: `packages/services/ai-service/tests/byok.integration.test.ts`
      Test-first: true
      Implements: FR-015
      Notes: LocalStack. Store → list → replace (old secret deleted) → delete. Proves D-005: three providers coexist for one user.
      Size: M

- [ ] **T016** `ByokController` + `ByokModule`
      Paths: `packages/services/ai-service/src/byok/byok.controller.ts, packages/services/ai-service/src/byok/byok.module.ts, packages/services/ai-service/src/byok/dto/store-byok-key.dto.ts`
      Implements: FR-015
      Notes: `/api/v1/ai/byok/keys`. `201` / `204` / `400`.
      Size: M

- [ ] **T017** E2E: BYOK over HTTP
      Paths: `packages/services/ai-service/tests/e2e/byok.e2e.test.ts`
      Test-first: true
      Implements: FR-015
      Size: S

---

## Phase 5B — MCP + grants (the security core)

> Every task here is covered by ADR-0012. Read it before changing any of them.

- [ ] **T018** Unit tests: `GrantPolicy` scope matrix
      Paths: `packages/services/ai-service/src/mcp/policy/__tests__/grant.policy.test.ts`
      Test-first: true
      Implements: FR-018, FR-021
      Notes: Read-only grant → `recipe_save` denied; write grant → allowed; revoked → denied; expired → denied; **no grant row → denied**; **DB error → denied (fails closed, never open)**. Paired positives so a policy that always denies cannot pass.
      Size: M

- [ ] **T019** `GrantPolicy` — the single authorization seam
      Paths: `packages/services/ai-service/src/mcp/policy/grant.policy.ts`
      Implements: FR-018, FR-021, NFR-001, NFR-002
      Notes: Policy module pattern (plan §4). Owns scope checks **and** the D-004 invariant — one authoritative place.
      Size: M

- [ ] **T020** Unit tests: D-004 private-visibility invariant
      Paths: `packages/services/ai-service/src/mcp/policy/__tests__/visibility.policy.test.ts`
      Test-first: true
      Implements: FR-020
      Notes: `visibility: 'public' | 'shared'` → `400`; absent → forced `private`, never silently coerced to the service default (`recipes.visibility` defaults to `'public'` on main — the reason this test exists).
      Size: S

- [ ] **T021** Visibility enforcement in `GrantPolicy`
      Paths: `packages/services/ai-service/src/mcp/policy/visibility.policy.ts`
      Implements: FR-020
      Size: S

- [ ] **T022** Unit tests: `act` admission gate
      Paths: `packages/shared/clerk-verify/src/__tests__/agentActorToken.test.ts`
      Test-first: true
      Implements: FR-018 · ADR-0012
      Notes: `act.sub` = our MCP actor → admit; `act` absent → reject; **`act` present but a different sub → reject** (a support-staff impersonation session must not enter the agent path); a token with a present `azp` short-circuits to the pattern check unchanged.
      Size: M

- [ ] **T023** `isAgentActorToken` gate in `@kitchensink/clerk-verify`
      Paths: `packages/shared/clerk-verify/src/clerkVerify.ts, packages/shared/clerk-verify/src/index.ts`
      Implements: FR-018 · ADR-0012
      Notes: Sibling of `isNativeClientToken`. Never admit on `azp`-absence alone. Shared package → all three services gain it at once.
      Size: M

- [ ] **T024** Unit tests: actor-token minting
      Paths: `packages/services/ai-service/src/mcp/auth/__tests__/actor-token.service.test.ts`
      Test-first: true
      Implements: FR-018 · ADR-0012
      Notes: Mock Clerk. Assert `session_max_duration_in_seconds` is set well below the 30-minute default, and that a mint failure surfaces as a denial rather than an unauthenticated downstream call.
      Size: M

- [ ] **T025** `ActorTokenService`
      Paths: `packages/services/ai-service/src/mcp/auth/actor-token.service.ts`
      Implements: FR-018 · ADR-0012
      Notes: The only holder of the Clerk secret key. Custom error + `is*` guard per §13.
      Size: M

- [ ] **T026** Unit tests: JSON-RPC 2.0 envelope
      Paths: `packages/services/ai-service/src/mcp/__tests__/mcp-server.service.test.ts`
      Test-first: true
      Implements: FR-018
      Notes: Single + batch; unknown method → `-32601`; malformed → `-32700`; a batch with one bad member must not fail the whole batch.
      Size: M

- [ ] **T027** `McpServerService`
      Paths: `packages/services/ai-service/src/mcp/mcp-server.service.ts`
      Implements: FR-018, NFR-001, NFR-002
      Size: M

- [ ] **T028** Unit tests: tool registry dispatch
      Paths: `packages/services/ai-service/src/mcp/tools/__tests__/registry.test.ts`
      Test-first: true
      Implements: FR-018
      Notes: Registry + discriminated union with an exhaustive `switch` (plan §4) — adding a member without a handler must fail typecheck.
      Size: S

- [ ] **T029** Tool registry + `recipes_list`, `recipe_get`
      Paths: `packages/services/ai-service/src/mcp/tools/registry.ts, packages/services/ai-service/src/mcp/tools/recipes.tool.ts`
      Implements: FR-018
      Notes: Reads go through `@kitchensink/recipe-service-client`. Only the authenticated user's recipes.
      Size: M

- [ ] **T030** Unit tests: `recipe_save` scope + visibility
      Paths: `packages/services/ai-service/src/mcp/tools/__tests__/recipe-save.tool.test.ts`
      Test-first: true
      Implements: FR-018, FR-020
      Notes: Named for its source (`recipe-save.tool.ts`) per §1a `<source>.test.ts`.
      Size: M

- [ ] **T031** `recipe_save`
      Paths: `packages/services/ai-service/src/mcp/tools/recipe-save.tool.ts`
      Implements: FR-018, FR-020
      Notes: Calls `recipeServiceClient.createRecipe()` with `visibility: 'private'`. No local insert.
      Size: M

- [ ] **T032** Unit tests: `ingredient_search`
      Paths: `packages/services/ai-service/src/mcp/tools/__tests__/ingredients.tool.test.ts`
      Test-first: true
      Implements: FR-018
      Size: S

- [ ] **T033** `ingredient_search`
      Paths: `packages/services/ai-service/src/mcp/tools/ingredients.tool.ts`
      Implements: FR-018
      Size: S

- [ ] **T034** Integration test: grant lifecycle
      Paths: `packages/services/ai-service/tests/grant-lifecycle.integration.test.ts`
      Test-first: true
      Implements: FR-018, FR-021
      Notes: Real Postgres. Grant → tool call succeeds → revoke → **next call denied without a restart**. This is FR-021's actual guarantee.
      Size: M

- [ ] **T035** Grant DAL + management endpoints
      Paths: `packages/services/ai-service/src/mcp/grants/grants.dal.ts, packages/services/ai-service/src/mcp/grants/grants.controller.ts, packages/services/ai-service/src/mcp/grants/grants.service.ts`
      Implements: FR-018, FR-021
      Notes: `/api/v1/ai/agents*`. Revoke sets `revoked_at`.
      Size: M

- [ ] **T036** Integration test: MCP over real HTTP
      Paths: `packages/services/ai-service/tests/mcp-protocol.integration.test.ts`
      Test-first: true
      Implements: FR-018
      Notes: Booted server, signed tokens, real transport.
      Size: L

- [ ] **T037** `McpController` + discovery endpoints
      Paths: `packages/services/ai-service/src/mcp/mcp.controller.ts, packages/services/ai-service/src/mcp/mcp.module.ts, packages/services/ai-service/src/mcp/well-known.controller.ts`
      Implements: FR-018
      Notes: `POST /api/v1/ai/mcp`. `/.well-known/*` served at the **root, unprefixed** (RFC 9728) — excluded from the global prefix.
      Size: M

- [ ] **T038** Integration test: read-only grant cannot write downstream
      Paths: `packages/services/ai-service/tests/cross-service-scope.integration.test.ts`
      Test-first: true
      Implements: FR-018, FR-020
      Notes: The end-to-end proof of D-001. A read-only grant must leave recipe-service with zero new rows.
      Size: L

- [ ] **T039** Enable Dynamic Client Registration + document the runbook
      Paths: `packages/services/ai-service/docs/clerk-setup.md`
      Implements: FR-018 · ADR-0012
      Notes: `instance/oauth_application_settings.dynamic_oauth_client_registration = true`. Without it ChatGPT cannot self-register.
      Size: S

- [ ] **T040** E2E: MCP OAuth flow
      Paths: `packages/services/ai-service/tests/e2e/mcp-oauth.e2e.test.ts`
      Test-first: true
      Implements: FR-018, FR-021
      Size: L

---

## Phase 5C — Generation

- [ ] **T041** Unit tests: `SanitizeService` PII patterns
      Paths: `packages/services/ai-workers/src/sanitize/__tests__/sanitize.service.test.ts`
      Test-first: true
      Implements: FR-016, FR-022
      Notes: Email, phone, name, account id, health condition → category. Pseudonymization is deterministic. **Allergies and dietary preferences survive** — stripping them is a safety bug, not a privacy win.
      Size: M

- [ ] **T042** `SanitizeService`
      Paths: `packages/services/ai-workers/src/sanitize/sanitize.service.ts`
      Implements: FR-016, NFR-001, NFR-002
      Notes: Library-first for detection; justify inline if hand-rolled.
      Size: L

- [ ] **T043** Unit tests: idempotent job claim
      Paths: `packages/services/ai-workers/src/generation/__tests__/idempotency.test.ts`
      Test-first: true
      Implements: FR-016
      Notes: A redelivered job (same key) must not call the provider twice or create a second recipe. Unique violation → "already handled", not an error.
      Size: M

- [ ] **T044** Idempotent claim in the worker
      Paths: `packages/services/ai-workers/src/generation/generation.worker.ts`
      Implements: FR-016
      Size: M

- [ ] **T045** Unit tests: generation intake
      Paths: `packages/services/ai-service/src/generation/__tests__/generation.service.test.ts`
      Test-first: true
      Implements: FR-016, FR-017
      Notes: `202` + jobId; missing `Idempotency-Key` → `400`; sanitization is invoked before enqueue.
      Size: M

- [ ] **T046** Generation intake service + controller
      Paths: `packages/services/ai-service/src/generation/generation.service.ts, packages/services/ai-service/src/generation/generation.controller.ts, packages/services/ai-service/src/generation/dto/generate-recipe.dto.ts`
      Implements: FR-016, FR-017
      Size: M

- [ ] **T047** Integration test: SQS lifecycle + DLQ
      Paths: `packages/services/ai-workers/__tests__/integration/queue/generation-queue.integration.test.ts`
      Test-first: true
      Implements: FR-016
      Notes: LocalStack. Enqueue → process → complete; failure retries 3× then DLQ; redelivery is idempotent.
      Size: L

- [ ] **T048** `GenerationQueueService` + worker handler
      Paths: `packages/services/ai-workers/src/generation/generation-queue.service.ts, packages/services/ai-workers/src/handlers/generation.handler.ts`
      Implements: FR-016
      Size: L

- [ ] **T049** Unit tests: provider resolver
      Paths: `packages/services/ai-workers/src/providers/__tests__/provider.resolver.test.ts`
      Test-first: true
      Implements: FR-016
      Notes: `openai | anthropic | gemini | auto`. Missing BYOK key → a guiding error (FR-015 scenario 4), not a crash.
      Size: S

- [ ] **T050** Provider resolver
      Paths: `packages/services/ai-workers/src/providers/provider.resolver.ts`
      Implements: FR-016
      Notes: Thin resolver over the Vercel AI SDK. **Do not build a second adapter layer** (plan §4).
      Size: S

- [ ] **T051** Unit tests: prompt template service
      Paths: `packages/services/ai-service/src/prompts/__tests__/prompt-template.service.test.ts`
      Test-first: true
      Implements: FR-016
      Notes: Active-version resolution; templates never contain raw user data.
      Size: S

- [ ] **T052** `PromptTemplateService` + seeds + admin endpoints
      Paths: `packages/services/ai-service/src/prompts/prompt-template.service.ts, packages/services/ai-service/src/prompts/prompt-template.controller.ts, packages/services/ai-service/src/database/seed/prompt-templates.seed.ts`
      Implements: FR-016
      Notes: Admin-gated via the existing `ScopesGuard` + `@RequireScopes`.
      Size: M

- [ ] **T053** Integration test: SSE streaming
      Paths: `packages/services/ai-service/tests/sse-streaming.integration.test.ts`
      Test-first: true
      Implements: FR-016, FR-017
      Notes: Partial chunks arrive **before** the final event (assert incremental delivery, not just the final payload — a buffered response would otherwise pass).
      Size: L

- [ ] **T054** SSE endpoint
      Paths: `packages/services/ai-service/src/generation/generation-stream.controller.ts`
      Implements: FR-016, FR-017
      Notes: Verify behaviour behind the shared ALB (idle timeout, buffering) before calling this done.
      Size: L

- [ ] **T055** Unit tests: poll endpoint
      Paths: `packages/services/ai-service/src/generation/__tests__/generation.controller.test.ts`
      Test-first: true
      Implements: FR-016, FR-017
      Notes: `pending → streaming → complete | failed`; another user's jobId → `404`, never `403` (no existence leak).
      Size: S

- [ ] **T056** Poll endpoint
      Paths: `packages/services/ai-service/src/generation/generation-status.controller.ts`
      Implements: FR-016, FR-017
      Size: S

---

## Phase 5D — Composition + stubs

- [ ] **T057** Unit tests: stubbed downstream endpoints
      Paths: `packages/services/ai-service/src/generation/__tests__/stubs.test.ts`
      Test-first: true
      Implements: DG-001, DG-002
      Notes: `501` with the feature name; **no `ai_generation_records` row written** (no provider called, nothing to audit).
      Size: S

- [ ] **T058** Meal-plan + shopping-list stubs
      Paths: `packages/services/ai-service/src/generation/stubs.controller.ts`
      Implements: DG-001, DG-002
      Size: S

- [ ] **T059** Unit tests: `tools/list` omits unavailable tools
      Paths: `packages/services/ai-service/src/mcp/tools/__tests__/tools-list.test.ts`
      Test-first: true
      Implements: DG-003
      Notes: `meal_plans_list` / `meal_plan_get` must not be advertised until 006 ships.
      Size: S

- [ ] **T060** `tools/list` filtering
      Paths: `packages/services/ai-service/src/mcp/tools/tools-list.ts`
      Implements: DG-003
      Size: XS

- [ ] **T061** Unit tests: premium entitlement gate
      Paths: `packages/services/ai-service/src/optimization/__tests__/premium.guard.test.ts`
      Test-first: true
      Implements: FR-019 · D-002 · DG-004
      Notes: Non-premium → `403` **server-side** (D-002 requires this, not a UI-only gate).
      Size: S

- [ ] **T062** Premium guard + optimize endpoint
      Paths: `packages/services/ai-service/src/optimization/premium.guard.ts, packages/services/ai-service/src/optimization/optimization.controller.ts`
      Implements: FR-019
      Notes: Reads `accounts.subscription_tier`; migrate when 010 defines the contract (DG-004).
      Size: M

---

## Phase 5E — Surfaces (shared-first, lockstep web + mobile)

> Principle VIII: shared logic lives in `@commise/features-ai`; apps hold only screen composition and
> navigation. Every component test covers **every** state, not the happy path.

- [ ] **T063** RTL tests: `AiGuardBanner` — all states
      Paths: `packages/apps/commise/features/ai/src/guard/__tests__/AiGuardBanner.test.tsx`
      Test-first: true
      Implements: FR-022, NFR-003, NFR-004
      Notes: Full text on views 1–3; collapsed icon+tooltip after 3; nutrition variant adds the medical disclaimer; **not dismissible on first view and never disableable**; accessible name present; state not conveyed by colour alone.
      Size: M

- [ ] **T064** `AiGuardBanner`
      Paths: `packages/apps/commise/features/ai/src/guard/AiGuardBanner.tsx, packages/apps/commise/features/ai/src/guard/types.ts`
      Implements: FR-022 · GR-010 AC-010-c
      Notes: Pure `props → JSX`. Variants via a discriminated union — **no boolean flag prop** switching render trees (§11). View count persisted by the orchestration layer, not the render component.
      Size: M

- [ ] **T065** RTL tests: confidence indicator — all states
      Paths: `packages/apps/commise/features/ai/src/guard/__tests__/ConfidenceIndicator.test.tsx`
      Test-first: true
      Implements: FR-022, NFR-003, NFR-004
      Notes: Every confidence band; icon or text always accompanies colour.
      Size: S

- [ ] **T066** `ConfidenceIndicator`
      Paths: `packages/apps/commise/features/ai/src/guard/ConfidenceIndicator.tsx`
      Implements: FR-022
      Notes: FR-022 requires an indicator **and** the guard message; the previous task list covered only the message.
      Size: S

- [ ] **T067** RTL tests: BYOK provider form — all states
      Paths: `packages/apps/commise/features/ai/src/byok/__tests__/ProviderForm.test.tsx`
      Test-first: true
      Implements: FR-015, NFR-003, NFR-004
      Notes: Empty, loading, saved, invalid-key error, delete confirmation, per-provider configured/not-configured.
      Size: M

- [ ] **T068** BYOK hooks + `ProviderForm`
      Paths: `packages/apps/commise/features/ai/src/byok/ProviderForm.tsx, packages/apps/commise/features/ai/src/byok/useByokKeys.ts`
      Implements: FR-015
      Notes: Raw key never persisted on device; only ARN metadata returns.
      Size: M

- [ ] **T069** RTL tests: agent consent — all states
      Paths: `packages/apps/commise/features/ai/src/agents/__tests__/AgentConsent.test.tsx`
      Test-first: true
      Implements: FR-018 · D-001
      Notes: **Two distinct checkboxes, never bundled**; read grantable without write; confirm disabled until ≥1 selected.
      Size: M

- [ ] **T070** `AgentConsent`
      Paths: `packages/apps/commise/features/ai/src/agents/AgentConsent.tsx`
      Implements: FR-018 · ADR-0012
      Notes: This is **our** consent screen — Clerk cannot render it (no custom OAuth scopes).
      Size: M

- [ ] **T071** RTL tests: agent connections list — all states
      Paths: `packages/apps/commise/features/ai/src/agents/__tests__/AgentConnections.test.tsx`
      Test-first: true
      Implements: FR-021, NFR-003, NFR-004
      Notes: Empty, populated, revoking, revoke-failed.
      Size: M

- [ ] **T072** `AgentConnections`
      Paths: `packages/apps/commise/features/ai/src/agents/AgentConnections.tsx, packages/apps/commise/features/ai/src/agents/useAgentGrants.ts`
      Implements: FR-021
      Size: M

- [ ] **T073** i18n keys for every AI string
      Paths: `packages/apps/commise/i18n/src/locales/en/ai.json`
      Implements: FR-022
      Notes: Guard + medical disclaimer strings are **legally mandated** — no hard-coded literals anywhere.
      Size: S

- [ ] **T074** Web routes
      Paths: `packages/apps/commise/web/src/app/[locale]/settings/ai-providers/page.tsx, packages/apps/commise/web/src/app/[locale]/settings/agent-connections/page.tsx, packages/apps/commise/web/src/app/[locale]/ai/generate/page.tsx`
      Implements: FR-015, FR-016, FR-017, FR-021
      Notes: `[locale]` segment is required. Composition only — logic lives in features-ai.
      Size: M

- [ ] **T075** Mobile screens
      Paths: `packages/apps/commise/mobile/src/screens/settings/AiProviderScreen.tsx, packages/apps/commise/mobile/src/screens/settings/AgentConnectionsScreen.tsx, packages/apps/commise/mobile/src/screens/ai/GenerateRecipeScreen.tsx, packages/apps/commise/mobile/src/screens/ai/RecipePreviewScreen.tsx`
      Implements: FR-015, FR-016, FR-017, FR-021
      Notes: Same release as web (Principle VIII). `.native.*` only where genuinely platform-specific.
      Size: L

- [ ] **T076** Playwright: one spec per user story
      Paths: `packages/apps/commise/web/tests/e2e/aiByok.spec.ts, packages/apps/commise/web/tests/e2e/aiGenerate.spec.ts, packages/apps/commise/web/tests/e2e/aiAgentConsent.spec.ts`
      Test-first: true
      Implements: US-001..US-007
      Notes: `getByRole` / `getByLabel` only; `data-testid` and `waitForTimeout` banned.
      Size: L

- [ ] **T077** Maestro: one flow per user story
      Paths: `packages/apps/commise/mobile/.maestro/ai/byok-flow.yaml, packages/apps/commise/mobile/.maestro/ai/generate-flow.yaml, packages/apps/commise/mobile/.maestro/ai/agent-consent-flow.yaml`
      Test-first: true
      Implements: US-001..US-007
      Notes: Mobile parity for the Playwright specs. CI-only (needs an emulator) — written regardless.
      Size: L

---

## Phase 5F — Compliance & hardening

- [ ] **T078** Unit tests: circuit breaker
      Paths: `packages/services/ai-workers/src/resilience/__tests__/breaker.test.ts`
      Test-first: true
      Implements: FR-016
      Notes: Opens after threshold; `503` + `Retry-After`; half-open recovery.
      Size: S

- [ ] **T079** Circuit breaker (library)
      Paths: `packages/services/ai-workers/src/resilience/breaker.ts`
      Implements: FR-016
      Notes: `opossum` or `cockatiel`. The old plan's `@CircuitBreaker` decorator referenced a NestJS module that does not exist.
      Size: S

- [ ] **T080** Unit tests: throttles
      Paths: `packages/services/ai-service/src/resilience/__tests__/throttle.test.ts`
      Test-first: true
      Implements: FR-016, FR-019
      Notes: Second concurrent generation → `429`; per-grant MCP rate limit; monthly Pro quota with `X-RateLimit-Reset`.
      Size: M

- [ ] **T081** Throttles via `@nestjs/throttler`
      Paths: `packages/services/ai-service/src/resilience/throttle.config.ts`
      Implements: FR-016, FR-019
      Notes: Already a repo dependency — do not hand-roll.
      Size: M

- [ ] **T082** Unit tests: audit writes
      Paths: `packages/services/ai-service/src/audit/__tests__/audit.service.test.ts`
      Test-first: true
      Implements: FR-022
      Notes: Every path audited; **only the prompt hash, never raw prompt content**; `acted_via_agent` set for agent-originated calls.
      Size: M

- [ ] **T083** `AuditService`
      Paths: `packages/services/ai-service/src/audit/audit.service.ts`
      Implements: FR-022
      Notes: The EU AI Act regulatory-inquiry trail.
      Size: M

- [ ] **T084** k6: SC-003 latency SLO
      Paths: `packages/tools/loadtest/ai-generation.js`
      Test-first: true
      Implements: SC-003
      Notes: The **only** measurable success criterion, and it had zero coverage in the previous list. Assert p95 within the 15-second budget, including the actor-mint round trip (OQ-7).
      Size: M

- [ ] **T085** CDK stack
      Paths: `packages/services/ai-service/infra/lib/ai-service-stack.ts, packages/services/ai-service/infra/bin/app.ts`
      Implements: FR-016, FR-018
      Notes: SQS + DLQ (maxReceive 3, KMS, alarm on depth > 0); ALB priority **400**; per-PR band disjoint from food (10000) and recipe (30000); `Environment=pr-{N}` tagging (ADR-0005); Clerk mint key scoped to the `ai-service` task role only.
      Size: L

- [ ] **T086** CI wiring
      Paths: `.github/workflows/\_ci.yml`
      Implements: NFR-001
      Notes: Add unit / integration / e2e jobs for both services and the client, plus the k6 leg. A `test:integration` script no job calls is a test that never runs.
      Size: M

---

- [ ] **T092** Unit tests: `RecipeSanityValidator` — every check, plus the non-blocking property
      Paths: `packages/services/ai-service/src/validation/__tests__/recipe-sanity.validator.test.ts`
      Test-first: true
      Implements: FR-023, REQ-016
      Notes: Quantity plausibility, thermal bounds, referential integrity (step names an unlisted ingredient), structural completeness. Include the **clean-draft** case → zero findings, so a validator that always warns cannot pass. Assert the return type is a findings LIST, never a boolean verdict — the type is what makes "advisory" structural.
      Size: M

- [ ] **T093** `RecipeSanityValidator` (pure Specification module)
      Paths: `packages/services/ai-service/src/validation/recipe-sanity.validator.ts`
      Implements: FR-023, NFR-001, NFR-002
      Notes: Pure — no I/O, no decisions. Returns findings; the preview layer decides rendering. It has **no** code path to discard, mutate, or block a save (plan §3.7).
      Size: M

- [ ] **T094** Integration test: warnings surface on preview and never block the save
      Paths: `packages/services/ai-service/tests/sanity-validation.integration.test.ts`
      Test-first: true
      Implements: FR-023, REQ-016
      Notes: A draft failing **every** check must still save successfully (SCN-016-A5). This is the guard against the validator becoming a silent gate.
      Size: M

- [ ] **T095** Wire validation into the preview response + confidence indicator basis
      Paths: `packages/services/ai-service/src/generation/generation-status.controller.ts, packages/apps/commise/features/ai/src/guard/ConfidenceIndicator.tsx`
      Implements: FR-022, FR-023
      Notes: The indicator renders the validation result + provider/model identity — **not** a model-reported quality score (plan §3.7). Update T065's RTL states to cover clean vs warned.
      Size: M

- [ ] **T096** Unit tests: regenerate reuses criteria and obeys the same limits
      Paths: `packages/services/ai-service/src/generation/__tests__/regenerate.test.ts`
      Test-first: true
      Implements: FR-024, REQ-017
      Notes: Same criteria without re-entry; second concurrent regenerate → `429`; superseded draft discarded unpersisted; monthly quota consumed as an initial generation.
      Size: M

- [ ] **T097** Regenerate endpoint
      Paths: `packages/services/ai-service/src/generation/regenerate.controller.ts`
      Implements: FR-024
      Notes: `POST /api/v1/ai/generate/recipe/:jobId/regenerate`. Reuses stored criteria; same `Idempotency-Key`, concurrency and rate-limit path as initial generation.
      Size: M

- [ ] **T098** RTL + Playwright + Maestro: regenerate affordance and BYOK cost disclosure
      Paths: `packages/apps/commise/features/ai/src/preview/__tests__/RegenerateControl.test.tsx, packages/apps/commise/web/tests/e2e/aiRegenerate.spec.ts, packages/apps/commise/mobile/.maestro/ai/regenerate-flow.yaml`
      Test-first: true
      Implements: FR-024, NFR-003, NFR-004
      Notes: Every state — idle, in-flight, rate-limited (`429`), failed. The control must make the BYOK cost implication evident (SCN-017-A2). Web + mobile in lockstep (Principle VIII).
      Size: L

---

## Phase 5G — `/api/v1/*` conformance (GR-002)

> **This phase was rewritten on 2026-08-02: the migration it scoped already SHIPPED on `main`.** It
> originally moved recipe-service and food-service onto `/api/v1/*` as a prerequisite for 005. That work
> landed independently (ADR-0011 `docs/architecture/decisions/0011-api-version-prefix.md`; commits
> `daac10c6`, `9658ed05`, `22e8ef15`, `ac06d703`, `dcd13187`, `1422c4b8`) while this plan was being
> written. The superseded tasks are recorded below rather than deleted, so the audit trail shows what was
> planned, what actually shipped, and where the shipped mechanism DIFFERS from what was planned.
>
> **What shipped is a dual-path controller** — `@Controller(['api/v1/foods', 'v1/foods'])` — **not**
> `setGlobalPrefix`. The bare `/v1/*` path is retained as a **deprecated alias** because its consumers
> cannot be fixed by redeploying this repo (already-shipped mobile builds, cached web bundles with
> build-time-inlined `NEXT_PUBLIC_*` endpoints, the Clerk-dashboard webhook URL, and the
> independently-deployed identity Lambdas that dial `POST /v1/internal/account/erasure`).
> **Retiring that alias is NOT in 005's scope** — it needs its own consumer-drain evidence against
> ADR-0011. `/health` remains unprefixed, as this phase required.
>
> What remains for 005 is conformance of its OWN surface. See `plan.md` §3.6.

- [ ] **T087** Contract test: every 005 route is canonical `/api/v1/*` and carries **NO** bare-`/v1/` alias
      Paths: `packages/services/ai-service/src/common/__tests__/api-route-paths.test.ts`
      Test-first: true
      Implements: GR-002
      Notes: Enumerate 005's controller routing metadata and assert every route sits under `/api/v1/` (`/api/v1/ai/*`, the MCP surface) and that `GET /health` is NOT prefixed. Crucially, assert the INVERSE of what the shipped services do: 005's endpoints must declare a SINGLE path with no bare-`/v1/` alias. Nothing has ever shipped on these paths, so there is no legacy consumer to protect, and minting an alias for a brand-new endpoint manufactures exactly the debt ADR-0011 exists to retire. Model on `packages/services/recipe-service/src/common/__tests__/api-route-paths.test.ts` (decorator-metadata tier — no HTTP, no DB).
      Size: M

### Superseded by `main` — no work remains

| Task     | Was                                                        | Disposition                                                                                                                                                                                                       |
| -------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **T088** | Apply `setGlobalPrefix('api/v1', { exclude: ['health'] })` | **Superseded** by `9658ed05`, which used dual-path `@Controller([...])` instead. A global prefix serves exactly ONE shape and would silently drop the deprecated alias — do not "finish" this task by adding one. |
| **T089** | Update both service clients to the new base path           | **Done** on `main` (`ac06d703`). `recipe-service-client` and `food-service-client` dial `/api/v1/*`.                                                                                                              |
| **T090** | Re-point every out-of-band `/v1/` reference                | **Done** on `main` (`dcd13187`, `1422c4b8`): Playwright globs, k6 scripts, CI probes and ADR-0010's post-deploy food smoke are all on `/api/v1/*`.                                                                |
| **T091** | Update `docs/api-conventions.md` §6 conformance table      | **Done** on `main` (`daac10c6`), which authored `docs/api-conventions.md` independently.                                                                                                                          |

**The Playwright hazard is now INVERTED — read before touching any route glob.** T090's original warning
was that a missed `**/v1/**` → `**/api/v1/**` update would silently stop intercepting. The globs have
moved, so the live risk is the opposite: Clerk's Frontend API serves at the bare `/v1/*`, and the
interception glob is now `**/api/v1/**`, so Clerk requests no longer enter the handler. Any 005 suite that
**widens** a glob back toward `**/v1/**` recaptures Clerk, 404s `getToken()`, and hangs every request
awaiting a token. The pass-through reasoning is recorded in
`packages/apps/commise/web/tests/e2e/utils/recipeApi.ts` — restore it if you ever widen the glob.

## Coverage

| Requirement | Tasks                                                |
| ----------- | ---------------------------------------------------- |
| FR-015      | T005–T017, T067, T068, T074, T075, T076, T077        |
| FR-016      | T041–T056, T078–T081, T084                           |
| FR-017      | T045, T046, T053–T056, T074, T075                    |
| FR-018      | T018–T040, T059, T060, T069, T070                    |
| FR-019      | T061, T062, T080, T081                               |
| FR-020      | T020, T021, T030, T031, T038                         |
| FR-021      | T034, T035, T071, T072                               |
| FR-022      | T063–T066, T073, T082, T083                          |
| NFR-001     | T001–T003, T006, T010 (+ strict mode repo-wide)      |
| NFR-002     | T006, T010, T012, T019, T027, T083                   |
| NFR-003/004 | T063, T065, T067, T069, T071, T074, T075, T076, T077 |
| SC-003      | T084                                                 |
| DG-001..004 | T057–T062                                            |

**Test-first tasks**: 46 · **Implementation tasks**: 48 · **Total**: 94

> Counts recomputed 2026-08-02. The previous footer (41 / 45) predated the final task list and did not
> match it. T088–T091 are excluded as superseded by `main` (see Phase 5G).
