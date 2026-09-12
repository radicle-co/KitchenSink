# Quality Checklist: 002-user-auth

**Spec**: `specs/002-user-auth/spec.md`
**Date**: 2026-04-14
**Status**: All 16 items validated

---

## Checklist Items

### 1. User Story Clarity

- [x] All stories have explicit P1/P2/P3 priority assignments
- [x] Each story includes an independent test description that can validate the story in isolation
- [x] Acceptance scenarios follow Given-When-Then format consistently
- [x] Priority justifications explain why each story has its assigned level

**Evidence**: 8 user stories (US-1 through US-8). P1: US-1 through US-4 (4 stories — signup, login/session, logout, profile). P2: US-5 through US-7 (3 stories — edit account, delete account, password reset). P3: US-8 (1 story — MFA). All acceptance scenarios use Given-When-Then. All stories include "Why this priority" and "Independent Test" sections. P1 stories form a usable MVP (authenticate, view profile). P2 stories add management capabilities. P3 is optional enhancement.

**Result**: PASS

---

### 2. Functional Requirement Completeness

- [x] Every user story maps to at least one functional requirement
- [x] FR numbering is sequential (FR-001 through FR-034) with no gaps
- [x] Each FR is specific, testable, and uses MUST/MAY/MUST NOT language
- [x] No duplicate or overlapping FRs

**Evidence**: 34 FRs (FR-001 through FR-034). US-1 (Signup) -> FR-013 through FR-017. US-2 (Login/Session) -> FR-001 through FR-009. US-3 (Logout) -> FR-010 through FR-012. US-4 (Profile) -> FR-018. US-5 (Edit Account) -> FR-019 through FR-021. US-6 (Delete Account) -> FR-022 through FR-026. US-7 (Password Reset) -> FR-027, FR-028. US-8 (MFA) -> FR-029 through FR-031. API Authorization (cross-cutting) -> FR-032 through FR-034. Sequential numbering verified, no gaps. All FRs use MUST language consistently.

**Result**: PASS

---

### 3. Non-Functional Requirement Coverage

- [x] All 7 Constitution principles (I through VII) are addressed by at least one NFR
- [x] NFRs are measurable and verifiable (not vague)
- [x] No NFR conflicts with any FR

**Evidence**: 11 NFRs (NFR-001 through NFR-011). Principle I -> NFR-001 (strict TypeScript), NFR-009 (custom errors with type guards), NFR-010 (ISO 8601 dates). Principle II -> NFR-002 (JSDoc with @param/@returns/@throws). Principle III -> NFR-003 (aliased imports with .js extensions). Principle IV -> NFR-004 (getByRole/getByLabel, no data-testid), NFR-008 (testing pyramid 70/20/10). Principle V -> NFR-006 (workspace registration, shared configs). Principle VI -> NFR-007 (turbo typecheck/lint/format:check). Principle VII -> NFR-004 (accessible names), NFR-005 (color not sole conveyor), NFR-011 (design tokens). All measurable (e.g., "zero `any`", "queryable via getByRole", ">= 70% unit tests"). No conflicts identified.

**Result**: PASS

---

### 4. Key Entity Definitions

- [x] All entities have clear attribute descriptions
- [x] Entity relationships and lifecycles are described
- [x] Entities map to FRs (entities are referenced in requirements)

**Evidence**: 3 entities defined: User, Account, AuthSession. User maps to FR-013 (creation), FR-018 (profile display), FR-023 (deletion), FR-025 (cascade delete). User->Account relationship documented (FK `userId`). Account maps to FR-014 (creation at signup), FR-023 (deletion with User). AuthSession maps to FR-006 (secure storage), FR-007 (token refresh), FR-010 (cleared on logout). All entities include attribute lists, storage locations (database vs client-side), and lifecycle descriptions (created at signup, destroyed on logout/deletion).

**Result**: PASS

---

### 5. Success Criteria Measurability

