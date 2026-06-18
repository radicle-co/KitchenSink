# Tasks: AI Integration (Feature 005)

**Feature**: `005-ai-integration`
**Generated**: 2026-06-02
**Source artifacts**: `spec.md`, `plan.md`, `product-spec/product-spec.md`, `product-spec/metrics.md`
**Total tasks**: 50

---

## User Story Reference

| US     | Title                                     | FR Coverage    | Priority |
| ------ | ----------------------------------------- | -------------- | -------- |
| US-001 | Configure AI Provider (BYOK)              | FR-015         | P2       |
| US-002 | Generate Recipe In-App                    | FR-016, FR-017 | P2       |
| US-003 | Preview and Save Generated Recipe         | FR-017, FR-020 | P2       |
| US-004 | External Agent OAuth Access               | FR-018, FR-020 | P2       |
| US-005 | Revoke Agent Access                       | FR-021         | P2       |
| US-006 | Recipe Instruction Optimization (Premium) | FR-019         | P2       |
| US-007 | EU AI Act Compliance + Guard Messaging    | FR-022         | P0       |

---

## Dependency Graph

```text
Phase 5A (Foundation)
  T-001 → T-002 → T-003 → T-004 → T-005 → T-006 → T-007
                                      ↓                   ↓
Phase 5B (Core Generation)            ↓                   ↓
  T-008 → T-009 → T-010 → T-011 → T-012 → T-013 → T-014 → T-015 → T-016
                                                              ↓
Phase 5C (Extended Generation)                                ↓
  T-017 → T-018 → T-019 → T-020                               ↓
                                      ↓                       ↓
Phase 5D (External Agent / MCP)       ↓                       ↓
  T-021 → T-022 → T-023 → T-024 → T-025 → T-026 → T-027 → T-028
                                                      ↓
Phase 5E (Compliance & Polish)                        ↓
  T-029 → T-030 → T-031 → T-032 → T-033 → T-034 → T-035 → T-036 → T-037 → T-038 → T-039 → T-040 → T-041 → T-042
                                                      ↓
Phase 5F (Mobile Parity)                              ↓
  T-043 → T-044 → T-045 → T-046 → T-047 → T-048 → T-049 → T-050
```

**Parallelizable tasks ([P])**: T-001, T-003, T-008, T-010, T-034, T-035, T-036, T-037, T-043, T-044, T-045, T-046, T-047, T-048, T-049, T-050

---

## US-001 — Configure AI Provider (BYOK)

> Covers FR-015: System MUST allow users to configure their preferred AI provider by securely storing their own API credentials (BYOK model).

- [ ] **T-001** [P] [US-001] Drizzle schema definitions for AI tables — `packages/services/ai-integration/src/database/schema/ai-generation-records.schema.ts`
    - **Depends on**: —
    - **Implements**: FR-015, FR-018, FR-021, NFR-001
    - Define Drizzle schemas for `ai_generation_records`, `prompt_templates`, `user_byok_keys`, `mcp_oauth_consents`. Export types from schema index. `user_byok_keys.secret_arn` stores only ARN — never raw key. `ai_generation_records.source_prompt_hash` is SHA-256 of sanitized prompt.
    - **Acceptance**: All 4 Drizzle table definitions compile with `strict: true`; types exported from `packages/services/ai-integration/src/database/schema/index.ts`.

- [ ] **T-002** [US-001] Drizzle migration `005_ai_integration` — `packages/services/ai-integration/src/database/migrations/005_ai_integration.ts`
    - **Depends on**: T-001
    - **Implements**: FR-015, FR-018, NFR-001
    - Create migration that creates all 4 tables + indexes; `down()` drops them cleanly.
    - **Acceptance**: `npm run db:migrate` creates all 4 tables + indexes without error.

- [ ] **T-003** [P] [US-001] `ByokModule` scaffold + NestJS module wiring — `packages/services/ai-integration/src/ai/byok/byok.module.ts`
    - **Depends on**: T-001
    - **Implements**: FR-015, NFR-001
    - Scaffold `ByokModule`, `ByokService`, `ByokController`, DTOs (`store-byok-key.dto.ts`, `byok-key-meta.dto.ts`). Wire into `AppModule`.
    - **Acceptance**: Module registers; `ByokService` injectable; controller routes at `/ai/byok/keys`.

