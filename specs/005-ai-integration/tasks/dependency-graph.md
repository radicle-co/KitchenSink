# Dependency Graph — Feature 005 (AI Integration)

**Derived**: 2026-08-05 · **Source**: `specs/005-ai-integration/tasks.md` (2026-08-02, 94 live tasks),
`plan.md`, and the actual repository layout on `main`.

> **What this is.** `tasks.md` carries no `[P]` markers and no `Depends on:` fields. This document
> derives the graph from evidence — declared `Paths:`, `Test-first:` flags, `Implements:`/`Notes:`
> producer-consumer wording, and the real package structure in the worktree — and turns it into a
> dispatchable wave plan.
>
> **What this is not.** It is not an amendment to `tasks.md`. Every inference is labelled; every place
> the task list is silent or self-contradictory is flagged in §5 rather than guessed. **Read §5 before
> dispatching wave 1** — four of the flags (unowned `app.module.ts`, unowned package-`json` dependency
> surface, the i18n path, the unimplemented client package) will manufacture write conflicts that this
> graph cannot see, because the tasks that cause them do not declare the paths.

---

## 0. Conventions used here

**Path prefixes** (to keep the table readable):

| Prefix  | Expands to                           |
| ------- | ------------------------------------ |
| `AS/`   | `packages/services/ai-service/`      |
| `AW/`   | `packages/services/ai-workers/`      |
| `AC/`   | `packages/clients/ai-service/`       |
| `FA/`   | `packages/apps/commise/features/ai/` |
| `WEB/`  | `packages/apps/commise/web/`         |
| `MOB/`  | `packages/apps/commise/mobile/`      |
| `CV/`   | `packages/shared/clerk-verify/`      |
| `I18N/` | `packages/apps/commise/i18n/`        |
| `LT/`   | `packages/tools/loadtest/`           |

**Dispatch unit.** The unit of dispatch is **not** the task — it is the **TDD unit**: a `Test-first`
task plus the implementation task it covers, given to **one** agent that drives red→green. Splitting a
pair across two agents violates `CLAUDE.md` §TDD (the impl agent would not have written the failing
test) and invites contract drift, because the test agent must invent the API surface the impl agent
then has to guess. Units are labelled `U-xx` and are the thing you fan out.

**Size → days** (for critical-path arithmetic, per `tasks.md` "Conventions"):
`XS = 0.125d` · `S = 0.5d` · `M = 1d` · `L = 2d`.

**`[P]`-eligible** answers: _can this task run concurrently with the other tasks in its wave?_ A task
inside a unit is `[P]` at unit granularity — it runs concurrently with **other units**, and strictly
ordered **within** its own unit.

---

## 1. Task table — write-paths → depends-on → `[P]`

`↳` marks the ordered edge inside a unit (test before impl).

