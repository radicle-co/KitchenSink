# Sync-Verify Report: 005-ai-integration

**Run Date**: 2026-06-02 (Pre-Implementation)
**Feature Path**: `specs/005-ai-integration/`
**Layers Scanned**: L1, L2, L3, L4, L7 | L5 Skipped | L6 INFO

## Executive Summary

| Layer                     | Status   | Severity | Notes                                                    |
| ------------------------- | -------- | -------- | -------------------------------------------------------- |
| L1: spec ↔ product-spec   | **PASS** | —        | All FRs/NFRs/Decisions mirrored                          |
| L2: spec ↔ plan Must-Have | **PASS** | —        | FR-015..022 fully addressed by plan architecture         |
| L3: plan ↔ tasks          | **PASS** | —        | 50 tasks cover all plan sections; minor index name drift |
| L4: spec ↔ V-Model        | **PASS** | —        | REQ-001..010 ↔ FR-015..022 fully mapped                  |
| L5: code ↔ tasks          | **SKIP** | —        | Per instruction                                          |
| L6: missing impl          | **INFO** | —        | 0/50 tasks complete; expected pre-impl gap               |
| L7: cross-feature deps    | **PASS** | —        | 001, 002, 010 refs valid; no broken `apps/X` links       |

**Overall Verdict**: **PASS** — All required layers are synchronized and ready for implementation. No `CRITICAL` findings found.

---

## L1: spec.md ↔ product-spec Consistency

### Scope

Check that every requirement, decision, and success criterion in `spec.md` has a corresponding elaboration in `product-spec/`.

### Evidence

