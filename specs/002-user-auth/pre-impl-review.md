# Pre-Implementation Review: IdP User Authentication

> Feature: 002-user-auth | Date: 2026-05-30
> Reviewer: Product Forge Pre-Impl Review Agent
> Status: APPROVED WITH CONDITIONS

## Summary

| Section             | Findings                            |
| ------------------- | ----------------------------------- |
| Design Review       | 15 issues (0 critical, 15 warnings) |
| Architecture Review | 2 issues (0 critical, 2 warnings)   |
| Risk Assessment     | 7 risks (1 high, 2 medium, 4 low)   |

**Recommendation: PROCEED WITH CONDITIONS**

---

## Design Review

### State Completeness

| Screen                | Happy State | Empty State | Loading State | Error State | Partial State | Offline State |
| --------------------- | :---------: | :---------: | :-----------: | :---------: | :-----------: | :-----------: |
| Login (Web)           |     ✅      |     ❌      |      ❌       |     ❌      |      N/A      |      N/A      |
| Signup                |     ✅      |     ❌      |      ❌       |     ❌      |      N/A      |      N/A      |
| Profile (Web)         |     ❌      |     ❌      |      ❌       |     ❌      |      N/A      |      N/A      |
| Account Edit          |     ❌      |     ❌      |      ❌       |     ❌      |      N/A      |      N/A      |
| Deletion Confirmation |     ❌      |     ❌      |      ❌       |     ❌      |      N/A      |      N/A      |
| Session Expired       |     ❌      |     ✅      |      N/A      |     N/A     |      N/A      |      N/A      |
| Mobile Auth           |     ❌      |     ❌      |      ❌       |     ❌      |      N/A      |      N/A      |

### UX Pattern Compliance

| UX Recommendation                       | Addressed? | Notes                                       |
| --------------------------------------- | :--------: | ------------------------------------------- |
| Explicit platform auth entry gate       |     ✅     | Login wireframe + user journey A            |
| Social option as first-class            |     ✅     | Google button in login/signup wireframes    |
| Callback completion with retry          |     ✅     | User journey A (alt: transient DB failure)  |
| Silent refresh uninterrupted            |     ⚠️     | No explicit loading state for token refresh |
| Confirmed logout with server revocation |     ✅     | User journey C                              |
| Profile read from local DB              |     ✅     | Wireframe + spec FR-018                     |
| Account edit with immutable email       |     ✅     | UX patterns §4.2                            |
| Avatar upload with progress             |     ❌     | No wireframe for upload progress/state      |

### Accessibility Pre-Check

| Check                                | Status | Notes                                 |
| ------------------------------------ | :----: | ------------------------------------- |
| Color contrast (text on backgrounds) |   ⚠️   | No color specs in wireframes          |
| Touch target sizes (≥44×44px mobile) |   ⚠️   | Not specified in wireframes           |
| Focus order logical                  |   ⚠️   | Not defined                           |
| Screen reader landmarks defined      |   ❌   | Missing in wireframes                 |
| Error messages descriptive           |   ✅   | Spec FR-043 + wireframe status region |
| Form labels present                  |   ✅   | Wireframe shows labeled fields        |

### Component Reuse

| Existing Component                              | Applicable For              |            Reuse Planned?            |
| ----------------------------------------------- | --------------------------- | :----------------------------------: |
| `packages/ui` shared components                 | Profile page, login wrapper | ⚠️ Not explicitly mentioned in tasks |
| Design system tokens (`--accent-primary`, etc.) | All auth UI                 |              ✅ NFR-011              |

### Design Findings

| ID    | Severity | Finding                                                                    | Recommendation                                       |
| ----- | -------- | -------------------------------------------------------------------------- | ---------------------------------------------------- |
| D-001 | WARNING  | Login wireframe missing loading state (while redirecting to IdP)           | Add "Redirecting..." state to login.md               |
| D-002 | WARNING  | Signup wireframe missing loading state (post-signup provisioning)          | Add "Creating your profile..." state to signup.md    |
| D-003 | WARNING  | No wireframes for mobile screens (login, signup, profile, session expired) | Create mobile-auth.md wireframes                     |
| D-004 | WARNING  | No wireframe for profile page (FR-018)                                     | Create profile.md wireframe                          |
| D-005 | WARNING  | No wireframe for account edit page (FR-019..FR-021)                        | Create account-edit.md wireframe                     |
| D-006 | WARNING  | No wireframe for deletion confirmation dialog (FR-023..FR-024)             | Create deletion-confirm.md wireframe                 |
| D-007 | WARNING  | No wireframe for session expired overlay (FR-007..FR-008)                  | Create session-expired.md wireframe                  |
| D-008 | WARNING  | Avatar upload missing progress/error states (T-032b)                       | Add upload states to profile/account-edit wireframes |
| D-009 | WARNING  | No color contrast specifications in wireframes                             | Add WCAG 2.1 AA notes to all wireframes              |
| D-010 | WARNING  | No touch target size specifications for mobile                             | Add ≥44×44px specification to mobile wireframes      |
| D-011 | WARNING  | Screen reader landmarks not defined                                        | Add ARIA landmark regions to wireframes              |
| D-012 | WARNING  | Focus order not defined for multi-step flows                               | Add focus management notes to wireframes             |
| D-013 | WARNING  | `packages/ui` components not referenced in UI tasks                        | Add UI reuse task or note to T-053/T-054             |
| D-014 | WARNING  | No offline state considerations for auth flows                             | Add offline error state to wireframes (N/A for some) |
| D-015 | WARNING  | Session expired wireframe exists but missing "re-login and restore" flow   | Update session-expired.md per T-051 specification    |