- [x] All 8 success criteria (SC-001 through SC-008) have quantitative thresholds
- [x] Criteria are time-bound or condition-bound (not open-ended)
- [x] Criteria align with Commise integration (SC-007 references SC-009)

**Evidence**: SC-001: "under 60 seconds" (signup flow). SC-002: "within 3 seconds" (returning user auth). SC-003: "99.9% of refresh attempts" (token refresh). SC-004: "within 30 seconds" (account deletion). SC-005: "within 2 seconds" (profile load). SC-006: "100% of API requests without a valid access token receive 401" (zero unauthenticated access). SC-007: "10,000 concurrent authenticated users" with explicit reference to Commise SC-009. SC-008: "within 60 seconds" (password reset email delivery).

**Result**: PASS

---

### 6. Assumption Validity

- [x] All 10 assumptions (A-001 through A-010) are realistic and documented with rationale
- [x] No assumptions contradict the architecture or existing specs
- [x] Assumptions document defaults that can be overridden

**Evidence**: A-001 (IdP sole identity provider) aligns with feature scope. A-002 (IdP instance pre-configured) is a reasonable infrastructure prerequisite. A-003 (SDK choices: @clerk/expo, @clerk/nextjs) are industry-standard IdP SDKs. A-004 (UUIDv4 canonical identifier) provides IdP-independent identity. A-005 (IdP free/dev tier sufficient) is realistic for launch. A-006 (PostgreSQL from USDA architecture) aligns with 002 spec. A-007 (20-second action timeout with reconciliation safety net) matches IdP documentation. A-008 (no backend session store) aligns with token-based auth patterns. A-009 (shared API Gateway authorizer) explicitly satisfies USDA FR-035 and Commise FR-045. A-010 (hard delete for GDPR) is a clear policy decision.

**Result**: PASS

---

### 7. Edge Case Coverage

- [x] Edge cases cover boundary conditions (invalid input, duplicate signups)
- [x] Edge cases cover error paths (IdP outage, database write failure, API rate limits)
- [x] Edge cases cover concurrency issues (multi-device sessions, token revocation mid-use)

**Evidence**: 8 edge cases documented. Error paths: IdP outage (clear error message), post-signup DB write failure (retry + reconciliation), IdP Backend API rate limit on deletion (queued retry). Boundary: duplicate email signup (IdP native handling), social provider forgot-password (IdP handles). Concurrency: multi-device concurrent sessions (independent validity), server-side refresh token revocation mid-use (401 + re-auth). Recovery: user.created webhook action timeout (reconciliation job).

**Result**: PASS

---

### 8. Constitution Compliance

- [x] NFRs use verbatim language from Constitution principles where applicable
- [x] No NFR paraphrases or weakens a Constitution requirement
- [x] All workspace governance rules (Principle V) are addressed

**Evidence**: NFR-001 uses "strict: true" and "no `any` outside test doubles" matching Principle I verbatim. NFR-002 uses "JSDoc block comments" and "@param, @returns, @throws" matching Principle II. NFR-003 uses "@kitchensink/_, @web/_, @kitchensink/<pkg>" and ".js/.jsx extensions" and "No helpers/ directories" matching Principle III verbatim. NFR-004 uses "getByRole/getByLabel" and "data-testid is prohibited" matching Principles IV/VII. NFR-006 explicitly names shared configs (@kitchensink/typescript, @kitchensink/eslint, @kitchensink/prettier, @kitchensink/vitest) and Turbo declaration matching Principle V. NFR-007 names exact turbo commands matching Principle VI. NFR-008 uses "70% unit, 20% integration, 10% E2E" matching Principle IV pyramid. NFR-011 references design system tokens matching Principle VII.

**Result**: PASS

---

### 9. [NEEDS CLARIFICATION] Markers

- [x] Maximum of 3 markers allowed
- [x] All markers have clear rationale for why clarification is needed