- [ ] **T-004** [US-001] `ByokService` — AWS Secrets Manager CRUD — `packages/services/ai-integration/src/ai/byok/byok.service.ts`
    - **Depends on**: T-003
    - **Implements**: FR-015, NFR-001
    - Implement `storeKey()` (writes to Secrets Manager `byok/{userId}/{provider}`, stores ARN in DB), `deleteKey()`, `getKey()` (fetches raw key from SM only), `listKeys()` (metadata only). Raw key never written to Postgres.
    - **Acceptance**: All CRUD operations work; raw key never leaks to Postgres or API responses.

- [ ] **T-005** [US-001] `ByokService` — API key format validation + provider test call — `packages/services/ai-integration/src/ai/byok/byok.validator.ts`
    - **Depends on**: T-004
    - **Implements**: FR-015, NFR-001
    - Validate key prefixes (`sk-` OpenAI, `sk-ant` Anthropic, Gemini format). Make minimal test API call before storing. Return `400` with descriptive error on invalid key.
    - **Acceptance**: Invalid keys rejected before storage; valid keys pass test call.

- [ ] **T-006** [US-001] `POST /ai/byok/keys` endpoint — `packages/services/ai-integration/src/ai/byok/byok.controller.ts`
    - **Depends on**: T-005
    - **Implements**: FR-015
    - Store BYOK key endpoint. Accepts `{ provider, key }`. Validates, tests, stores via Secrets Manager, returns metadata.
    - **Acceptance**: Returns `201` with key metadata on success; `400` on invalid key.

- [ ] **T-007** [US-001] `DELETE /ai/byok/keys/:provider` + `GET /ai/byok/keys` endpoints — `packages/services/ai-integration/src/ai/byok/byok.controller.ts`
    - **Depends on**: T-006
    - **Implements**: FR-015
    - Delete removes key from Secrets Manager + DB (`204`). List returns metadata only (no raw keys).
    - **Acceptance**: `DELETE` returns `204`; `GET` returns list without raw keys.

---

## US-002 / US-007 — PII Sanitization Infrastructure

> Covers privacy-by-default principle; NFR-001 strict TypeScript.

- [ ] **T-008** [P] [US-002] `SanitizeModule` scaffold — `packages/services/ai-integration/src/ai/sanitize/sanitize.module.ts`
    - **Depends on**: T-001
    - **Implements**: FR-015, FR-016, NFR-001
    - Scaffold `SanitizeModule`, `SanitizeService`, `PiiPatterns` constants. Wire into `AiModule`.
    - **Acceptance**: Module registers; `SanitizeService` injectable.

- [ ] **T-009** [US-002] `SanitizeService` — PII detection + pseudonymization — `packages/services/ai-integration/src/ai/sanitize/sanitize.service.ts`
    - **Depends on**: T-008
    - **Implements**: FR-015, FR-016, FR-022, NFR-001
    - `sanitizeContext()` pseudonymizes user ID → stable hash token; strips email, phone, names, account IDs; replaces health conditions with category labels; preserves allergies/dietary preferences. `scanForPii()` detects email + name patterns.
    - **Acceptance**: Unit tests cover all PII pattern types; no PII leaves server in prompts.

---

## US-002 — Generate Recipe In-App

> Covers FR-016: System MUST call the user's configured AI provider to generate recipes based on criteria and return results within the app.

- [ ] **T-010** [P] [US-002] `AiModule` scaffold + provider resolution — `packages/services/ai-integration/src/ai/ai.module.ts`
    - **Depends on**: T-004, T-009
    - **Implements**: FR-016, NFR-001
    - Scaffold `AiModule`, `AiService`, `ProviderFactory`, AI types. `ProviderFactory` resolves `openai | anthropic | gemini | auto` to Vercel AI SDK provider instance.
    - **Acceptance**: Module registers; `AiService` injectable; provider resolution works for all supported providers.

- [ ] **T-011** [US-002] Prompt template seeding + `PromptTemplateService` — `packages/services/ai-integration/src/ai/prompts/prompt-template.service.ts`
    - **Depends on**: T-002, T-010
    - **Implements**: FR-016, NFR-001
    - Seed templates for `recipe_generation`, `meal_plan`, `shopping_list`, `nutrition_analysis`, `recipe_variation`. `getActiveTemplate(key)` returns current active version. Templates use `{{variable}}` interpolation only — never contain raw user data.
    - **Acceptance**: All templates seeded; active template resolution works; no raw user data in templates.

