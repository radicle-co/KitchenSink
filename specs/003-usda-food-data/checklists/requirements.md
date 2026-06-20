# Quality Checklist: 003-usda-food-data

**Spec**: `specs/003-usda-food-data/spec.md`
**Date**: 2026-04-14 (auth-protection update validated 2026-06-18)
**Status**: All 17 items validated

> **2026-06-18 update**: Added Clerk-based auth protection — User Story 0, FR-035 through FR-042, SC-010/SC-011, the `AuthenticatedCaller` entity, assumption A-011, six auth edge cases, and the 2026-06-18 clarification session. Counts in the items below reflect the updated spec.

---

## Checklist Items

### 1. User Story Clarity

- [x] All stories have explicit P1/P2/P3 priority assignments
- [x] Each story includes an independent test description that can validate the story in isolation
- [x] Acceptance scenarios follow Given-When-Then format consistently
- [x] Priority justifications explain why each story has its assigned level

**Evidence**: 11 user stories (US-0 through US-10). P1: US-0 (auth) plus US-1 through US-5 (6 stories). P2: US-6 through US-8 (3 stories). P3: US-9 through US-10 (2 stories). All acceptance scenarios use Given-When-Then. All stories include "Why this priority" and "Independent Test" sections. US-0 is a cross-cutting auth-protection story that gates US-1–US-10.

**Result**: PASS

---

### 2. Functional Requirement Completeness

- [x] Every user story maps to at least one functional requirement
- [x] FR numbering is sequential (FR-001 through FR-042) with no gaps
- [x] Each FR is specific, testable, and uses MUST/MAY/MUST NOT language
- [x] No duplicate or overlapping FRs

**Evidence**: 42 FRs (FR-001 through FR-042). US-0 -> FR-035 through FR-042 (Clerk auth/authorization). US-1 -> FR-001 through FR-006. US-2 -> FR-003, FR-011, FR-013, FR-024/FR-025. US-3 -> FR-019 through FR-022. US-4 -> FR-012, FR-023. US-5 -> FR-014 through FR-018, FR-026/FR-027. US-6 -> FR-008 through FR-010. US-7 -> FR-031/FR-032. US-8 -> FR-007, FR-033. US-9 -> FR-034, FR-041 (WebSocket auth). US-10 -> covered by SC-006 and monitoring SCs. Sequential numbering verified, no gaps.

**Result**: PASS

---

### 3. Non-Functional Requirement Coverage

- [x] All 7 Constitution principles (I through VII) are addressed by at least one NFR
- [x] NFRs are measurable and verifiable (not vague)
- [x] No NFR conflicts with any FR

**Evidence**: 10 NFRs (NFR-001 through NFR-010). Principle I -> NFR-001, NFR-009, NFR-010. Principle II -> NFR-002. Principle III -> NFR-003. Principle IV -> NFR-004, NFR-008. Principle V -> NFR-006. Principle VI -> NFR-007. Principle VII -> NFR-004, NFR-005. All measurable (e.g., "zero `any`", "queryable via getByRole", "70% unit tests"). No conflicts identified.

**Result**: PASS

---

### 4. Key Entity Definitions

- [x] All entities have clear attribute descriptions
- [x] Entity relationships and lifecycles are described
- [x] Entities map to FRs (entities are referenced in requirements)

**Evidence**: 6 entities defined: Food, FetchRequest, TokenBucketState, QueueMessage, FoodDataEvent, AuthenticatedCaller. Food maps to FR-002, FR-028, FR-029, FR-030. FetchRequest maps to FR-011, FR-012. TokenBucketState maps to FR-019, FR-020. QueueMessage maps to FR-014 through FR-018. FoodDataEvent maps to FR-011, FR-012, FR-024, FR-032, FR-034. AuthenticatedCaller maps to FR-035 through FR-042 (per-request principal from the verified Clerk token; not persisted). All have attributes, storage/lifetime, and lifecycle descriptions.

**Result**: PASS

---

### 5. Success Criteria Measurability

- [x] All 11 success criteria (SC-001 through SC-011) have quantitative thresholds
- [x] Criteria are time-bound or condition-bound (not open-ended)
- [x] Criteria align with Commise integration (SC-008 references SC-010)