**Evidence**: 1 [NEEDS CLARIFICATION] marker found in spec (C-001: Account Deletion Failure Handling — whether to roll back, proceed with async retry, or proceed with manual cleanup). Marker includes three concrete options with a recommended default (option b). This is within the 3-marker maximum and provides enough context for the clarification phase to resolve it.

**Result**: PASS

---

### 10. Internal Consistency

- [x] FR numbering is sequential (001-034) with no gaps or duplicates
- [x] User story priority levels (P1/P2/P3) are clearly assigned and follow the 4/3/1 distribution
- [x] Entity references in FRs match entity definitions in the Key Entities section
- [x] IdP terminology is consistent throughout (user.created webhook action, refresh token, Management API)

**Evidence**: FR-001 through FR-034 verified sequential. P1: 4 stories (US-1 through US-4), P2: 3 stories (US-5 through US-7), P3: 1 story (US-8). Entity references: "User record" in FR-013/FR-018/FR-023 matches User entity definition. "Account record" in FR-014/FR-023 matches Account entity definition. "access token"/"refresh token" in FR-006/FR-007/FR-009/FR-010/FR-011 match AuthSession definition. IdP terms used consistently: "user.created webhook action" (FR-013/FR-016), "Management API" (FR-024), "refresh token" (FR-007/FR-008/FR-011), "app_metadata" (FR-015/FR-034).

**Result**: PASS

---

### 11. Prose Quality and Formatting

- [x] Spec prose is clear with no grammatical errors
- [x] Markdown formatting is correct (headings, lists, code formatting)
- [x] Technical terms are used consistently (IdP, UUIDv4, httpOnly, Keychain/Keystore)

**Evidence**: Reviewed full spec (298 lines). Markdown headings follow hierarchy (H1 -> H2 -> H3). Code terms use backtick formatting consistently (`app_metadata`, `401 Unauthorized`, `UUIDv4`, `httpOnly`). Platform terms are consistent: "Keychain (iOS) / Keystore (Android)" for mobile, "httpOnly, Secure, SameSite cookies" for web. IdP product names capitalize correctly. Given-When-Then scenarios use bold formatting consistently. No grammatical issues identified.

**Result**: PASS

---

### 12. Commise Integration

- [x] Commise FR-045 (authentication required for all features) is explicitly satisfied
- [x] USDA FR-035 (shared API Gateway authorizer) is explicitly addressed
- [x] Integration references to 001 and 002 specs are documented

**Evidence**: User entity description explicitly states "This entity fulfills Commise FR-045." A-009 explicitly states "The shared API Gateway authorizer referenced in USDA spec FR-035 is the IdP JWT authorizer implemented by this feature." Integration references comment block at top of User Scenarios section cites both specs: "specs/001-commise-recipe-app/spec.md (FR-045: authentication required, FR-040/FR-041: subscription tiers)" and "specs/003-usda-food-data/spec.md (FR-035: shared API Gateway authorizer)." Account entity references Commise FR-040/FR-041 for subscription tier extension point.

**Result**: PASS

---

### 13. Architecture Alignment

- [x] IdP integration points are clearly defined (Authorization Code + PKCE, user.created webhook action, Management API)
- [x] Platform-specific implementations are distinguished (mobile: Keychain/Keystore, web: httpOnly cookies)
- [x] Database model aligns with existing PostgreSQL assumption from USDA spec
- [x] SDK choices are specified and realistic (@clerk/expo, @clerk/nextjs)

**Evidence**: FR-001 specifies "Authorization Code Flow with PKCE" for both platforms. FR-013 specifies "user.created webhook action (IdP Action)" for signup sync. FR-024 specifies "IdP Backend API" for account deletion. FR-006 distinguishes storage: "Keychain (iOS) / Keystore (Android) on mobile; httpOnly, Secure, SameSite cookies on web." A-006 confirms PostgreSQL from USDA architecture. A-003 names specific SDKs: @clerk/expo for mobile, @clerk/nextjs for web. FR-034 specifies custom claim in access token from app_metadata for API user identification.