| Task | Size | Write-paths                                                                                                                                   | Depends on                                | Unit | Wave | `[P]`               | Reason                                                                                                                                                       |
| ---- | ---- | --------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- | ---- | ---- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| T001 | M    | `AS/package.json`, `tsconfig.json`, `vitest{,.integration,.e2e}.config.ts`                                                                    | —                                         | U-01 | 1    | yes                 | New package, no writer overlaps. Gates every `AS/**` task.                                                                                                   |
| T002 | S    | `AW/package.json`, `tsconfig.json`, `vitest{,.integration}.config.ts`                                                                         | —                                         | U-02 | 1    | yes                 | New package, disjoint from T001. Gates every `AW/**` task.                                                                                                   |
| T003 | S    | `AC/package.json`, `tsconfig.json`, `vitest{,.integration}.config.ts`                                                                         | —                                         | U-03 | 1    | yes                 | New package, disjoint. **See F-04 — nothing implements this package.**                                                                                       |
| T004 | S    | `FA/package.json`, `tsconfig.json`, `vitest.config.ts`                                                                                        | —                                         | U-04 | 1    | yes                 | New package, disjoint. Gates every `FA/**` task.                                                                                                             |
| T022 | M    | `CV/src/__tests__/agentActorToken.test.ts`                                                                                                    | —                                         | U-05 | 1    | yes                 | Existing package; **zero 005 dependencies**. Phase 5B task that is genuinely wave-1 work.                                                                    |
| T023 | M    | `CV/src/clerkVerify.ts`, `CV/src/index.ts`                                                                                                    | ↳T022                                     | U-05 | 1    | yes                 | **Modifies existing shared files** consumed by identity/recipe/food — see F-09 (repo-wide contention, not 005-internal).                                     |
| T073 | S    | `I18N/src/locales/en/ai.json`                                                                                                                 | —                                         | U-06 | 1    | yes                 | **Path does not match the repo's i18n convention — see F-01.** As declared it collides with nothing; as conventionally implemented it collides with 5 tasks. |
| T084 | M    | `LT/ai-generation.js`                                                                                                                         | —                                         | U-07 | 1    | yes                 | Existing package, new file. Writable now; **not runnable** until T085 + T086 + a deploy (F-11).                                                              |
| T005 | S    | `AS/src/database/schema/__tests__/schema.test.ts`                                                                                             | T001                                      | U-08 | 2    | yes                 | Test-first for T006.                                                                                                                                         |
| T006 | M    | `AS/src/database/schema/{ai-generation-records,user-byok-keys,mcp-agent-grants,prompt-templates}.ts`                                          | ↳T005                                     | U-08 | 2    | yes                 | Producer for every DAL/service that persists. Also silently needed by `AW/` (F-06).                                                                          |
| T009 | S    | `AS/src/config/__tests__/env.schema.test.ts`                                                                                                  | T001                                      | U-09 | 2    | yes                 | Test-first for T010.                                                                                                                                         |
| T010 | S    | `AS/src/config/{env.schema.ts,config.types.ts}`                                                                                               | ↳T009                                     | U-09 | 2    | yes                 | Producer for anything reading env (T012, T025, T052, T081, T083).                                                                                            |
| T013 | S    | `AS/src/byok/__tests__/byok.validator.test.ts`                                                                                                | T001                                      | U-10 | 2    | yes                 | Test-first for T014.                                                                                                                                         |
| T014 | S    | `AS/src/byok/byok.validator.ts`                                                                                                               | ↳T013                                     | U-10 | 2    | yes                 | Pure format checks + provider ping; no schema/config coupling. Producer for T012.                                                                            |
| T026 | M    | `AS/src/mcp/__tests__/mcp-server.service.test.ts`                                                                                             | T001                                      | U-11 | 2    | yes                 | Test-first for T027.                                                                                                                                         |
| T027 | M    | `AS/src/mcp/mcp-server.service.ts`                                                                                                            | ↳T026                                     | U-11 | 2    | yes                 | JSON-RPC envelope only; dispatch is injected, so it does **not** depend on the registry (T029).                                                              |
| T092 | M    | `AS/src/validation/__tests__/recipe-sanity.validator.test.ts`                                                                                 | T001                                      | U-12 | 2    | yes                 | Test-first for T093.                                                                                                                                         |
| T093 | M    | `AS/src/validation/recipe-sanity.validator.ts`                                                                                                | ↳T092                                     | U-12 | 2    | yes                 | Pure Specification module — **no I/O, no DB, no config**. Listed near the end of the file; it is wave-2 work.                                                |
| T041 | M    | `AW/src/sanitize/__tests__/sanitize.service.test.ts`                                                                                          | T002                                      | U-13 | 2    | yes                 | Test-first for T042.                                                                                                                                         |
| T042 | L    | `AW/src/sanitize/sanitize.service.ts`                                                                                                         | ↳T041                                     | U-13 | 2    | yes                 | Phase 5C task with **no 5A/5B dependency** — real hidden parallelism.                                                                                        |
| T078 | S    | `AW/src/resilience/__tests__/breaker.test.ts`                                                                                                 | T002                                      | U-14 | 2    | yes                 | Test-first for T079.                                                                                                                                         |
| T079 | S    | `AW/src/resilience/breaker.ts`                                                                                                                | ↳T078                                     | U-14 | 2    | yes                 | Library wrapper (`opossum`/`cockatiel`); Phase 5F task that is wave-2 work.                                                                                  |
| T063 | M    | `FA/src/guard/__tests__/AiGuardBanner.test.tsx`                                                                                               | T004, T073                                | U-15 | 2    | yes                 | Test-first for T064. Needs the localized strings to assert on.                                                                                               |
| T064 | M    | `FA/src/guard/AiGuardBanner.tsx`, `FA/src/guard/types.ts`                                                                                     | ↳T063, T073                               | U-15 | 2    | yes                 | Pure `props → JSX`; no backend dependency.                                                                                                                   |
| T065 | S    | `FA/src/guard/__tests__/ConfidenceIndicator.test.tsx`                                                                                         | T004, T073                                | U-16 | 2    | yes                 | Test-first for T066. **T095 later amends this file — see F-08.**                                                                                             |
| T066 | S    | `FA/src/guard/ConfidenceIndicator.tsx`                                                                                                        | ↳T065                                     | U-16 | 2    | yes                 | **Conflicts with T095 (C-02)** — must never share a wave with it.                                                                                            |
| T069 | M    | `FA/src/agents/__tests__/AgentConsent.test.tsx`                                                                                               | T004, T073                                | U-17 | 2    | yes                 | Test-first for T070.                                                                                                                                         |
| T070 | M    | `FA/src/agents/AgentConsent.tsx`                                                                                                              | ↳T069                                     | U-17 | 2    | yes                 | Pure render component; no client call (consent submission is the app's concern).                                                                             |
| T085 | L    | `AS/infra/lib/ai-service-stack.ts`, `AS/infra/bin/app.ts`                                                                                     | T001, T002                                | U-18 | 2    | yes                 | Own directory tree; only needs the packages to exist. Phase 5F task that unblocks nothing else but T086.                                                     |
| T039 | S    | `AS/docs/clerk-setup.md`                                                                                                                      | T001                                      | U-19 | 2    | yes                 | Docs + a Clerk-dashboard toggle. Disjoint from all code.                                                                                                     |
| T087 | M    | `AS/src/common/__tests__/apiRoutePaths.test.ts`                                                                                               | T001                                      | U-20 | 2    | yes                 | Decorator-metadata tier, no HTTP/DB. **Stays red until the last controller lands — it is an end-gate, not a wave-2 deliverable (F-10).**                     |
| T007 | M    | `AS/tests/migration.integration.test.ts`                                                                                                      | T001                                      | U-21 | 3    | yes                 | Test-first for T008.                                                                                                                                         |
| T008 | M    | `AS/src/database/migrations/0001_ai_initial.sql`                                                                                              | ↳T007, T006                               | U-21 | 3    | yes                 | SQL must match the Drizzle schema (drizzle-kit generates from it).                                                                                           |
| T011 | M    | `AS/src/byok/__tests__/byok.service.test.ts`                                                                                                  | T001                                      | U-22 | 3    | yes                 | Test-first for T012.                                                                                                                                         |
| T012 | M    | `AS/src/byok/byok.service.ts`                                                                                                                 | ↳T011, T006, T010, T014                   | U-22 | 3    | yes                 | Depends on **T014** — the validator must reject before any Secrets Manager write (T013 note). False parallelism inside 5A.                                   |
| T018 | M    | `AS/src/mcp/policy/__tests__/grant.policy.test.ts`                                                                                            | T001                                      | U-23 | 3    | yes                 | Test-first for T019.                                                                                                                                         |
| T019 | M    | `AS/src/mcp/policy/grant.policy.ts`                                                                                                           | ↳T018, T006, T010                         | U-23 | 3    | yes                 | Reads `mcp_agent_grants`. **Grant lookup may belong to T035's DAL — see F-05 (possible inverted order).**                                                    |
| T024 | M    | `AS/src/mcp/auth/__tests__/actor-token.service.test.ts`                                                                                       | T001                                      | U-24 | 3    | yes                 | Test-first for T025.                                                                                                                                         |
| T025 | M    | `AS/src/mcp/auth/actor-token.service.ts`                                                                                                      | ↳T024, T010, T023                         | U-24 | 3    | yes                 | Sole holder of the Clerk mint key; consumes the `act` gate from T023.                                                                                        |
| T043 | M    | `AW/src/generation/__tests__/idempotency.test.ts`                                                                                             | T002                                      | U-25 | 3    | yes                 | Test-first for T044.                                                                                                                                         |
| T044 | M    | `AW/src/generation/generation.worker.ts`                                                                                                      | ↳T043, T006                               | U-25 | 3    | yes                 | Claims by inserting `ai_generation_records` — **a table owned by `AS/` with no shared package (F-06).**                                                      |
| T051 | S    | `AS/src/prompts/__tests__/prompt-template.service.test.ts`                                                                                    | T001                                      | U-26 | 3    | yes                 | Test-first for T052.                                                                                                                                         |
| T052 | M    | `AS/src/prompts/{prompt-template.service,prompt-template.controller}.ts`, `AS/src/database/seed/prompt-templates.seed.ts`                     | ↳T051, T006, T010                         | U-26 | 3    | yes                 | **`ScopesGuard`/`@RequireScopes` exist only in identity-service — F-07.**                                                                                    |
| T082 | M    | `AS/src/audit/__tests__/audit.service.test.ts`                                                                                                | T001                                      | U-27 | 3    | yes                 | Test-first for T083.                                                                                                                                         |
| T083 | M    | `AS/src/audit/audit.service.ts`                                                                                                               | ↳T082, T006, T010                         | U-27 | 3    | yes                 | Writes `ai_generation_records`. Phase 5F task that is wave-3 work.                                                                                           |
| T067 | M    | `FA/src/byok/__tests__/ProviderForm.test.tsx`                                                                                                 | T004, T073                                | U-28 | 3    | yes                 | Test-first for T068.                                                                                                                                         |
| T068 | M    | `FA/src/byok/ProviderForm.tsx`, `FA/src/byok/useByokKeys.ts`                                                                                  | ↳T067, T003                               | U-28 | 3    | yes                 | The hook calls `@kitchensink/ai-service-client` — **which no task implements (F-04).**                                                                       |
| T071 | M    | `FA/src/agents/__tests__/AgentConnections.test.tsx`                                                                                           | T004, T073                                | U-29 | 3    | yes                 | Test-first for T072.                                                                                                                                         |
| T072 | M    | `FA/src/agents/AgentConnections.tsx`, `FA/src/agents/useAgentGrants.ts`                                                                       | ↳T071, T003                               | U-29 | 3    | yes                 | Same client gap (F-04).                                                                                                                                      |
| T020 | S    | `AS/src/mcp/policy/__tests__/visibility.policy.test.ts`                                                                                       | T001                                      | U-30 | 4    | yes                 | Test-first for T021.                                                                                                                                         |
| T021 | S    | `AS/src/mcp/policy/visibility.policy.ts`                                                                                                      | ↳T020, T019                               | U-30 | 4    | yes                 | Title says "in `GrantPolicy`" but `Paths:` lists only the new file — **latent conflict with T019's file (C-04)**.                                            |
| T015 | M    | `AS/tests/byok.integration.test.ts`                                                                                                           | T001                                      | U-31 | 4    | yes                 | Test-first covering T012/T014/T016 against LocalStack.                                                                                                       |
| T017 | S    | `AS/tests/e2e/byok.e2e.test.ts`                                                                                                               | T001                                      | U-31 | 4    | yes                 | Test-first for T016's HTTP surface. Needs a bootable app — **F-02**.                                                                                         |
| T016 | M    | `AS/src/byok/{byok.controller,byok.module}.ts`, `AS/src/byok/dto/store-byok-key.dto.ts`                                                       | ↳T015, ↳T017, T012, T010                  | U-31 | 4    | yes                 | Must register in `app.module.ts` — **unowned (F-02)**.                                                                                                       |
| T028 | S    | `AS/src/mcp/tools/__tests__/registry.test.ts`                                                                                                 | T001                                      | U-32 | 4    | yes                 | Test-first for T029.                                                                                                                                         |
| T029 | M    | `AS/src/mcp/tools/{registry,recipes.tool}.ts`                                                                                                 | ↳T028, T019, T025                         | U-32 | 4    | yes                 | Handlers consult the policy and mint actor tokens. `registry.ts` becomes a **contended file (C-03)**.                                                        |
| T049 | S    | `AW/src/providers/__tests__/provider.resolver.test.ts`                                                                                        | T002                                      | U-33 | 4    | yes                 | Test-first for T050.                                                                                                                                         |
| T050 | S    | `AW/src/providers/provider.resolver.ts`                                                                                                       | ↳T049, T012                               | U-33 | 4    | yes                 | "Missing BYOK key → guiding error" ⇒ it consults the key store owned by T012 across a package boundary.                                                      |
| T045 | M    | `AS/src/generation/__tests__/generation.service.test.ts`                                                                                      | T001                                      | U-34 | 4    | yes                 | Test-first for T046.                                                                                                                                         |
| T046 | M    | `AS/src/generation/{generation.service,generation.controller}.ts`, `AS/src/generation/dto/generate-recipe.dto.ts`                             | ↳T045, T006, T010, T042                   | U-34 | 4    | yes                 | T045 asserts sanitization runs before enqueue, but `SanitizeService` lives in `AW/` — **contract contradiction, F-03**.                                      |
| T034 | M    | `AS/tests/grant-lifecycle.integration.test.ts`                                                                                                | T001                                      | U-35 | 4    | yes                 | Test-first for T035.                                                                                                                                         |
| T035 | M    | `AS/src/mcp/grants/{grants.dal,grants.controller,grants.service}.ts`                                                                          | ↳T034, T006, T019                         | U-35 | 4    | yes                 | Ordered after T019 as listed; see F-05 for the inversion risk.                                                                                               |
| T030 | M    | `AS/src/mcp/tools/__tests__/recipe-save.tool.test.ts`                                                                                         | T001                                      | U-36 | 5    | yes                 | Test-first for T031.                                                                                                                                         |
| T038 | L    | `AS/tests/cross-service-scope.integration.test.ts`                                                                                            | T001                                      | U-36 | 5    | yes                 | Test-first: the end-to-end D-001 proof for T031's behaviour. Co-dispatch with T030/T031.                                                                     |
| T031 | M    | `AS/src/mcp/tools/recipe-save.tool.ts`                                                                                                        | ↳T030, ↳T038, T029, T021, T025            | U-36 | 5    | yes                 | Registers into `registry.ts` (C-03).                                                                                                                         |
| T032 | S    | `AS/src/mcp/tools/__tests__/ingredients.tool.test.ts`                                                                                         | T001                                      | U-37 | 5    | yes                 | Test-first for T033.                                                                                                                                         |
| T033 | S    | `AS/src/mcp/tools/ingredients.tool.ts`                                                                                                        | ↳T032, T029                               | U-37 | 5    | yes                 | Registers into `registry.ts` (C-03).                                                                                                                         |
| T047 | L    | `AW/__tests__/integration/queue/generation-queue.integration.test.ts`                                                                         | T002                                      | U-38 | 5    | yes                 | Test-first for T048.                                                                                                                                         |
| T048 | L    | `AW/src/generation/generation-queue.service.ts`, `AW/src/handlers/generation.handler.ts`                                                      | ↳T047, T044, T050, T042                   | U-38 | 5    | yes                 | The handler composes sanitizer + resolver + idempotent claim.                                                                                                |
| T053 | L    | `AS/tests/sse-streaming.integration.test.ts`                                                                                                  | T001                                      | U-39 | 5    | yes                 | Test-first for T054.                                                                                                                                         |
| T054 | L    | `AS/src/generation/generation-stream.controller.ts`                                                                                           | ↳T053, T046                               | U-39 | 5    | yes                 | Distinct file from T056/T058 in the same directory — no conflict.                                                                                            |
| T055 | S    | `AS/src/generation/__tests__/generation.controller.test.ts`                                                                                   | T001                                      | U-40 | 5    | yes                 | Test-first for T056. **Filename names T046's source, not T056's — F-12.**                                                                                    |
| T056 | S    | `AS/src/generation/generation-status.controller.ts`                                                                                           | ↳T055, T046                               | U-40 | 5    | yes                 | **Conflicts with T095 (C-01)** — must never share a wave with it.                                                                                            |
| T057 | S    | `AS/src/generation/__tests__/stubs.test.ts`                                                                                                   | T001                                      | U-41 | 5    | yes                 | Test-first for T058.                                                                                                                                         |
| T058 | S    | `AS/src/generation/stubs.controller.ts`                                                                                                       | ↳T057, T046                               | U-41 | 5    | yes                 | Distinct file; module registration only (F-02).                                                                                                              |
| T061 | S    | `AS/src/optimization/__tests__/premium.guard.test.ts`                                                                                         | T001                                      | U-42 | 5    | yes                 | Test-first for T062.                                                                                                                                         |
| T062 | M    | `AS/src/optimization/{premium.guard,optimization.controller}.ts`                                                                              | ↳T061, T010                               | U-42 | 5    | yes                 | Reads `accounts.subscription_tier` — cross-service, contract undefined (DG-004).                                                                             |
| T059 | S    | `AS/src/mcp/tools/__tests__/tools-list.test.ts`                                                                                               | T001                                      | U-43 | 6    | yes                 | Test-first for T060.                                                                                                                                         |
| T060 | XS   | `AS/src/mcp/tools/tools-list.ts`                                                                                                              | ↳T059, T029, T031, T033                   | U-43 | 6    | yes                 | Filtering requires the complete tool set to exist. Likely also edits `registry.ts` (C-03).                                                                   |
| T036 | L    | `AS/tests/mcp-protocol.integration.test.ts`                                                                                                   | T001                                      | U-44 | 6    | yes                 | Test-first for T037.                                                                                                                                         |
| T040 | L    | `AS/tests/e2e/mcp-oauth.e2e.test.ts`                                                                                                          | T001, T039                                | U-44 | 6    | yes                 | Test-first for T037's OAuth surface; needs DCR enabled (T039).                                                                                               |
| T037 | M    | `AS/src/mcp/{mcp.controller,mcp.module,well-known.controller}.ts`                                                                             | ↳T036, ↳T040, T027, T029, T035, T025      | U-44 | 6    | yes                 | The MCP composition root. `/.well-known/*` must be excluded from the global prefix.                                                                          |
| T080 | M    | `AS/src/resilience/__tests__/throttle.test.ts`                                                                                                | T001                                      | U-45 | 6    | yes                 | Test-first for T081.                                                                                                                                         |
| T081 | M    | `AS/src/resilience/throttle.config.ts`                                                                                                        | ↳T080, T046, T035                         | U-45 | 6    | yes                 | Guards both the generation intake and per-grant MCP calls, so both must exist.                                                                               |
| T094 | M    | `AS/tests/sanity-validation.integration.test.ts`                                                                                              | T001, T093                                | U-46 | 6    | yes                 | Test-first for T095's wiring.                                                                                                                                |
| T095 | M    | `AS/src/generation/generation-status.controller.ts`, `FA/src/guard/ConfidenceIndicator.tsx`                                                   | ↳T094, T093, T056, T066                   | U-46 | 6    | **no (cross-wave)** | **Rewrites two files other tasks own (C-01, C-02). Safe only because T056/T066 completed in earlier waves; never co-schedule.**                              |
| T096 | M    | `AS/src/generation/__tests__/regenerate.test.ts`                                                                                              | T001                                      | U-47 | 7    | yes                 | Test-first for T097.                                                                                                                                         |
| T097 | M    | `AS/src/generation/regenerate.controller.ts`                                                                                                  | ↳T096, T046, T081                         | U-47 | 7    | yes                 | Reuses the intake path and the same 429 concurrency limit, so T081 must exist.                                                                               |
| T098 | L    | `FA/src/preview/__tests__/RegenerateControl.test.tsx`, `WEB/tests/e2e/aiRegenerate.spec.ts`, `MOB/.maestro/ai/regenerate-flow.yaml`           | ↳ covers T097, T095, T004                 | U-47 | 7    | yes                 | **Tests a component (`RegenerateControl.tsx`) that no task creates — F-13.**                                                                                 |
| T076 | L    | `WEB/tests/e2e/{aiByok,aiGenerate,aiAgentConsent}.spec.ts`                                                                                    | T004                                      | U-48 | 7    | yes                 | Test-first for T074.                                                                                                                                         |
| T074 | M    | `WEB/src/app/[locale]/settings/ai-providers/page.tsx`, `.../agent-connections/page.tsx`, `.../ai/generate/page.tsx`                           | ↳T076, T064, T066, T068, T070, T072, T095 | U-48 | 7    | yes                 | Composition only; needs every shared component final (T095 last-touches `ConfidenceIndicator`).                                                              |
| T077 | L    | `MOB/.maestro/ai/{byok,generate,agent-consent}-flow.yaml`                                                                                     | T004                                      | U-49 | 7    | yes                 | Test-first for T075.                                                                                                                                         |
| T075 | L    | `MOB/src/screens/settings/{AiProviderScreen,AgentConnectionsScreen}.tsx`, `MOB/src/screens/ai/{GenerateRecipeScreen,RecipePreviewScreen}.tsx` | ↳T077, T064, T066, T068, T070, T072, T095 | U-49 | 7    | yes                 | Lockstep with T074 (Principle VIII). Distinct files from T074.                                                                                               |
| T086 | M    | `.github/workflows/_ci.yml`                                                                                                                   | T001–T004, T084, T085, all tier scripts   | U-50 | 8    | **no**              | Sole writer, but **repo-wide contention** with any concurrently-merging feature (F-09). Must land after every `test:*` script exists.                        |

**Superseded, no work**: T088, T089, T090, T091 (Phase 5G table — shipped on `main`).

---

## 2. Parallel waves — the dispatch plan

Each wave is a barrier. Within a wave every listed **unit** is file-disjoint and dependency-satisfied.
Hand one unit to one agent.

### Wave 1 — scaffolds and the genuinely independent (8 tasks, 7 units)

| Unit | Tasks       | Size | Note                                                                 |
| ---- | ----------- | ---- | -------------------------------------------------------------------- |
| U-01 | T001        | 1.0d | `ai-service` scaffold                                                |
| U-02 | T002        | 0.5d | `ai-workers` scaffold                                                |
| U-03 | T003        | 0.5d | `ai-service-client` scaffold                                         |
| U-04 | T004        | 0.5d | `features-ai` scaffold                                               |
| U-05 | T022 → T023 | 2.0d | `act` admission gate in `clerk-verify` — **Phase 5B, zero 005 deps** |
| U-06 | T073        | 0.5d | i18n strings — **resolve F-01 before dispatch**                      |
| U-07 | T084        | 1.0d | k6 script — writable now, verifiable in wave 8                       |

**Wave duration (max unit): 2.0d.**

> **Do this before wave 1 closes** (see §5): enumerate the full runtime dependency set in T001–T004's
> `package.json`, and assign an owner for `AS/src/{app.module,main}.ts`, `AW` handler bootstrap, the
> `FA/src/index.ts` barrel, and `AS/src/health/`. Otherwise waves 3–7 fight over undeclared files.

### Wave 2 — package-local work gated only on a scaffold (23 tasks, 13 units)

| Unit | Tasks       | Size | Note                                                         |
| ---- | ----------- | ---- | ------------------------------------------------------------ |
| U-08 | T005 → T006 | 1.5d | Drizzle schemas — producer for most of wave 3                |
| U-09 | T009 → T010 | 1.0d | Config/env schema                                            |
| U-10 | T013 → T014 | 1.0d | BYOK validator (must precede `ByokService`)                  |
| U-11 | T026 → T027 | 2.0d | JSON-RPC envelope                                            |
| U-12 | T092 → T093 | 2.0d | `RecipeSanityValidator` — pure, listed last, runnable second |
| U-13 | T041 → T042 | 3.0d | `SanitizeService` — **Phase 5C, only needs T002**            |
| U-14 | T078 → T079 | 1.0d | Circuit breaker — **Phase 5F, only needs T002**              |
| U-15 | T063 → T064 | 2.0d | `AiGuardBanner`                                              |
| U-16 | T065 → T066 | 1.0d | `ConfidenceIndicator`                                        |
| U-17 | T069 → T070 | 2.0d | `AgentConsent`                                               |
| U-18 | T085        | 2.0d | CDK stack                                                    |
| U-19 | T039        | 0.5d | DCR runbook                                                  |
| U-20 | T087        | 1.0d | Route conformance test (stays red until wave 7)              |

**Wave duration: 3.0d.**

### Wave 3 — gated on schema / config / validator / `act` gate (18 tasks, 9 units)

| Unit | Tasks       | Size | Depends on        |
| ---- | ----------- | ---- | ----------------- |
| U-21 | T007 → T008 | 2.0d | T006              |
| U-22 | T011 → T012 | 2.0d | T006, T010, T014  |
| U-23 | T018 → T019 | 2.0d | T006, T010        |
| U-24 | T024 → T025 | 2.0d | T010, T023        |
| U-25 | T043 → T044 | 2.0d | T006 (F-06)       |
| U-26 | T051 → T052 | 1.5d | T006, T010 (F-07) |
| U-27 | T082 → T083 | 2.0d | T006, T010        |
| U-28 | T067 → T068 | 2.0d | T003 (F-04)       |
| U-29 | T071 → T072 | 2.0d | T003 (F-04)       |

**Wave duration: 2.0d.**

### Wave 4 — first composition layer (13 tasks, 6 units)

| Unit | Tasks             | Size | Depends on              |
| ---- | ----------------- | ---- | ----------------------- |
| U-30 | T020 → T021       | 1.0d | T019                    |
| U-31 | T015, T017 → T016 | 2.5d | T012, T014, T010, T008  |
| U-32 | T028 → T029       | 1.5d | T019, T025              |
| U-33 | T049 → T050       | 1.0d | T012                    |
| U-34 | T045 → T046       | 2.0d | T006, T010, T042 (F-03) |
| U-35 | T034 → T035       | 2.0d | T006, T019              |

**Wave duration: 2.5d.**

### Wave 5 — tools, queue, generation surfaces (15 tasks, 7 units)

| Unit | Tasks             | Size | Depends on       |
| ---- | ----------------- | ---- | ---------------- |
| U-36 | T030, T038 → T031 | 4.0d | T029, T021, T025 |
| U-37 | T032 → T033       | 1.0d | T029             |
| U-38 | T047 → T048       | 4.0d | T044, T050, T042 |
| U-39 | T053 → T054       | 4.0d | T046             |
| U-40 | T055 → T056       | 1.0d | T046             |
| U-41 | T057 → T058       | 1.0d | T046             |
| U-42 | T061 → T062       | 1.5d | T010             |

**Wave duration: 4.0d.** ⚠️ U-36, U-37, U-43(next wave) all touch `registry.ts` — see C-03. If C-03 is
real, U-36 and U-37 **cannot** share this wave and must serialize (adds 1.0d).

### Wave 6 — composition roots and cross-cutting wiring (9 tasks, 4 units)

| Unit | Tasks             | Size | Depends on                   |
| ---- | ----------------- | ---- | ---------------------------- |
| U-43 | T059 → T060       | 0.6d | T029, T031, T033             |
| U-44 | T036, T040 → T037 | 5.0d | T027, T029, T035, T025, T039 |
| U-45 | T080 → T081       | 2.0d | T046, T035                   |
| U-46 | T094 → T095       | 2.0d | T093, **T056**, **T066**     |

**Wave duration: 5.0d.** U-46 rewrites files owned by U-40 (wave 5) and U-16 (wave 2) — both long
complete, so this is safe **only** at this position. Never pull U-46 earlier.

### Wave 7 — app surfaces and regenerate (7 tasks, 3 units)

| Unit | Tasks             | Size | Depends on                                   |
| ---- | ----------------- | ---- | -------------------------------------------- |
| U-47 | T096 → T097, T098 | 4.0d | T046, T081, T095 (+ missing component, F-13) |
| U-48 | T076 → T074       | 3.0d | T064, T066, T068, T070, T072, T095           |
| U-49 | T077 → T075       | 4.0d | same as U-48                                 |

**Wave duration: 4.0d.** U-47's Playwright/Maestro files are distinct from U-48/U-49's — verified, no
conflict.

### Wave 8 — CI (1 task, 1 unit)

| Unit | Tasks | Size | Depends on                        |
| ---- | ----- | ---- | --------------------------------- |
| U-50 | T086  | 1.0d | every package + every tier script |

**Wave duration: 1.0d.**

### Schedule floor

- **Wave-barrier schedule** (strict: each wave fully drains before the next): 2.0 + 3.0 + 2.0 + 2.5 +
  4.0 + 5.0 + 4.0 + 1.0 = **23.5 engineer-days of wall-clock**, at a peak concurrency of 13 units
  (wave 2).
- Barriers are conservative. Running the graph as a true DAG (dispatch a unit the moment its
  predecessors land) collapses this to the critical path below.

---

## 3. Critical path

The longest dependency chain is the **MCP authorization spine**, not the generation pipeline:

```
T001  Scaffold ai-service                    M    1.0d
  ↓
T005→T006  schema tests → Drizzle schemas    S+M  1.5d
  ↓
T018→T019  policy tests → GrantPolicy        M+M  2.0d
  ↓
T020→T021  visibility tests → visibility     S+S  1.0d
  ↓
T028→T029  registry tests → registry+tools   S+M  1.5d
  ↓
T030,T038→T031  recipe_save + D-001 proof    M+L+M 4.0d
  ↓
T036,T040→T037  MCP integration+e2e → ctrl   L+L+M 5.0d
  ↓
T086  CI wiring                              M    1.0d
                                             ───────────
                                             TOTAL 17.0d
```

**Critical path = 17.0 engineer-days.** No amount of parallelism goes below this.

Runners-up (for reference — these have slack against the spine):

| Chain                                                                       | Length |
| --------------------------------------------------------------------------- | ------ |
| Generation → preview → regenerate (T001→T006→T046→T056→T095→T097/T098→T086) | 12.5d  |
| Generation → queue (T002→T042→T050→T048)                                    | 7.5d   |
| Surfaces (T004→T073→T068→T077/T075→T086)                                    | 8.0d   |

**Where to attack it.** Three of the eight links are single-unit: T037's unit alone is 5.0d (two `L`
test tasks plus the controller) and T031's is 4.0d. If wall-clock matters more than dispatch
simplicity, split U-44 into `{T036 → T037}` and `{T040}` (the OAuth e2e can trail the controller by
one wave without breaking TDD for the JSON-RPC surface, since T036 already covers it) — that removes
2.0d. Splitting U-36 similarly (`T038` trails `T031`) removes another 2.0d, giving a **13.0d** floor.
Both splits weaken the red→green guarantee for one test tier each; take them only with eyes open.