**Evidence**: SC-001: "50ms at p95". SC-002: "never exceed 1,000 requests/hour". SC-003: "60 seconds at p95". SC-004: "80% cache hit rate after 5,000 foods". SC-005: "5,000 foods/hour". SC-006: "Zero data loss, 3 retry cycles". SC-007: "200ms at p95 for 50,000 foods". SC-008: "match USDA source values exactly" with explicit reference to Commise SC-010. SC-009: "99.9% availability". SC-010: "100% of endpoints reject unauthenticated/expired/wrong-`azp` requests with 401" (auth). SC-011: "token verification ≤ 10ms p95" (auth).

**Result**: PASS

---

### 6. Assumption Validity

- [x] All 11 assumptions (A-001 through A-011) are realistic and documented with rationale
- [x] No assumptions contradict the architecture document
- [x] Assumptions document defaults that can be overridden

**Evidence**: A-001 (rate limit hard constraint) aligns with architecture doc section 2.1. A-002 (lean launch default) aligns with architecture doc "Lean Launch" section. A-003 (eventual consistency) aligns with 202 Accepted pattern. A-004 (USDA API availability) is a reasonable external dependency assumption. A-005 (AWS us-east-1) aligns with architecture. A-006 (monorepo workspace) aligns with Constitution Principle V. A-007 (polling over WebSocket) aligns with architecture "Option A". A-008 (foods table scope) correctly delineates boundaries. A-009 (Secrets Manager + Clerk auth boundary) aligns with security best practices. A-010 (URL prefix versioning) is a clear, overridable default. A-011 (Clerk REQUEST Lambda authorizer; trusted `$context.authorizer`, not a client header) aligns with the Clerk architecture in CLAUDE.md and the identity service's PR #39 decision.

**Result**: PASS

---

### 7. Edge Case Coverage

- [x] Edge cases cover boundary conditions (invalid input, extreme values)
- [x] Edge cases cover error paths (API down, infrastructure failure)
- [x] Edge cases cover concurrency issues (thundering herd, duplicate requests)

**Evidence**: 15 edge cases documented. Boundary: invalid fdcId format. Error paths: USDA API extended downtime, Redis unavailability, PostgreSQL unavailability, token bucket state loss. Concurrency: thundering herd deduplication, Lambda timeout mid-processing. Data quality: missing nutrient fields in USDA response. Recovery: tombstone re-check after 90 days. Auth (added 2026-06-18): token expiry/clock skew, wrong-instance/wrong-`azp` token, anonymous denial-of-wallet flood, missing/misconfigured `CLERK_JWT_KEY` (fail-closed), and WebSocket `$connect` without a token.

**Result**: PASS

---

### 8. Constitution Compliance

- [x] NFRs use verbatim language from Constitution principles where applicable
- [x] No NFR paraphrases or weakens a Constitution requirement
- [x] All workspace governance rules (Principle V) are addressed

**Evidence**: NFR-001 uses "strict: true" and "no `any`" matching Principle I verbatim. NFR-002 uses "JSDoc block comments" matching Principle II. NFR-003 uses "@kitchensink/_, @web/_, @kitchensink/<pkg>" and ".js/.jsx extensions" matching Principle III verbatim. NFR-006 explicitly names shared configs and Turbo declaration matching Principle V. NFR-007 names exact turbo commands matching Principle VI. NFR-004/NFR-005 match Principles IV/VII on accessible names and color requirements.

**Result**: PASS

---

### 9. [NEEDS CLARIFICATION] Markers

- [x] Maximum of 3 markers allowed
- [x] All markers (if any) have clear rationale for why clarification is needed

**Evidence**: Zero [NEEDS CLARIFICATION] markers found in spec. All requirements are fully specified. This is within the 3-marker maximum.

**Result**: PASS

---

### 10. Internal Consistency

- [x] FR numbering is sequential (001-042) with no gaps or duplicates
- [x] User story priority levels (P1/P2/P3) are clearly assigned and follow the 6/3/2 distribution
- [x] Entity references in FRs match entity definitions in the Key Entities section
- [x] Event names are consistent across FRs (FoodRequested, FoodBatchRequested, IngestionScheduled, FoodDataReceived, FetchFailed)