- [ ] **T-012** [US-002] `AiService.generateRecipe()` — async job enqueue — `packages/services/ai-integration/src/ai/ai.service.ts`
    - **Depends on**: T-010, T-011
    - **Implements**: FR-016, FR-017, FR-020, NFR-001
    - Calls `SanitizeService.sanitizeContext()` before prompt construction. Enqueues `AiGenerationJob` to SQS. Creates `ai_generation_records` row with `status: 'pending'`. Returns `{ jobId, status, estimatedWaitSeconds }`. `POST /ai/generate/recipe` returns `202`.
    - **Acceptance**: Sanitized prompts only; job record created; returns `202` with jobId.

- [ ] **T-013** [US-002] `GenerationQueueService` — SQS producer + consumer — `packages/services/ai-integration/src/ai/generation-queue.service.ts`
    - **Depends on**: T-012
    - **Implements**: FR-016, FR-017, FR-020, NFR-001
    - `enqueue()` sends `AiGenerationJob` to `ai-generation-queue`. `processJob()` fetches BYOK key, calls Vercel AI SDK `generateObject`, writes result to `recipes` table, updates `ai_generation_records` to `complete`. On failure: updates to `failed`, writes `error_message`, sends to DLQ after 3 retries. Max 1 concurrent job per user.
    - **Acceptance**: Jobs process end-to-end; failures go to DLQ after retries; concurrency enforced.

- [ ] **T-014** [US-002] `GET /ai/generate/recipe/:jobId` — poll endpoint — `packages/services/ai-integration/src/ai/ai.controller.ts`
    - **Depends on**: T-013
    - **Implements**: FR-016, FR-017, NFR-001
    - Returns `{ jobId, status, recipe?, provider, model, tokensUsed? }`. Status lifecycle: `pending → streaming → complete | failed`. `404` if jobId not found or belongs to different user.
    - **Acceptance**: Correct status lifecycle; `404` for unauthorized access.

- [ ] **T-015** [US-002] `AiService.streamRecipe()` — SSE streaming endpoint — `packages/services/ai-integration/src/ai/ai.controller.ts`
    - **Depends on**: T-012
    - **Implements**: FR-016, FR-017, NFR-001
    - `POST /ai/generate/recipe/stream` returns `text/event-stream`. Emits `data: {"partial": {...}}` chunks. Final event: `data: {"done": true, "recipe": {...}}`. Uses Vercel AI SDK `streamObject` → NestJS SSE. Updates `ai_generation_records` status to `streaming` then `complete`.
    - **Acceptance**: SSE stream delivers partial chunks; final event contains complete recipe.

---

## US-003 — Preview and Save Generated Recipe

> Covers FR-017 (preview before save), FR-020 (private default).

- [ ] **T-016** [US-003] Recipe preview + save flow — `packages/services/ai-integration/src/ai/dto/save-generated-recipe.dto.ts`
    - **Depends on**: T-015
    - **Implements**: FR-017, FR-020, NFR-001
    - Generated recipe returned in preview state (not auto-saved). `POST /ai/generate/recipe/:jobId/save` saves to `recipes` table as user-owned private recipe. `output_recipe_id` in `ai_generation_records` updated on save.
    - **Acceptance**: Preview shown before save; saved recipe is private; output_recipe_id linked.

---

## US-002 / US-006 — Extended Generation + Optimization

> Covers FR-016 (meal plan, shopping list), FR-019 (premium instruction optimization).

- [ ] **T-017** [US-002] `AiService.generateMealPlan()` + SSE endpoint — `packages/services/ai-integration/src/ai/dto/generate-meal-plan.dto.ts`
    - **Depends on**: T-013
    - **Implements**: FR-016, NFR-001
    - `POST /ai/generate/meal-plan` returns `202` with jobId. SSE variant streams partial meal plan. Completed job stores result in `meal_plans` table. `output_meal_plan_id` in `ai_generation_records` updated.
    - **Acceptance**: Async job pattern; SSE streaming variant; result stored in DB.

- [ ] **T-018** [US-002] Shopping list generation endpoint — `packages/services/ai-integration/src/ai/dto/generate-shopping-list.dto.ts`
    - **Depends on**: T-013
    - **Implements**: FR-016, NFR-001
    - `POST /ai/generate/shopping-list` accepts meal plan ID or ingredient list. Returns `202` with jobId; result stored in `shopping_lists` table.
    - **Acceptance**: Accepts both meal plan and ingredient inputs; result stored in DB.