---

## 4. Conflict register

### 4.1 Hard conflicts — declared shared write paths

| ID   | Path                                                | Tasks      | Resolution                                                                                                                                      |
| ---- | --------------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| C-01 | `AS/src/generation/generation-status.controller.ts` | T056, T095 | Strict order T056 (wave 5) → T095 (wave 6). **Never co-schedule.** T095 amends the poll response with validator findings.                       |
| C-02 | `FA/src/guard/ConfidenceIndicator.tsx`              | T066, T095 | Strict order T066 (wave 2) → T095 (wave 6). **Never co-schedule.** T095 changes the indicator's basis from a model score to validator findings. |

These two are the **only** conflicts visible from the declared `Paths:`. Everything below is invisible
to a mechanical read of `tasks.md` and is the more dangerous class.

### 4.2 Latent conflicts — undeclared shared write surfaces

| ID   | Path                                                  | Tasks that will write it                                                                                | Risk                                                                                                                                                                                        |
| ---- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C-03 | `AS/src/mcp/tools/registry.ts`                        | T029 (creates), T031, T033, T060                                                                        | **High.** A tool registry that maps name → handler must gain an entry per tool. T031/T033 declare only their own `*.tool.ts`. If registration is a registry edit, U-36/U-37/U-43 serialize. |
| C-04 | `AS/src/mcp/policy/grant.policy.ts`                   | T019 (creates), T021 (title says "in `GrantPolicy`")                                                    | **Medium.** T021's `Paths:` lists only `visibility.policy.ts`, but its title and the plan's "one authoritative place" framing imply a `grant.policy.ts` edit.                               |
| C-05 | `AS/src/app.module.ts`, `AS/src/main.ts`              | T016, T037, T046, T052, T058, T062, T081, T083, T097 (all implicitly)                                   | **Critical.** No task creates or owns these files. Every module task must register itself. This is the single largest parallelism killer in the plan.                                       |
| C-06 | `AS/package.json`                                     | T006 (drizzle), T012 (secrets-manager sdk), T025 (@clerk/backend), T081 (@nestjs/throttler), T085, T093 | **High.** T001 declares "all four shared tooling deps" but no runtime deps. Every wave-2/3 unit adds one.                                                                                   |
| C-07 | `AW/package.json`                                     | T042 (PII lib), T048 (sqs sdk), T050 (`ai` sdk), T079 (opossum/cockatiel)                               | **High.** Same shape as C-06 for `ai-workers`.                                                                                                                                              |
| C-08 | `FA/src/index.ts` (barrel)                            | T064, T066, T068, T070, T072, and the missing `RegenerateControl`                                       | **High.** Named-exports-only (`CLAUDE.md`) means every component must be re-exported. No task owns the barrel.                                                                              |
| C-09 | `FA/src/guard/__tests__/ConfidenceIndicator.test.tsx` | T065 (creates), T095 (Notes: "Update T065's RTL states")                                                | **Medium.** T095's `Notes:` says it, its `Paths:` does not. Same wave-separation applies as C-02.                                                                                           |
| C-10 | `I18N/**` or `FA/src/**/messages.ts`                  | T073 vs T064/T066/T068/T070/T072                                                                        | **Conditional on F-01.** As declared (one JSON file) there is no conflict. Implemented per repo convention (co-located `messages.ts`) it collides with all five component tasks.            |
| C-11 | `.github/workflows/_ci.yml`                           | T086 (sole 005 writer)                                                                                  | **Low within 005, high across features.** Any concurrent feature branch touching CI rebases into this.                                                                                      |

