# Phase Digest — 5B Tasks (Feature 005)

**Date**: 2026-08-02
**Phase**: 5B — Task Breakdown
**Artifacts**: `tasks.md` (86 tasks), `traceability.yml` (seeded)

## Key decisions

- **Full regeneration, not a patch.** The prior 50-task list was unrecoverable: 37 references to a
  package the plan no longer defines, plus a dropped table, a non-existent CDK path, and pre-GR-002
  endpoints.
- **86 tasks / 6 phases**, mapping 1:1 onto `plan.md` §7's implementation order.
- **41 test-first, 45 implementation.** Nearly half the list is tests placed _before_ the code they
  cover, which is what the Phase 5B→6 Red gate enforces. The prior list put all tests at the end.
- **Four new packages**, mirroring the recipe precedent exactly (`ai-service`, `ai-workers`,
  `clients/ai-service`, `features-ai`) — no novel deployment shape.
- **Parallelizable groups**: 5A foundation is largely serial (schema → migration → services);
  5E surfaces parallelize per component once `features-ai` is scaffolded; 5F hardening is independent
  of 5E.

## Coverage recovered vs the previous list

| Gap                                                         | Now                                |
| ----------------------------------------------------------- | ---------------------------------- |
| FR-022's **confidence indicator** — no task existed         | T065, T066                         |
| **NFR-002** (JSDoc) — zero task references                  | T006, T010, T012, T019, T027, T083 |
| **SC-003** — the only success criterion, zero coverage      | T084 (k6)                          |
| **k6** — absent entirely, though mandated for services      | T084                               |
| **Maestro** — absent, though mandated for mobile parity     | T077                               |
| **RTL component tests** — absent                            | T063, T065, T067, T069, T071       |
| **Shared package** — web/mobile duplicated the guard banner | T004, T064 (one implementation)    |
| **i18n** — legally-mandated strings hard-coded              | T073                               |

## Open risks

- **T036, T038, T040, T047, T048, T053, T054, T075, T076, T077, T085 are `L`.** None is `XL`, but the
  MCP integration cluster (T036/T038/T040) is the highest-risk area in the feature: it is where
  ADR-0012's trust boundary is actually proven. Budget review time there.
- **T054 (SSE) has an unresolved infra question** — behaviour behind the shared ALB (idle timeout,
  buffering) is unverified. Do not mark it done on a local pass alone.
- **T084 depends on OQ-7.** If `verifyClerkToken` introspects over the network, a per-tool-call round
  trip may put SC-003's 15s budget at risk. Resolve OQ-7 before treating the k6 result as meaningful.
- **T022/T023 modify a shared package** (`@kitchensink/clerk-verify`) used by all three live services.
  A regression there is not contained to 005.
- **T039 is a manual dashboard action**, not code. Without DCR enabled, ChatGPT cannot self-register
  and the entire agent path is dead — but nothing in CI will catch it.

## Handoff notes

- **Start with T001–T010** (scaffold → schema tests → schema → migration test → migration). Nothing
  else can be verified until the migration runs.
- **Do not start Phase 5E before 5B.** The consent UI (T069/T070) encodes D-001, whose enforcement
  lives in `GrantPolicy` (T018/T019); building the UI first invites a UI-only gate, which D-002
  explicitly forbids.
- **Commit granularity**: one commit per test/impl pair (e.g. T018+T019), so each commit is a
  red→green transition that is meaningful in isolation.
- **Red gate**: before Phase 6, run the 42 `Test-first: true` tasks and confirm they FAIL. A test that
  passes before its implementation exists is not testing anything.

## Blocked / not addressed by this phase

- `spec.md` FR-018 wording still implies Clerk's consent screen.
- The 5 `v-model/` artifacts still specify `provider_configs` / `agent_consent_records`; the release
  audit stays `❌ BLOCKED` until reconciled. `speckit.v-model.*` is not installed, so this is
  hand-maintenance.
- `checklists/requirements.md` is stale (validates FR-015–021 only, dated 2026-04-15, and marks
  "Edge cases identified" for a section containing one unanswered question).