- [ ] **T-019** [US-006] Recipe variation / instruction optimization endpoint — `packages/services/ai-integration/src/ai/dto/optimize-recipe.dto.ts`
    - **Depends on**: T-015
    - **Implements**: FR-019, NFR-001
    - `POST /ai/recipes/:id/optimize` accepts `{ mode: 'simplify' | 'streamline' }`. Premium guard rejects non-premium users with `403`. Returns optimized instructions as preview (not auto-saved).
    - **Acceptance**: Premium guard works; optimization returns preview; no auto-save.

### Admin — Prompt Template CMS

- [ ] **T-020** [US-002] `GET /ai/prompts` + `PUT /ai/prompts/:templateKey` (admin) — `packages/services/ai-integration/src/ai/prompts/prompt-template.controller.ts`
    - **Depends on**: T-011
    - **Implements**: FR-016, NFR-001
    - `GET /ai/prompts` lists active templates (admin-only guard). `PUT /ai/prompts/:key` creates new version, sets old version `is_active: false`. Non-admin requests return `403`.
    - **Acceptance**: Admin-only access; versioning works correctly.

---

## US-004 — External Agent OAuth Access

> Covers FR-018: OAuth 2.1-protected API for external agents with explicit consent and separate read/write scopes.

- [ ] **T-021** [US-004] `McpModule` scaffold + OAuth 2.1 guard — `packages/services/ai-integration/src/ai/mcp/mcp.module.ts`
    - **Depends on**: T-002
    - **Implements**: FR-018, NFR-001
    - Scaffold `McpModule`, `McpOAuthGuard`, `McpOAuthStrategy`. Guard validates the `Authorization: Bearer` session token networklessly via `verifyToken` (`@clerk/backend`) using the public `CLERK_JWT_KEY`, enforcing authorized parties (`azp`) via `CLERK_AUTHORIZED_PARTIES`. Token must carry the MCP resource scope (`resource` indicator `https://api.commise.io/mcp`, RFC 8707). Requests without valid token return `401`. PKCE flow supported.
    - **Acceptance**: Guard rejects invalid tokens; PKCE flow works.

- [ ] **T-022** [US-004] OAuth 2.1 discovery endpoints — `packages/services/ai-integration/src/ai/mcp/mcp.controller.ts`
    - **Depends on**: T-021
    - **Implements**: FR-018
    - `GET /.well-known/oauth-protected-resource` returns RFC 9728 metadata. `GET /.well-known/oauth-authorization-server` returns the Clerk instance's AS metadata. Both publicly accessible.
    - **Acceptance**: Discovery endpoints return correct metadata; no auth required.

- [ ] **T-023** [US-004] `McpServerService` — JSON-RPC 2.0 handler — `packages/services/ai-integration/src/ai/mcp/mcp-server.service.ts`
    - **Depends on**: T-021
    - **Implements**: FR-018, NFR-001
    - `POST /mcp` accepts JSON-RPC 2.0 single and batch requests. Routes to correct tool handler. Returns JSON-RPC 2.0 response envelope. Invalid method returns `{"error": {"code": -32601, "message": "Method not found"}}`.
    - **Acceptance**: Single + batch requests work; correct error for invalid methods.

- [ ] **T-024** [US-004] MCP tool: `recipes_list` + `recipe_get` — `packages/services/ai-integration/src/ai/mcp/tools/recipes.tool.ts`
    - **Depends on**: T-023
    - **Implements**: FR-018
    - `recipes_list` returns user's recipe collection (scoped to `recipes:read`). `recipe_get` returns single recipe by ID. Scope check: `403` if token lacks `recipes:read`. Only returns recipes owned by authenticated user.
    - **Acceptance**: Scope enforcement works; only own recipes returned.

- [ ] **T-025** [US-004] MCP tool: `recipe_save` — `packages/services/ai-integration/src/ai/mcp/tools/recipes.tool.ts`
    - **Depends on**: T-024
    - **Implements**: FR-018, FR-020
    - `recipe_save` creates recipe in `recipes` table as user-owned private recipe. Requires `recipes:create` scope. AI-generated recipes saved via agent treated identically to in-app saves. Returns saved recipe ID.
    - **Acceptance**: Private default enforced; scope checked; returns recipe ID.