---

## 5. Flags — ambiguous, contradictory, or missing (NOT guessed)

| ID   | Flag                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F-01 | **T073's path does not exist as a convention in this repo.** There is no `packages/apps/commise/i18n/src/locales/` directory and no locale JSON anywhere. The shipped convention is `LocalizedMessages<T>` (`I18N/src/dictionary.ts`) with **co-located `messages.ts` files per feature** — `features/recipes/src/{rating,form,filters,…}/messages.ts`. Resolve before wave 1: either T073 stays one file (and must then be a new, deliberate convention), or it dissolves into per-directory `messages.ts` and **C-10 fires**. |
| F-02 | **No task creates `AS/src/app.module.ts`, `AS/src/main.ts`, an auth middleware, or a health controller.** T001 scaffolds only config files; T087 asserts `GET /health` is unprefixed; T017/T040 are e2e tests that require a bootable app. The composition root has no owner. Assign one in wave 1 or C-05 fires in every later wave.                                                                                                                                                                                           |
| F-03 | **T045 and plan §5.4 contradict each other.** T045 asserts "sanitization is invoked before enqueue" (i.e. inside `ai-service` intake); plan §5.4 places `SanitizeService` in `ai-workers`, "before prompt construction". One of the two is wrong. I have modelled T046 as depending on T042, which is the conservative (more-sequential) reading. Confirm before dispatching U-34.                                                                                                                                              |
| F-04 | **`@kitchensink/ai-service-client` is scaffolded (T003) but never implemented.** The peer `recipe-service-client` carries `client.ts`, `hooks.ts`, `queries.ts`, `types.ts`, `errors.ts`. T068 (`useByokKeys`) and T072 (`useAgentGrants`) consume it. A missing task, not a missing edge — I have not invented one.                                                                                                                                                                                                            |
| F-05 | **Possible inverted order: T019 (GrantPolicy) before T035 (grants DAL).** The policy must read grant rows; the DAL that reads them is T035. As listed, T019 will hand-roll a query that T035 then duplicates (a DRY violation). Either move the DAL out of T035 into wave 3, or accept the duplication knowingly.                                                                                                                                                                                                               |
| F-06 | **Cross-package schema access is undeclared.** T044/T047/T048 (`ai-workers`) claim jobs by inserting `ai_generation_records`, a table whose Drizzle schema T006 places in `ai-service`. There is no shared schema package (contrast `packages/shared/identity-db`). Either `ai-workers` imports across a workspace boundary (banned by relative-import rules) or a shared package is missing.                                                                                                                                   |
| F-07 | **T052 cites "the existing `ScopesGuard` + `@RequireScopes`" — they exist only in `packages/services/identity/src/auth/`.** They are not exported from a shared package. Admin-gating the prompt-template endpoints needs either a port or an extraction; no task covers it.                                                                                                                                                                                                                                                    |
| F-08 | **T095's declared `Paths:` omit a file its `Notes:` require.** "Update T065's RTL states to cover clean vs warned" means it writes `ConfidenceIndicator.test.tsx` too. See C-09.                                                                                                                                                                                                                                                                                                                                                |
| F-09 | **T023 modifies existing shared files** (`CV/src/clerkVerify.ts`, `index.ts`) consumed by identity, recipe, and food services. Not a 005-internal conflict, but a rebase surface against any concurrent feature branch, and a behaviour change to every service's token admission at once.                                                                                                                                                                                                                                      |
| F-10 | **T087 cannot go green in wave 2.** It enumerates 005's controller routing metadata; the last controller lands in wave 7 (T097). Dispatch it in wave 2 as the intended red gate, but track it as an **end-gate re-run** after wave 7, not as wave-2 "done".                                                                                                                                                                                                                                                                     |
| F-11 | **T084 (k6) is `Test-first: true` but has no impl partner and is not runnable until deploy.** It can be written wave 1; it cannot be executed until T085 (CDK) and T086 (CI leg) land and a stage exists. Do not treat a written-but-unrun k6 script as SC-003 coverage.                                                                                                                                                                                                                                                        |
| F-12 | **T055's test file is misnamed.** `generation.controller.test.ts` names T046's source, but its `Notes:` describe the poll endpoint whose source is T056's `generation-status.controller.ts`. This violates §1a `<source>.test.ts` and will collide with whoever later writes the real `generation.controller` unit test.                                                                                                                                                                                                        |
| F-13 | **T098 tests `FA/src/preview/RegenerateControl.tsx`, which no task creates.** Same class as F-04 — a missing implementation task, not a missing edge.                                                                                                                                                                                                                                                                                                                                                                           |
| F-14 | **T062 reads `accounts.subscription_tier`, owned by another service, with no client path declared.** DG-004 acknowledges the contract is undefined until 010. The dependency is real but unrepresentable as a task edge today.                                                                                                                                                                                                                                                                                                  |
| F-15 | **T038 and T034 have no declared impl partner of their own.** I attached T038 to U-36 (it proves T031's behaviour) and T034 to U-35 (it proves T035's). Both attachments are inferences from `Notes:`, not declarations.                                                                                                                                                                                                                                                                                                        |