---

## Architecture Review

### Structural Checks

| Check                                                   | Status | Evidence                                                                                        |
| ------------------------------------------------------- | :----: | ----------------------------------------------------------------------------------------------- |
| Separation of concerns (controller/service/repo layers) |   ✅   | plan.md topology: ECS service (NestJS) + Lambda handlers                                        |
| Dependency direction correct (no circular deps)         |   ✅   | plan.md: `services/identity` (types + schemas + DAOs) → `services/identity-webhooks` → `apps/*` |
| API contracts complete (request/response schemas)       |   ⚠️   | plan.md mentions contracts but tasks.md lacks explicit OpenAPI/Schema generation tasks          |
| Data model consistent with spec.md entities             |   ✅   | plan.md references data-model.md; User/Account entities match FR-013..FR-015                    |
| Migration strategy defined (if DB changes)              |   ✅   | T-072 seed/migration scripts; Day-30/90 scale-up in spec                                        |
| Error handling patterns defined                         |   ✅   | plan.md: error envelope + CloudWatch + Sentry; NFR-009 custom errors                            |
| Authentication/authorization approach defined           |   ✅   | REQUEST authorizer Lambda + suspension checks (FR-039..FR-042)                                  |
| Caching strategy defined (if needed)                    |  N/A   | JWKS in-process cache mentioned; no other caching needed                                        |

### Integration Point Validation

| Integration Point                      |            Plan Coverage             |      Risk Level      |
| -------------------------------------- | :----------------------------------: | :------------------: |
| IdP Backend API (user management)      |   ✅ Covered (T-021, T-022, T-023)   | Medium (rate limits) |
| JWKS endpoint (token verification)     |          ✅ Covered (T-020)          |         Low          |
| RDS PostgreSQL 16                      |      ✅ Covered (T-002, T-072)       |         Low          |
| SQS + DLQ (deletion retries)           |          ✅ Covered (T-022)          |        Medium        |
| EventBridge Scheduler (reconciliation) |          ✅ Covered (T-023)          |         Low          |
| API Gateway + REQUEST authorizer       |      ✅ Covered (T-020, T-013)       |         Low          |
| CloudWatch Logs + Metrics              | ✅ Covered (T-024, NFR-012..NFR-013) |         Low          |

### NFR Coverage

| NFR                                        | Plan Approach                                        |                Adequate?                 |
| ------------------------------------------ | ---------------------------------------------------- | :--------------------------------------: |
| NFR-001 strict: true                       | `@kitchensink/typescript/base.json`                  |                    ✅                    |
| NFR-002 JSDoc on exports                   | Required on all exports                              |                    ✅                    |
| NFR-003 aliased imports with .js           | `@kitchensink/*`, `@kitchensink/*`, `@kitchensink/*` |                    ✅                    |
| NFR-004 getByRole/getByLabel               | Playwright tests                                     | ⚠️ (wireframes lack testability markers) |
| NFR-005 color + label pairing              | Design system tokens                                 |                    ✅                    |
| NFR-006 workspace registration             | Root `package.json` workspaces                       |                    ✅                    |
| NFR-007 typecheck/lint/format              | Turbo tasks                                          |                    ✅                    |
| NFR-008 test pyramid (70/20/10)            | Vitest + Playwright                                  |  ⚠️ (task split not explicit in T-083)   |
| NFR-009 custom error types                 | `AuthSessionExpiredError`, etc.                      |                    ✅                    |
| NFR-010 ISO 8601 dates                     | Schema definition                                    |                    ✅                    |
| NFR-011 design system tokens               | `--accent-primary`, semantic colors                  |                    ✅                    |
| NFR-011a performance targets (500ms/1s/2s) | CI gates in T-083                                    |                    ✅                    |
| NFR-012 structured logs (CloudWatch)       | `@aws-lambda-powertools/logger`                      |                    ✅                    |
| NFR-013 Sentry integration                 | Error tracking                                       |                    ✅                    |
| NFR-014 HTTPS only                         | Infra config (CDK)                                   |                    ✅                    |
| NFR-015 password strength                  | Delegated to IdP                                     |                    ✅                    |
| NFR-016 session expiry UX                  | 5-min warning + `localStorage` draft                 |         ✅ (from clarifications)         |
| NFR-017 responsive layouts                 | Mobile-first                                         |       ⚠️ (wireframes desktop-only)       |