- [ ] **T-026** [US-004] MCP tools: `meal_plans_list`, `meal_plan_get`, `ingredient_search` — `packages/services/ai-integration/src/ai/mcp/tools/meal-plans.tool.ts`
    - **Depends on**: T-025
    - **Implements**: FR-018
    - `meal_plans_list` / `meal_plan_get` require `meal-plans:read` scope. `ingredient_search` searches user's ingredient inventory. All tools scope-checked; unauthorized returns `403`.
    - **Acceptance**: All tools scope-checked; unauthorized returns `403`.

---

## US-005 — Revoke Agent Access

> Covers FR-021: System MUST allow users to revoke external agent authorizations at any time.

- [ ] **T-027** [US-005] OAuth consent management — grant + revoke — `packages/services/ai-integration/src/ai/mcp/consent/consent.service.ts`
    - **Depends on**: T-021
    - **Implements**: FR-018, FR-021, NFR-001
    - OAuth consent flow stores grant in `mcp_oauth_consents`. `DELETE /ai/mcp/consents/:clientId` revokes consent (sets `is_revoked: true`). Revoked tokens rejected by OAuth guard. User can revoke at any time.
    - **Acceptance**: Consent stored on grant; revocation invalidates tokens; revocable at any time.

- [ ] **T-028** [US-005] OAuth consent management UI — app settings page — `packages/apps/commise/web/src/app/settings/agent-connections/page.tsx`
    - **Depends on**: T-027
    - **Implements**: FR-018, FR-021, NFR-003, NFR-004
    - Lists active external agent authorizations with platform name, granted scopes, grant date. Revoke button per connection. Accessible: all interactive elements queryable via `getByRole`/`getByLabel`. Color not sole conveyor of state.
    - **Acceptance**: UI lists all active connections; revoke functional; accessible.

---

## US-007 — EU AI Act Compliance + Guard Messaging

> Covers FR-022: Confidence indicator and guard message on every AI-generated output surface.

- [ ] **T-029** [US-007] EU AI Act disclosure strings + watermark component — `packages/apps/commise/web/src/components/ai/ai-disclosure-banner.tsx`
    - **Depends on**: T-015, T-017
    - **Implements**: FR-022, NFR-003, NFR-004
    - All AI-generated outputs display: "AI-generated content may be inaccurate. Verify before use." Nutrition advice additionally displays: "This is not medical advice. Consult a qualified professional." Disclosure visible in loading state. Accessible: text readable by screen readers.
    - **Acceptance**: Disclosures shown on all AI outputs; nutrition variant when applicable; accessible.

- [ ] **T-030** [US-007] `ai_generation_records` audit log writes for all generation paths — `packages/services/ai-integration/src/ai/audit/audit-log.service.ts`
    - **Depends on**: T-013, T-015, T-017, T-018
    - **Implements**: FR-016, FR-017, FR-019, FR-020, NFR-001
    - Every generation request writes to `ai_generation_records` (pending → complete/failed). `source_prompt_hash` = SHA-256 of sanitized prompt (no raw prompt stored). `input_token_count`, `output_token_count`, `estimated_cost_usd` populated on completion. `completed_at` set on terminal status.
    - **Acceptance**: All generation paths audited; no raw prompts stored; metrics populated.

---

## Resilience & Infrastructure

- [ ] **T-031** [US-002] Circuit breaker middleware for Secrets Manager + AI provider calls — `packages/services/ai-integration/src/ai/providers/provider-factory.ts`
    - **Depends on**: T-004, T-013
    - **Implements**: FR-015, FR-016, NFR-001
    - `@CircuitBreaker({ timeout: 3000, threshold: 5, resetTimeout: 30000 })` on `getByokKey()`. Circuit breaker on AI provider calls. Open circuit returns `503` with `Retry-After` header.
    - **Acceptance**: Circuit opens after threshold; returns `503` with `Retry-After`.

- [ ] **T-032** [US-002] Per-user generation throttle (max 1 concurrent job) — `packages/services/ai-integration/src/ai/guards/concurrency.guard.ts`
    - **Depends on**: T-013
    - **Implements**: FR-016, NFR-001
    - Second concurrent generation request from same user returns `429`. Concurrency state tracked in `ai_generation_records` (count of `status: 'pending' | 'streaming'`).
    - **Acceptance**: Concurrent requests rejected with `429`; state tracked correctly.