**Result**: PASS

---

### 14. No Unresolved Ambiguities

- [x] All functional requirements use precise MUST/MAY/MUST NOT language
- [x] No vague terms like "should consider", "might need", "as appropriate"
- [x] Numeric thresholds are specified where applicable (latencies, counts, timeouts)

**Evidence**: All 34 FRs use MUST or MUST NOT exclusively — no weak language. C-001 is the only acknowledged ambiguity and it is explicitly marked with [NEEDS CLARIFICATION] with three concrete options and a recommended default. All latency targets are specific: 60 seconds (SC-001 signup), 3 seconds (SC-002 returning user), 30 seconds (SC-004 deletion), 2 seconds (SC-005 profile load), 60 seconds (SC-008 password reset email). Retry counts specified: 3 attempts with exponential backoff (FR-016). Concurrency target: 10,000 users (SC-007).

**Result**: PASS

---

### 15. Traceability

- [x] Each user story traces to at least one FR
- [x] Each critical FR is covered by at least one success criterion
- [x] Success criteria can be validated through the acceptance scenarios

**Evidence**: Story-to-FR mapping verified in item 2 above (all 8 stories map to FRs). Critical FR traceability: FR-001/FR-002/FR-003 (auth flows) -> SC-001 (signup time), SC-002 (returning user time). FR-007 (token refresh) -> SC-003 (99.9% refresh success). FR-022/FR-023/FR-024 (account deletion) -> SC-004 (deletion within 30s). FR-018 (profile page) -> SC-005 (profile load within 2s). FR-032 (API authorization) -> SC-006 (100% enforcement). FR-001 (scalability) -> SC-007 (10,000 concurrent users). FR-027 (password reset) -> SC-008 (email within 60s). SC-007 explicitly references Commise SC-009 for alignment.

**Result**: PASS

---

### 16. Completeness

- [x] Security is addressed (FR-006: secure token storage, FR-032/FR-033: JWT validation, FR-028: no password storage)
- [x] Monitoring is addressed (reconciliation job FR-017, deletion failure handling edge case)
- [x] Error handling is addressed (FR-008/FR-016: retry logic, edge cases for outages and rate limits, NFR-009: custom errors)
- [x] No obvious omissions for an authentication feature of this scope

**Evidence**: Security: FR-006 (platform-specific secure storage), FR-032/FR-033 (JWT validation on every request), FR-028 (Commise backend never stores passwords), FR-011 (refresh token revocation on logout), NFR-009 (typed custom errors). Error handling: FR-016 (3 retries with exponential backoff), FR-008 (redirect on expired refresh token), edge cases cover IdP outage, DB write failure, rate limits, action timeout. Reconciliation: FR-017 (orphaned user detection). Account lifecycle: creation (FR-013/FR-014), reading (FR-018), editing (FR-019/FR-020/FR-021), deletion (FR-022 through FR-026) with cascade. Platform parity: all flows specified for both mobile and web. GDPR: A-010 (hard delete), FR-025 (cascade delete).

**Result**: PASS

---

## Summary

| #   | Item                           | Result |
| --- | ------------------------------ | ------ |
| 1   | User Story Clarity             | PASS   |
| 2   | FR Completeness                | PASS   |
| 3   | NFR Coverage                   | PASS   |
| 4   | Key Entity Definitions         | PASS   |
| 5   | Success Criteria Measurability | PASS   |
| 6   | Assumption Validity            | PASS   |
| 7   | Edge Case Coverage             | PASS   |
| 8   | Constitution Compliance        | PASS   |
| 9   | [NEEDS CLARIFICATION] Markers  | PASS   |
| 10  | Internal Consistency           | PASS   |
| 11  | Prose Quality and Formatting   | PASS   |
| 12  | Commise Integration            | PASS   |
| 13  | Architecture Alignment         | PASS   |
| 14  | No Unresolved Ambiguities      | PASS   |
| 15  | Traceability                   | PASS   |
| 16  | Completeness                   | PASS   |