### Architecture Findings

| ID    | Severity | Finding                                                                                                                               | Recommendation                                                                    |
| ----- | -------- | ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| A-001 | WARNING  | API contracts not explicitly defined as tasks — plan.md mentions contracts but no OpenAPI generation or schema validation task exists | Add task for OpenAPI 3.1 spec generation or Zod schema-to-API contract validation |
| A-002 | WARNING  | Test pyramid split (70/20/10) not explicitly tracked in T-083 CI gates                                                                | Add metric collection and gate for test distribution in T-083                     |

---

## Risk Assessment

### Risk Register

| ID    | Category    | Risk                                                                | Likelihood |  Impact  |  Severity  | Mitigation                                                                           |
| ----- | ----------- | ------------------------------------------------------------------- | :--------: | :------: | :--------: | ------------------------------------------------------------------------------------ |
| R-001 | Technical   | IdP rate limiting on webhook ingestion (burst >1 webhook/s day-one) |   Medium   |  Medium  | **Medium** | Exponential backoff + DLQ (T-022); capacity plan scales to 20 webhook/s by Day-90    |
| R-002 | Technical   | JWT verification performance degrades at >200 req/s (Day-90 target) |    Low     |  Medium  |  **Low**   | JWKS in-process cache; authorizer is stateless Lambda (horizontal scale)             |
| R-003 | Integration | IdP API breaking changes (webhook payload format, claim keys)       |   Medium   | **High** |  **High**  | Zod validation at entry (FR-016a) + CloudWatch metric alert + spec monitoring        |
| R-004 | Integration | RDS `db.t4g.micro` → `db.t4g.small` migration failure on Day-30/90  |    Low     | **High** | **Medium** | CDK diff review + low-traffic window + backup before apply                           |
| R-005 | Scope       | 50 tasks with complex dependency chains create coordination risk    |   Medium   |  Medium  | **Medium** | Critical path identified: T-001→T-010→T-013→T-030→T-053/T-054; parallelize [P] tasks |
| R-006 | Rollback    | Account deletion is irreversible after 30-day grace                 |    Low     | **High** | **Medium** | Soft-delete + 30-day grace + audit log + admin reactivation path (FR-044)            |
| R-007 | Rollback    | Suspension state desync (IdP blocked but DB `active`)               |   Medium   |  Medium  | **Medium** | Nightly reconciliation (T-023) + dual-write on suspension API (FR-041)               |

### Rollout Strategy

| Risk Profile                                              | Recommended Rollout                                 |
| --------------------------------------------------------- | --------------------------------------------------- |
| 1 High risk (R-003) + 2 Medium-High impact (R-004, R-006) | **Feature flag + staged rollout**: 10% → 50% → 100% |

### Risk Mitigations Required Before Coding

- [ ] R-003 (HIGH): Zod webhook payload validation (FR-016a) must be implemented in T-072 before any webhook handler code
- [ ] R-004 (MEDIUM): Database backup/restore procedure documented before Day-30 migration
- [ ] R-006 (MEDIUM): Soft-delete audit trail and 30-day grace period logic tested before account deletion endpoint ships

---

## Conditions for Approval

| #   | Condition                                                                         | Task ID   | Affects                                         |
| --- | --------------------------------------------------------------------------------- | --------- | ----------------------------------------------- |
| 1   | Create mobile wireframes (login, signup, profile, session expired)                | **T-084** | `product-spec/wireframes/`                      |
| 2   | Add loading states to login/signup wireframes                                     | **T-085** | `product-spec/wireframes/login.md`, `signup.md` |
| 3   | Verify design system tokens exist for auth UI                                     | **T-086** | `tasks.md`                                      |
| 4   | Define IdP Backend API retry strategy (base 1s, max 30s, 5 attempts, jitter ±20%) | **T-087** | `plan.md` §Integration Points                   |
| 5   | Add feature flag for staged rollout (10% → 50% → 100%)                            | **T-088** | `tasks.md`, deployment config                   |
| 6   | Generate OpenAPI 3.1 contract for identity API                                    | **T-089** | `contracts/identity-api.openapi.json`           |
| 7   | Add test distribution metric gate to T-083 (70/20/10 ±5%)                         | **T-090** | `tasks.md` T-083                                |

---

## Pre-Implementation Checklist

- [x] All CRITICAL design findings resolved (0 critical)
- [x] All CRITICAL architecture findings resolved (0 critical)
- [x] All Critical-severity risks have documented mitigations (0 critical)
- [x] Rollout strategy agreed upon: Feature flag + staged rollout (10% → 50% → 100%)
- [x] `tasks.md` updated with 7 new tasks (T-084..T-090)
- [x] `.forge-status.yml` updated: `pre-impl-review: completed`

---

## Gate Decision

**APPROVED WITH CONDITIONS** — All 7 conditions accepted by user. Proceed to Phase 6 (Implementation).