- [ ] **T-033** [US-006] Rate limit middleware (Pro tier: 500 req/month) — `packages/services/ai-integration/src/ai/guards/rate-limit.guard.ts`
    - **Depends on**: T-030
    - **Implements**: FR-019, NFR-001
    - Pro users: 500 generation requests/month; counter resets on 1st of month. Free (BYOK only): no platform limit. Exceeded limit returns `429` with `X-RateLimit-Reset` header.
    - **Acceptance**: Pro tier limit enforced; free tier unlimited; correct headers on `429`.

- [ ] **T-034** [P] [US-002] CDK stack: SQS `ai-generation-queue` + DLQ — `packages/cdk/stacks/ai-integration.stack.ts`
    - **Depends on**: T-002
    - **Implements**: FR-016, NFR-001
    - `ai-generation-queue` created with visibility timeout 120s. DLQ `ai-generation-dlq` with max receives 3. Both encrypted with AWS managed KMS. CloudWatch alarm on DLQ depth > 0.
    - **Acceptance**: Queue + DLQ created; encryption enabled; DLQ alarm configured.

- [ ] **T-035** [P] [US-002] CDK stack: SNS `ai-events` topic (optional cross-service) — `packages/cdk/stacks/ai-integration.stack.ts`
    - **Depends on**: T-002
    - **Implements**: FR-016, NFR-001
    - `ai-events` SNS topic for cross-service notifications. Encrypted. Optional subscription from downstream services.
    - **Acceptance**: Topic created; encrypted; subscriptions possible.

---

## Testing

- [ ] **T-036** [P] [US-001] Unit tests: `ByokService` — `packages/services/ai-integration/tests/unit/byok.service.spec.ts`
    - **Depends on**: T-004
    - **Implements**: FR-015, NFR-001
    - Test store, delete, get, list operations. Mock Secrets Manager. Verify raw key never returned in list. Verify invalid key rejection.
    - **Acceptance**: >90% branch coverage; all CRUD paths tested.

- [ ] **T-037** [P] [US-002] Unit tests: `SanitizeService` — `packages/services/ai-integration/tests/unit/sanitize.service.spec.ts`
    - **Depends on**: T-009
    - **Implements**: FR-016, FR-022, NFR-001
    - Test all PII pattern types: email, phone, name, account ID, health conditions. Verify pseudonymization stability (same input → same token). Verify dietary preferences preserved.
    - **Acceptance**: All PII patterns covered; pseudonymization deterministic.

- [ ] **T-038** [P] [US-004] Unit tests: `McpServerService` + OAuth guard — `packages/services/ai-integration/tests/unit/mcp-server.service.spec.ts`
    - **Depends on**: T-023, T-024
    - **Implements**: FR-018, FR-021, NFR-001
    - Test JSON-RPC routing, tool execution, scope enforcement, consent revocation. Stub `ClerkAuthService`/`verifyToken` (networkless, public `CLERK_JWT_KEY`). Test batch requests.
    - **Acceptance**: >90% branch coverage; scope enforcement tested.

- [ ] **T-039** [US-002] Integration test: BYOK key store + recipe generation flow — `packages/services/ai-integration/tests/integration/byok-recipe-flow.spec.ts`
    - **Depends on**: T-007, T-014
    - **Implements**: FR-015, FR-016, FR-017, FR-020
    - End-to-end: store BYOK key → request generation → poll for result → save recipe → verify private. Mock AI provider or use test key.
    - **Acceptance**: Full flow passes; recipe saved as private.

- [ ] **T-040** [US-002] Integration test: SQS async job lifecycle — `packages/services/ai-integration/tests/integration/sqs-job-lifecycle.spec.ts`
    - **Depends on**: T-013
    - **Implements**: FR-016, FR-020
    - Test enqueue → process → complete flow. Test retry behavior. Test DLQ after max retries. Test concurrent job rejection.
    - **Acceptance**: Job lifecycle correct; retries and DLQ work; concurrency enforced.

- [ ] **T-041** [US-002] E2E test: SSE streaming — `packages/apps/commise/web/tests/e2e/ai/sse-streaming.spec.ts`
    - **Depends on**: T-015
    - **Implements**: FR-016, FR-017, NFR-003
    - `POST /ai/generate/recipe/stream` returns `text/event-stream`. Partial chunks received before final `done: true` event. Network capture verifies streaming (not buffered).
    - **Acceptance**: SSE works end-to-end; partial chunks visible; not buffered.