**Overall: 16/16 PASS — Spec is ready for `/speckit.clarify` or `/speckit.plan` phase.**

---

# Auth Requirements Quality Checklist: 002-user-auth

**Purpose**: Standard-depth reviewer checklist for validating the clarity, completeness, consistency, and measurability of IdP authentication requirements across security, token/session management, cross-platform flows, account lifecycle, API authorization, observability, and artifact consistency.
**Created**: 2026-05-13
**Feature**: [spec.md](../spec.md)

**Note**: This appended checklist is generated by the `/speckit.checklist` command based on feature context and requirements. Items are unit tests for requirements writing, not implementation verification steps.

## Requirement Completeness

- [ ] CHK001 Are platform-specific IdP flow requirements fully specified for both web and mobile, including PKCE expectations, callback handling, and protected-content gating? [Completeness, Spec §FR-001–FR-005]
- [ ] CHK002 Are secure token storage requirements documented for each platform with enough specificity to distinguish access-token, refresh-token, cookie, Keychain, and Keystore responsibilities? [Completeness, Spec §FR-006]
- [ ] CHK003 Are token refresh, token revocation, expired refresh-token, and revoked refresh-token requirements all documented as separate session lifecycle states? [Completeness, Spec §FR-007–FR-011]
- [ ] CHK004 Are IdP user.created webhook Action requirements complete for UUID generation, User creation, Account creation, `app_metadata` persistence, retry behavior, and reconciliation fallback? [Completeness, Spec §FR-013–FR-017]
- [ ] CHK005 Are account lifecycle requirements complete for profile display, editable fields, read-only email boundaries, avatar constraints, deletion confirmation, cascade deletion, and post-deletion session cleanup? [Completeness, Spec §FR-018–FR-026]
- [ ] CHK006 Are social-provider linking and unlinking requirements complete enough to preserve the canonical Commise user ID and prevent duplicate User/Account records? [Completeness, Spec §FR-032–FR-034]
- [ ] CHK007 Are impersonation requirements complete for authorization boundaries, audit fields, and prohibited privileged actions during impersonation? [Completeness, Spec §FR-035–FR-037]
- [ ] CHK008 Are suspension/reactivation requirements complete for dual IdP/database state changes, denied API access, login messaging, and active-state restoration? [Completeness, Spec §FR-041–FR-044]

## Requirement Clarity

- [ ] CHK009 Is "securely" in token storage requirements clarified with concrete platform storage properties and cookie flags rather than relying on a general security adjective? [Clarity, Spec §FR-006]
- [ ] CHK010 Is "silently refreshes" clarified with user-visible behavior, retry boundaries, and failure transition criteria? [Clarity, Spec §FR-007, Spec §SC-003]
- [ ] CHK011 Is "any protected route" defined clearly enough to determine whether public routes, auth callback routes, password reset routes, and static assets are excluded? [Clarity, Spec §FR-003]
- [ ] CHK012 Is the custom claim containing the Commise user ID named and namespaced consistently across the spec, plan, tasks, and IdP Action requirements? [Clarity, Spec §FR-015, Spec §FR-040]
- [ ] CHK013 Is "clear message" for suspended users and IdP outage cases specified with enough content requirements to avoid vague or misleading error states? [Clarity, Spec §FR-043, Spec §Edge Cases]
- [ ] CHK014 Are avatar image constraints quantified with supported formats, maximum file size, validation failure behavior, and storage ownership assumptions? [Clarity, Spec §FR-021]
- [ ] CHK015 Is "authorized support/engineering personnel" for impersonation defined with role, approval, or policy criteria rather than an ambiguous audience label? [Ambiguity, Spec §FR-035]
- [ ] CHK016 Is "performance degradation" in the 10,000-concurrent-user success criterion quantified with concrete latency, error-rate, or throughput thresholds? [Clarity, Spec §SC-007]