**Evidence**: FR-001 through FR-042 verified sequential. P1: 6 stories (US-0 through US-5), P2: 3 stories (US-6 through US-8), P3: 2 stories (US-9 through US-10). Event names in FR-011/FR-012/FR-024/FR-032/FR-034 match FoodDataEvent types in Key Entities. Fetch status values in FR-028 match Food entity definition. Queue names (High Priority, Low Priority, DLQ) are consistent throughout. Auth FRs (FR-035–FR-042) reference the `AuthenticatedCaller` entity, consistent with the Key Entities section.

**Result**: PASS

---

### 11. Prose Quality and Formatting

- [x] Spec prose is clear with no grammatical errors
- [x] Markdown formatting is correct (headings, lists, code formatting)
- [x] Technical terms are used consistently (fdcId, fetch_status, token bucket)

**Evidence**: Reviewed full spec (329 lines). Markdown headings follow hierarchy (H1 -> H2 -> H3). Code terms use backtick formatting consistently (`fdcId`, `fetch_status`, `202 Accepted`). JSON examples are properly formatted. No grammatical issues identified.

**Result**: PASS

---

### 12. Commise Integration

- [x] FR-007 from Commise spec is explicitly satisfied (food/nutrition database backing)
- [x] Ingredient lookup flows are clearly defined (single and batch)
- [x] Meal plan and grocery list integration points are identified or correctly scoped out

**Evidence**: Food entity description explicitly states "This entity fulfills Commise FR-007." FR-002 defines the data returned (calories, protein, carbs, fat, micronutrients). US-4 covers bulk ingredient lookup for recipe import. A-008 correctly scopes the boundary: "Integration with Commise's `ingredients` entity... is a downstream concern handled by the Commise recipe management feature."

**Result**: PASS

---

### 13. Architecture Alignment

- [x] All FRs map to architecture components (SQS, Lambda, EventBridge, PostgreSQL, Redis)
- [x] Token bucket parameters match architecture doc (1,000 capacity, 16.67 tokens/min)
- [x] Lean launch variant is considered alongside full architecture
- [x] Queue configuration matches architecture doc (visibility timeouts, DLQ retention, max receive count)

**Evidence**: FR-019 specifies "1,000 tokens" and "16.67 tokens per minute" matching architecture doc section 3.2. FR-020 specifies both Redis Lua script and PostgreSQL variant. FR-022 specifies "reserved concurrency of 1" matching architecture. FR-017 specifies visibility timeouts (60s high, 120s low). FR-016 specifies max receive count of 3. FR-018 specifies 14-day DLQ retention. FR-013 covers both Redis and PostgreSQL dedup mechanisms.

**Result**: PASS

---

### 14. No Unresolved Ambiguities

- [x] All functional requirements use precise MUST/MAY/MUST NOT language
- [x] No vague terms like "should consider", "might need", "as appropriate"
- [x] Numeric thresholds are specified where applicable (latencies, counts, timeouts)

**Evidence**: All 34 FRs use MUST or MUST NOT. FR-034 correctly uses MAY for the optional WebSocket feature. All latency targets are specific: 50ms (SC-001), 200ms (SC-007, FR-010), 60 seconds (SC-003). All configuration values are specified: 1,000 tokens, 16.67/min, 30-day staleness, 14-day DLQ retention, 24-hour Redis TTL.

**Result**: PASS

---

### 15. Traceability

- [x] Each user story traces to at least one FR
- [x] Each critical FR is covered by at least one success criterion
- [x] Success criteria can be validated through the acceptance scenarios

**Evidence**: Story-to-FR mapping verified in item 2 above. Critical FR traceability: FR-001/FR-002 -> SC-001 (cache hit latency). FR-019/FR-022 -> SC-002 (rate limit compliance). FR-011/FR-024 -> SC-003 (async completion time). FR-001 -> SC-004 (cache hit rate). FR-023 -> SC-005 (batch throughput). FR-016/FR-018 -> SC-006 (zero data loss). FR-008/FR-010 -> SC-007 (search latency). FR-024 -> SC-008 (data accuracy).