---

## 6. Phase-boundary findings

**Real parallelism the phase ordering hides** (later-phase tasks that are actually wave 1–2 work):

| Task(s)    | Listed phase | Actual earliest wave | Why                                                           |
| ---------- | ------------ | -------------------- | ------------------------------------------------------------- |
| T022, T023 | 5B           | 1                    | `clerk-verify` is an existing package; zero 005 dependencies. |
| T041, T042 | 5C           | 2                    | `SanitizeService` needs only the `ai-workers` scaffold.       |
| T078, T079 | 5F           | 2                    | Library circuit breaker; needs only the scaffold.             |
| T085       | 5F           | 2                    | CDK stack is its own tree; needs only the packages to exist.  |
| T092, T093 | post-5F      | 2                    | `RecipeSanityValidator` is a pure module — no I/O, no DB.     |
| T063–T070  | 5E           | 2                    | Pure render components; no backend dependency at all.         |
| T084       | 5F           | 1                    | New file in an existing package.                              |

**False parallelism the phase grouping implies** (same-phase tasks that must serialize):

| Within phase | Edge                        | Why                                                                           |
| ------------ | --------------------------- | ----------------------------------------------------------------------------- |
| 5A           | T014 → T012                 | The validator must reject before any Secrets Manager write (T013's own note). |
| 5A           | T006 → T008                 | Migration SQL is generated from the Drizzle schema.                           |
| 5A           | T012 → T016                 | Controller wraps the service.                                                 |
| 5B           | T019 → T021 → T031          | Visibility enforcement extends the policy; `recipe_save` enforces it.         |
| 5B           | T029 → T031, T033, T060     | Every tool registers into the registry.                                       |
| 5B           | T027 + T029 + T035 → T037   | The MCP controller is a composition root over all three.                      |
| 5C           | T046 → T054, T056, T058     | Every generation surface hangs off the intake service.                        |
| 5C           | T042 + T044 + T050 → T048   | The queue handler composes all three.                                         |
| 5D           | T029/T031/T033 → T060       | `tools/list` filtering needs the complete tool set.                           |
| 5E           | all components → T074, T075 | App routes/screens are pure composition.                                      |
| 5F           | 5C's T046 → T081            | Throttles guard the intake path — a 5F task blocked on 5C.                    |

---

## 7. Summary

- **94 live tasks** (T001–T098 minus the four superseded T088–T091), grouped into **50 dispatch units**.
- **All 94 are `[P]`-eligible at unit granularity** except **T095** (cross-wave conflict with T056 and
  T066, C-01/C-02) and **T086** (terminal, sole writer). The binding constraint is not `[P]`-ineligibility
  — it is **dependency depth**: 8 waves.
- **Peak concurrency is 13 units (wave 2).** Mean is 6.3 units per wave.
- **Critical path: 17.0 engineer-days** (MCP authorization spine, 8 links). Strict wave-barrier
  scheduling costs **23.5 days**; splitting U-44 and U-36 gets the floor to **13.0 days** at the price
  of one test tier trailing its implementation in each.
- **Two declared conflicts** (C-01, C-02) — both involving T095, both resolved by wave separation.
- **Nine latent conflicts** (C-03 … C-11) that no mechanical read of `tasks.md` surfaces. `app.module.ts`
  (C-05), the two `package.json` dependency surfaces (C-06/C-07), the `features-ai` barrel (C-08) and
  the tool registry (C-03) are the ones that will actually cause two agents to clobber each other.
  **They must be assigned owners before wave 1 closes.**
- **Fifteen flags** (F-01 … F-15), of which three are missing implementation tasks (F-04 client, F-13
  `RegenerateControl`, F-02 composition root), one is a direct plan-vs-task contradiction (F-03), and
  one is a path that does not match the repository (F-01).