## Requirement Consistency

- [ ] CHK017 Are FR counts and referenced ranges consistent across `spec.md`, existing checklist evidence, V-Model requirements, and task metadata? [Consistency, Spec §Functional Requirements]
- [ ] CHK018 Are storage-engine assumptions consistent between `spec.md`, `plan.md`, `data-model.md`, and `verify-report.md` so PostgreSQL/RDS/Aurora DSQL guidance is not conflicting? [Conflict, Spec §A-006, Report §W-001]
- [ ] CHK019 Are Node.js/runtime requirements consistent between feature planning artifacts and repository-level guidance so Lambda runtime expectations remain distinct from monorepo toolchain expectations? [Conflict, Plan §Technical Context, Report §W-002]
- [ ] CHK020 Are MFA requirements consistent between the feature spec, product review notes, and product-spec guidance about whether MFA is in-scope or delegated entirely to the IdP? [Conflict, Spec §FR-029–FR-031, Review §MFA]
- [ ] CHK021 Are downstream dependencies on recipe auth, USDA API authorizer, external-agent OAuth, and subscription tier storage represented consistently across dependency tables and related requirements? [Consistency, Spec §Dependencies]
- [ ] CHK022 Are IdP Backend API responsibilities for deletion, linking/unlinking, blocking, unblocking, and impersonation described consistently across requirements and plan architecture? [Consistency, Spec §FR-024, Spec §FR-032–FR-044, Plan §Summary]

## Acceptance Criteria Quality

- [ ] CHK023 Are success criteria mapped to the FRs and user stories they validate so each metric has traceable requirement coverage? [Traceability, Spec §SC-001–SC-008]
- [ ] CHK024 Are session-persistence acceptance criteria measurable for both cold app launch and expired-access-token API-request scenarios? [Acceptance Criteria, Spec §US-2, Spec §SC-002–SC-003]
- [ ] CHK025 Is account deletion success measured separately for local database deletion, IdP deletion, queued retry completion, and user-facing completion so async failure handling is not hidden by one metric? [Acceptance Criteria, Spec §FR-024, Spec §SC-004]
- [ ] CHK026 Are API authorization acceptance criteria complete for missing token, invalid token, expired token, wrong issuer, wrong audience, missing custom user ID claim, and suspended user states? [Coverage, Spec §FR-038–FR-042]
- [ ] CHK027 Are observability acceptance criteria measurable for logs, Sentry issues, CloudWatch metrics, client-side breadcrumbs, and trace propagation rather than merely naming tools? [Acceptance Criteria, Spec §NFR-012–NFR-016]
- [ ] CHK028 Are accessibility and UX acceptance criteria tied to specific auth surfaces, status indicators, and queryable accessible names? [Acceptance Criteria, Spec §NFR-004–NFR-005, Spec §NFR-011]

## Scenario Coverage

- [ ] CHK029 Are primary, alternate, exception, recovery, and non-functional scenarios documented for signup and database synchronization, including duplicate users and failed user.created webhook writes? [Coverage, Spec §US-1, Spec §FR-013–FR-017]
- [ ] CHK030 Are web and mobile re-authentication scenarios documented for expired/revoked refresh tokens, IdP callback failures, and interrupted login flows? [Coverage, Spec §US-2, Spec §FR-005, Spec §FR-008]
- [ ] CHK031 Are logout scenarios documented for local token clearing, IdP refresh-token revocation failure, and post-logout destination differences by platform? [Coverage, Spec §US-3, Spec §FR-010–FR-012]
- [ ] CHK032 Are account deletion scenarios documented for IdP Backend API failure, SQS retry exhaustion, DLQ handling, and reconciliation of already-deleted local users? [Coverage, Spec §FR-024–FR-026, Plan §Async IdP deletion]
- [ ] CHK033 Are social account linking scenarios documented for linking an existing provider, unlinking the last remaining login method, provider collisions, and canonical-ID preservation? [Coverage, Spec §FR-032–FR-034]
- [ ] CHK034 Are suspension and reactivation scenarios documented for stale JWTs, authorizer cache TTL windows, blocked IdP accounts, and database status mismatches? [Coverage, Spec §FR-041–FR-044, Plan §JWKS cache]