- [ ] **T-042** [US-004] E2E test: MCP OAuth 2.1 PKCE flow — `packages/apps/commise/web/tests/e2e/ai/mcp-oauth-flow.spec.ts`
    - **Depends on**: T-027
    - **Implements**: FR-018, FR-021
    - OAuth 2.1 PKCE consent flow completes end-to-end. Agent calls `recipes_list` and `recipe_save` with Bearer token. Revoke consent → subsequent agent calls return `401`.
    - **Acceptance**: PKCE flow works; agent calls succeed; revocation invalidates token.

---

## Phase 5F: Mobile Parity

> **Why this phase exists**: Mobile app requires dedicated implementation for all user-facing AI flows. Mobile is not a thin wrapper — it has distinct navigation patterns, screen constraints, and native capabilities (haptics, secure storage).

### US-001 / US-003 — Mobile: BYOK Provider Setup

- [ ] **T-043** [P] [US-001] Mobile: BYOK provider configuration screen — `packages/apps/commise/mobile/src/screens/settings/AiProviderScreen.tsx`
    - **Depends on**: T-007
    - **Implements**: FR-015, NFR-003, NFR-004
    - Screen lists configured providers with status (active / not configured). Add/replace key flow: provider picker → secure text input → save → confirmation. Delete key flow: swipe-to-delete or explicit remove button with confirmation dialog. Raw key never stored in device storage; only confirmation of ARN returned from API. Accessible: all inputs have labels queryable via `getByRole`/`getByLabel`. Color not sole conveyor of state.
    - **Acceptance**: Provider config works; raw key not stored locally; accessible.

### US-002 — Mobile: AI Recipe Generation + Preview

- [ ] **T-044** [P] [US-002] Mobile: AI recipe generation entry point + prompt input — `packages/apps/commise/mobile/src/screens/ai/GenerateRecipeScreen.tsx`
    - **Depends on**: T-043, T-016
    - **Implements**: FR-016, FR-022, NFR-003, NFR-004
    - User can enter ingredients, dietary constraints, cuisine, serving count. "Generate" button calls `POST /ai/generate/recipe` (async job) or stream variant. Loading state shows EU AI Act disclosure: "AI is generating your recipe..." with disclosure text visible. Accessible: form fields labeled; generate button has accessible name.
    - **Acceptance**: Prompt input works; generation triggered; disclosure shown during load.

- [ ] **T-045** [P] [US-003] Mobile: AI recipe preview + save/discard flow — `packages/apps/commise/mobile/src/screens/ai/RecipePreviewScreen.tsx`
    - **Depends on**: T-044
    - **Implements**: FR-017, FR-020, FR-022, NFR-003, NFR-004
    - Generated recipe displayed in preview state (not auto-saved). Compact `AiGuardBanner` visible above recipe content: "AI-generated content may be inaccurate. Verify before use." Banner not dismissible on first 3 views; collapses to icon with tooltip after that. "Save to my recipes" calls save endpoint; saved recipe is private. "Discard" discards without saving.
    - **Acceptance**: Preview before save; guard banner rules enforced; private save.

- [ ] **T-046** [P] [US-002] Mobile: SSE streaming display for recipe generation — `packages/apps/commise/mobile/src/components/ai/StreamingRecipeCard.tsx`
    - **Depends on**: T-044
    - **Implements**: FR-016, FR-022, NFR-003, NFR-004
    - Streaming variant of recipe card that updates in real-time as SSE chunks arrive. Shows partial ingredients, steps, title as they stream. Final state transitions to full preview. Error state if stream fails. Loading state with EU AI Act disclosure.
    - **Acceptance**: Real-time updates from SSE; error handling; disclosure visible.

### US-006 — Mobile: Premium Instruction Optimization

- [ ] **T-047** [P] [US-006] Mobile: Instruction optimization entry point (Premium gate) — `packages/apps/commise/mobile/src/screens/ai/OptimizeRecipeScreen.tsx`
    - **Depends on**: T-045, T-019
    - **Implements**: FR-019, FR-022, NFR-003, NFR-004
    - From recipe detail screen, "Optimize instructions" option (premium users only). Mode picker: "Simplify" or "Streamline". Calls `POST /ai/recipes/:id/optimize`. Displays optimized instructions in preview. "Replace original" or "Discard". Non-premium users see upgrade prompt instead of mode picker.
    - **Acceptance**: Premium gate works; optimization preview shown; upgrade prompt for free users.