**Result**: PASS

---

### 16. Completeness

- [x] Security is addressed (Clerk auth FR-035–042, A-009/A-011: API key in Secrets Manager + Clerk verification, FR-006: input validation)
- [x] Monitoring is addressed (US-10, SC-006: DLQ alarm)
- [x] Error handling is addressed (FR-025 through FR-027: 404/429/5xx handling, NFR-009: custom errors)
- [x] No obvious omissions for a data integration feature of this scope

**Evidence**: Security: FR-035–FR-042 establish Clerk session-token auth on every endpoint (networkless verification, `azp` enforcement, fail-closed, no trusted client header, WebSocket `$connect` auth); A-009/A-011 cover API-key management and the Clerk authorizer placement; FR-006 covers input validation; the denial-of-wallet edge case confirms auth precedes any USDA spend. Monitoring: US-10 defines CloudWatch dashboard with queue depth, token bucket, latency, error rate metrics. Error handling: FR-025 (404 tombstone), FR-026 (429 bucket reset), FR-027 (5xx retry + DLQ), NFR-009 (typed custom errors with type guards). Data lifecycle: creation (FR-011/FR-012), storage (FR-028/FR-029/FR-030), staleness (FR-031/FR-032), tombstoning (FR-025). Notification: polling (FR-033) and optional WebSocket (FR-034).

**Result**: PASS

---

### 17. Authentication & Authorization (Clerk)

- [x] Every endpoint (and WebSocket `$connect`) requires authentication; unauthenticated requests are rejected with `401` before any business logic or USDA spend
- [x] The mechanism matches the project's actual auth (Clerk session-token verification), not Auth0/Cognito
- [x] Verification is networkless (public `CLERK_JWT_KEY`) with `azp` enforcement; identity comes only from the verified token (no trusted client header)
- [x] Authorization model is explicit (all authenticated users may read; admin/operational endpoints gated by `public_metadata` scopes)
- [x] Auth is fail-closed and covered by measurable success criteria (SC-010, SC-011)

**Evidence**: FR-035 (auth required on all endpoints + WebSocket, `401`, no enqueue/USDA call on reject); FR-036 (networkless `CLERK_JWT_KEY` verification, no IdP round trip, no Auth0/Cognito authorizer); FR-037 (`azp`/exp/nbf/signature checks); FR-038 (identity from verified token only, no `x-authorizer-context` trust — mirrors PR #39); FR-039 (read-for-all authz + `public_metadata`-gated admin); FR-040 (fail-closed); FR-041 (WebSocket `$connect` auth + per-`sub` notification scoping); FR-042 (`CLERK_JWT_KEY`/`CLERK_AUTHORIZED_PARTIES` config, non-secret). US-0 provides the end-to-end auth journey with 8 acceptance scenarios; SC-010/SC-011 make it measurable; A-011 fixes the authorizer placement. Consistent with CLAUDE.md "Authentication architecture" (Clerk).

**Result**: PASS

---

## Summary

| #   | Item                                   | Result |
| --- | -------------------------------------- | ------ |
| 1   | User Story Clarity                     | PASS   |
| 2   | FR Completeness                        | PASS   |
| 3   | NFR Coverage                           | PASS   |
| 4   | Key Entity Definitions                 | PASS   |
| 5   | Success Criteria Measurability         | PASS   |
| 6   | Assumption Validity                    | PASS   |
| 7   | Edge Case Coverage                     | PASS   |
| 8   | Constitution Compliance                | PASS   |
| 9   | [NEEDS CLARIFICATION] Markers          | PASS   |
| 10  | Internal Consistency                   | PASS   |
| 11  | Prose Quality and Formatting           | PASS   |
| 12  | Commise Integration                    | PASS   |
| 13  | Architecture Alignment                 | PASS   |
| 14  | No Unresolved Ambiguities              | PASS   |
| 15  | Traceability                           | PASS   |
| 16  | Completeness                           | PASS   |
| 17  | Authentication & Authorization (Clerk) | PASS   |

**Overall: 17/17 PASS — Spec is ready for `/speckit.plan` phase.**