## Edge Case Coverage

- [ ] CHK035 Are IdP outage requirements defined for signup, login, callback, token refresh, logout revocation, MFA enrollment, and Management API operations? [Edge Case, Spec §Edge Cases]
- [ ] CHK036 Are requirements documented for IdP Action timeout behavior, retry exhaustion, and reconciliation repair when IdP user creation succeeds but database sync does not? [Edge Case, Spec §FR-016–FR-017, Spec §A-007]
- [ ] CHK037 Are requirements documented for refresh-token theft, reuse, rotation failure, or revoked-device scenarios, or are these intentionally delegated to IdP policy configuration? [Gap, Spec §FR-006–FR-011]
- [ ] CHK038 Are requirements documented for JWKS key rotation, JWKS fetch failures, cached-key expiry, and API Gateway policy cache invalidation boundaries? [Gap, Plan §Two-layer JWKS cache]
- [ ] CHK039 Are requirements documented for partial account-deletion failures that leave user-owned data, local User/Account records, or IdP accounts in divergent states? [Edge Case, Spec §FR-023–FR-026]
- [ ] CHK040 Are requirements documented for clock skew, token `nbf`/`iat` validation, and timezone consistency in ISO 8601 auth dates? [Gap, Spec §FR-039, Spec §NFR-010]

## Non-Functional Requirements

- [ ] CHK041 Are security NFRs complete enough to cover OAuth/OIDC redirect URI constraints, allowed callback origins, cookie SameSite behavior, token audience/issuer validation, and IdP tenant policy assumptions? [Gap, Spec §FR-001–FR-006, Spec §A-002]
- [ ] CHK042 Are performance NFRs consistent with success criteria for token refresh, authorizer cache behavior, 401 latency, profile retrieval latency, account deletion, and 10,000 concurrent users? [Consistency, Plan §Performance Goals, Spec §SC-001–SC-008]
- [ ] CHK043 Are privacy/data-retention requirements specified for account deletion, audit logs, Sentry context, CloudWatch logs, and impersonation records? [Gap, Spec §FR-024–FR-026, Spec §FR-036, Spec §NFR-012–NFR-015]
- [ ] CHK044 Are test-quality requirements traceable to every critical auth risk area, including token verification, session refresh, deletion retries, suspension denial, MFA, social linking, and reconciliation? [Traceability, Spec §NFR-008]
- [ ] CHK045 Are accessibility requirements specified for all auth-related UI states including login, signup, profile, edit account, deletion confirmation, MFA, suspended account, session expired, and service outage messaging? [Coverage, Spec §NFR-004–NFR-005]
- [ ] CHK046 Are observability requirements complete for correlation IDs across client, API Gateway authorizer, backend handlers, queue workers, and scheduled reconciliation? [Completeness, Spec §NFR-012–NFR-016]

## Dependencies & Assumptions