- **FR-015** (BYOK) → `product-spec.md` Persona P7 Quinn (AI-specific goals #3), wireframes `ai-generation-flow.md` Step 1 "Configure provider key".
- **FR-016** (Generate recipe) → `product-spec.md` Vision bullet #1, `user-journey.md` Journey A sequence diagrams.
- **FR-017** (Preview before save) → `product-spec.md` Core principle #4, `user-journey.md` Journey A Note `FR-016, FR-017`.
- **FR-018** (OAuth 2.1 / MCP) → `product-spec.md` Vision bullet #3, `user-journey.md` Journey C full OAuth + MCP flow.
- **FR-019** (Optimize) → `product-spec.md` Persona P1 Casey Journey B, `user-journey.md` Journey B.
- **FR-020** (Private default) → `product-spec.md` Core principle "All AI-saved recipes default to private".
- **FR-021** (Revoke) → `product-spec.md` Core principle #3 "revocable consent".
- **FR-022** (Guard/Confidence) → `product-spec.md` Core principle #4 "Low-confidence output must surface guardrails", wireframes `ai-confidence-indicator.md`.
- **D-001..D-005** → All present in `spec.md` and mirrored in `product-spec.md` and `plan.md`.
- **SC-003** (15s latency) → Present in `spec.md` and `product-spec/metrics.md`.

### Result

**PASS** — No missing mappings.

---

## L2: spec.md Must-Have ↔ plan.md Coverage

### Scope

Verify that all `MUST` / P0 / P1 requirements in `spec.md` are addressed by `plan.md` architecture.

### Evidence

| Requirement        | Plan Section                                                   | Coverage                                   |
| ------------------ | -------------------------------------------------------------- | ------------------------------------------ |
| FR-015 (BYOK)      | Section 3.1 BYOK API, Section 2.2 `user_byok_keys`             | Full — API + schema defined                |
| FR-016 (Generate)  | Section 3.2 Recipe Generation, Sections 5.1, 5.4               | Full — Async + SSE endpoints               |
| FR-017 (Preview)   | Section 3.2 `POST /ai/generate/recipe/:jobId/save`             | Full — separate save step                  |
| FR-018 (OAuth/MCP) | Section 3.5 MCP Endpoints, Section 5.3 `McpService`            | Full — OAuth 2.1 + tool defs               |
| FR-019 (Optimize)  | Section 3.2 `POST /ai/recipes/:id/optimize`                    | Full — premium guard noted                 |
| FR-020 (Private)   | Section 2.2 `visibility` default, Section 5.3 tool restriction | Full — DB default + MCP validation         |
| FR-021 (Revoke)    | Section 3.5 `DELETE /mcp/consents/:clientId`                   | Full                                       |
| FR-022 (Guard)     | Section 5.2 `SanitizeModule`, UI notes in plan                 | Full — sanitization layer + UI requirement |

### Result

**PASS** — All Must-Have FRs have direct plan coverage.

---

## L3: plan.md ↔ tasks.md Completeness

### Scope

Verify that every architectural component, API, database table, and service in `plan.md` has corresponding tasks.

### Evidence

| Plan Component                    | Task(s)                   | Status |
| --------------------------------- | ------------------------- | ------ |
| `ai_generation_records` schema    | T-001, T-002              | Mapped |
| `prompt_templates` schema         | T-001, T-002, T-011       | Mapped |
| `user_byok_keys` schema           | T-001, T-002, T-003-T-005 | Mapped |
| `mcp_oauth_consents` schema       | T-001, T-002, T-021-T-025 | Mapped |
| BYOK API (POST/DELETE/GET)        | T-006, T-007              | Mapped |
| `SanitizeModule` + PII            | T-008, T-009              | Mapped |
| `AiModule` + ProviderFactory      | T-010, T-011              | Mapped |
| Recipe generation async           | T-012-T-016               | Mapped |
| Meal plan generation              | T-017                     | Mapped |
| Shopping list generation          | T-018                     | Mapped |
| Recipe optimization               | T-019                     | Mapped |
| Prompt template CMS               | T-020                     | Mapped |
| MCP OAuth + Tools                 | T-021-T-025               | Mapped |
| Mobile parity (iOS/Android)       | T-043-T-050               | Mapped |
| SQS Queue (`ai-generation-queue`) | T-013                     | Mapped |

### Finding: W-001

- **Description**: `tasks.md` T-002 specifies index name `idx_ai_gen_records_user_id`, but `plan.md` uses `user_sub` as FK and shows `idx_ai_gen_records_user_sub`.
- **Impact**: Minor naming drift; will resolve during implementation when Drizzle schema is generated.
- **Severity**: WARNING
- **Action**: Implementation agent to align final index naming with plan (`user_sub`).

### Result

**PASS** — All plan components have tasks; 1 minor naming drift flagged.

---

## L4: spec.md ↔ V-Model Traceability

### Scope

Check that V-Model requirements, system design, and architecture map back to `spec.md`.

### Evidence

- `v-model/requirements.md` REQ-001..REQ-010 map to FR-015..FR-022:
    - REQ-001 ↔ FR-015
    - REQ-002 ↔ FR-016
    - REQ-003 ↔ SC-003 (latency)
    - REQ-004 ↔ FR-017
    - REQ-005 ↔ FR-018
    - REQ-006 ↔ FR-020
    - REQ-007 ↔ FR-019
    - REQ-008 ↔ FR-021
    - REQ-009 ↔ FR-022
    - REQ-010 ↔ NFR-001..004 (via acceptance criteria)
- `v-model/traceability-matrix.md` maps each REQ to AT (Acceptance Test) and AC (Architecture/Test) IDs.
- All `⬜ Untested` status entries are expected pre-implementation.
- `v-model/release-audit-report.md` shows ❌ BLOCKED with 176 untested scenarios — this is correct for pre-impl state.

### Result

**PASS** — Full bidirectional traceability maintained.

---

## L5: Existing Code ↔ Tasks

**Skipped per instruction.**

---

## L6: Missing Implementation (INFO)

### Scope

Document which tasks have implementation artifacts.

### Evidence

- All 50 tasks in `tasks.md` show `Status: pending`.
- No `src/db/schema/*ai*.schema.ts`, `src/ai/**/*.ts`, or `src/ai/**/dto/*.ts` files found in worktree source tree.
- This is expected for a pre-implementation sync-verify scan.

### Result

**INFO** — 0/50 tasks complete. All implementation remains to be done.

---

## L7: Cross-Feature Dependency & Monorepo Check

### Scope

Validate that dependency references to other features are present and not broken.

### Evidence

| Dependency                                 | Location                                                        | Status                                                                |
| ------------------------------------------ | --------------------------------------------------------------- | --------------------------------------------------------------------- |
| `001-commise-recipe-app` (Recipe entities) | `spec.md` Dependencies table, `plan.md` `output_recipe_id` FK   | **Valid** — referenced but not resolvable in this worktree (expected) |
| `002-user-auth` (Clerk `users.sub`)        | `spec.md`, `plan.md` FK definitions                             | **Valid** — worktree is `002-user-auth`; `users.sub` assumed present  |
| `010-subscriptions` (Premium)              | `spec.md` Dependencies table, `plan.md` premium guards (FR-019) | **Valid** — referenced but out of scope for this worktree             |

- **No `apps/X` references found** in `005-ai-integration` feature files.
- Plan references external systems (Clerk, AWS Secrets Manager, SQS) correctly via service names, not internal app paths.

### Result

**PASS** — All dependency references are valid and appropriately external.

---

## Findings Register

| ID    | Layer | Severity | Description                                                                                                  | Action                      |
| ----- | ----- | -------- | ------------------------------------------------------------------------------------------------------------ | --------------------------- |
| W-001 | L3    | WARNING  | Index name drift: `tasks.md` uses `idx_ai_gen_records_user_id`, `plan.md` uses `idx_ai_gen_records_user_sub` | Align during implementation |

---

## Conclusion

The `005-ai-integration` feature specification, plan, tasks, V-Model, and product specification are fully synchronized across all required layers. No `CRITICAL` gaps were detected. One `WARNING` (index naming drift) was identified and documented. The feature is ready for implementation.