### US-004 / US-005 — Mobile: External Agent Consent + Revocation

- [ ] **T-048** [P] [US-004] Mobile: External agent consent screen (two-step OAuth) — `packages/apps/commise/mobile/src/screens/settings/AgentConsentScreen.tsx`
    - **Depends on**: T-027
    - **Implements**: FR-018, NFR-003, NFR-004
    - Two distinct consent checkboxes (not bundled): "Allow agent to read my recipes" (`recipes:read`) and "Allow agent to save recipes for me" (`recipes:create`). User can grant read without write. Clear platform name and scope description. Confirm button disabled until at least one scope selected.
    - **Acceptance**: Two-step consent; read without write possible; confirm disabled until selection.

- [ ] **T-049** [P] [US-005] Mobile: Agent connection list + revocation — `packages/apps/commise/mobile/src/screens/settings/AgentConnectionsScreen.tsx`
    - **Depends on**: T-048
    - **Implements**: FR-021, NFR-003, NFR-004
    - Lists active external agent connections with platform name, granted scopes, grant date. Revoke button per connection with confirmation dialog. After revocation, connection removed from list. Empty state when no connections.
    - **Acceptance**: List shows active connections; revoke with confirmation; empty state handled.

### US-007 — Mobile: Guard Messaging

- [ ] **T-050** [P] [US-007] Mobile: `AiGuardBanner` component + view-count persistence — `packages/apps/commise/mobile/src/components/ai/AiGuardBanner.tsx`
    - **Depends on**: T-045
    - **Implements**: FR-022, NFR-003, NFR-004
    - Reusable banner component for all AI-generated content surfaces. Full text on first 3 views: "AI-generated content may be inaccurate. Verify before use." After 3 views: collapses to icon with tooltip. View count persisted in AsyncStorage per user. Nutrition variant includes additional medical disclaimer. Cannot be disabled.
    - **Acceptance**: View count persisted; collapse after 3 views; nutrition variant shown; not dismissible.

---

## Summary by User Story

| User Story                                        | Priority | Tasks                                                                   | FR / AC Coverage |
| ------------------------------------------------- | -------- | ----------------------------------------------------------------------- | ---------------- |
| US-001: Configure AI Provider (BYOK)              | P2       | T-001–T-007, T-036, T-043                                               | FR-015           |
| US-002: Generate Recipe In-App                    | P2       | T-008–T-016, T-017–T-018, T-031–T-035, T-037, T-039–T-041, T-044, T-046 | FR-016, FR-022   |
| US-003: Preview and Save Generated Recipe         | P2       | T-016, T-045                                                            | FR-017, FR-020   |
| US-004: External Agent OAuth Access               | P2       | T-021–T-026, T-038, T-042, T-048                                        | FR-018, FR-020   |
| US-005: Revoke Agent Access                       | P2       | T-027–T-028, T-049                                                      | FR-021           |
| US-006: Recipe Instruction Optimization (Premium) | P2       | T-019, T-033, T-047                                                     | FR-019           |
| US-007: EU AI Act Compliance + Guard Messaging    | P0       | T-029–T-030, T-050                                                      | FR-022           |

## Summary by Phase

| Phase                    | Tasks       | Description                                                         |
| ------------------------ | ----------- | ------------------------------------------------------------------- |
| 5A: Foundation           | T-001–T-009 | DB schema, migration, BYOK module, sanitize module                  |
| 5B: Core Generation      | T-010–T-016 | AiModule, recipe generation, SSE streaming, job queue, preview/save |
| 5C: Extended Generation  | T-017–T-020 | Meal plan, shopping list, optimization, prompt CMS                  |
| 5D: External Agent / MCP | T-021–T-028 | MCP server, OAuth 2.1, consent management, UI                       |
| 5E: Compliance & Polish  | T-029–T-042 | EU AI Act, audit log, circuit breakers, rate limits, CDK, tests     |
| 5F: Mobile Parity        | T-043–T-050 | Mobile screens for BYOK, generation, preview, consent, guard banner |

## Open Questions (from plan.md §8)

> These must be resolved before the affected tasks can be completed:

- **OQ-5** (blocks EU user traffic): Anthropic/OpenAI DPA + SCCs must be executed before EU user prompts flow. Affects T-012, T-013, T-015.
- **OQ-6** (blocks premium gating): Subscription tier check endpoint from 010-subscriptions must be available. Affects T-019, T-033, T-047.