- [ ] CHK047 Are IdP tenant preconfiguration assumptions documented with required applications, audiences, social connections, MFA policies, Actions, secrets, callback URLs, and Management API permissions? [Dependency, Spec §A-002]
- [ ] CHK048 Are IdP tier/rate-limit assumptions documented with requirement-level fallback behavior for Management API throttling and deletion queue backoff? [Assumption, Spec §A-005, Spec §FR-024]
- [ ] CHK049 Are downstream spec dependencies documented with the exact auth claims, authorizer context fields, and account fields each dependent feature can rely on? [Dependency, Spec §Dependencies, Spec §FR-040]
- [ ] CHK050 Are mobile SDK assumptions documented consistently with the chosen IdP/Expo library and platform token-storage requirements? [Assumption, Spec §A-003, Spec §FR-006]
- [ ] CHK051 Are database ownership and cascade assumptions documented for all named user-owned resources, including future resources added by downstream specs? [Assumption, Spec §FR-025, Spec §Key Entities]
- [ ] CHK052 Are external observability dependencies documented with environment-specific configuration assumptions for CloudWatch, Sentry, X-Ray/OpenTelemetry, and future LogRocket/NewRelic integration? [Dependency, Spec §NFR-012–NFR-017]

## Ambiguities & Conflicts

- [ ] CHK053 Is the original `[NEEDS CLARIFICATION]` around account-deletion failure requirements resolved consistently with the current async-retry requirement? [Ambiguity, Existing Checklist §9, Spec §FR-024]
- [ ] CHK054 Are FR references for impersonation and suspension reconciled where older notes mention FR-035/FR-038 but the current spec defines impersonation as FR-035–FR-037 and suspension as FR-041–FR-044? [Conflict, Spec §FR-035–FR-044]
- [ ] CHK055 Is the IdP `sub` versus Commise UUID canonical-identity boundary consistently stated anywhere tokens, audit logs, authorizer context, and database relations are mentioned? [Ambiguity, Spec §FR-015, Spec §FR-040, Spec §Key Entities]
- [ ] CHK056 Is the scope boundary for admin-only operations, support impersonation, suspension/reactivation, and lack of admin dashboard documented consistently enough to prevent accidental UI scope expansion? [Boundary, Spec §Out of Scope, Spec §FR-035–FR-044]
- [ ] CHK057 Are password reset requirements explicit that the IdP owns password policy, reset email delivery, generic nonexistent-email messaging, and post-reset login behavior? [Clarity, Spec §FR-027–FR-028, Spec §US-7]
- [ ] CHK058 Are recovery requirements defined for DLQ messages, reconciliation conflicts, and manual operational intervention when automatic IdP/database repair cannot complete? [Gap, Plan §Async IdP deletion, Plan §Reconciliation]

## External IdP & AWS Coverage

- [ ] CHK059 Are authorization-flow requirements complete for `state`, `nonce`, exact redirect URI registration, and explicit exclusion of implicit grant or password grant flows? [Gap, Spec §FR-001–FR-005, Spec §A-002]
- [ ] CHK060 Are refresh-token requirements complete for rotation policy, idle/absolute expiry, reuse detection, token-family invalidation, and user-facing recovery when the IdP revokes a token family? [Gap, Spec §FR-006–FR-011, Spec §A-008]
- [ ] CHK061 Are revocation requirements clear about IdP eventual-consistency windows and which scenarios require revocation, including logout, suspension, deletion, and suspected compromise? [Clarity, Spec §FR-011, Spec §FR-024, Spec §FR-041–FR-044]
- [ ] CHK062 Are IdP tenant policy assumptions documented for allowed callbacks, allowed logout URLs, allowed web origins, client types, token lifetime settings, and refresh-token limits per user/application? [Dependency, Spec §A-002, Spec §A-005]
- [ ] CHK063 Are API authorizer requirements complete for JWT algorithm constraints, JWKS key rotation, `kid` mismatch, audience/issuer validation, `azp`/client identity expectations, and denied-policy semantics? [Gap, Spec §FR-038–FR-040, Plan §Two-layer JWKS cache]
- [ ] CHK064 Are Management API requirements complete for required scopes, rate limits, retryable versus terminal errors, and consistency boundaries for deletion, blocking, unblocking, and provider linking? [Dependency, Spec §FR-024, Spec §FR-032–FR-044, Spec §A-005]

## Notes

- Check items off as completed: `[x]`
- Add comments or findings inline
- This checklist validates requirement quality only; it does not verify implementation behavior.
