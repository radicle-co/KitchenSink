# V-Model Ingestion — consolidated findings (2026-07-25, verified)

Rigorous ingestion of the 5 traceability matrices against the real green suite. Most rows PASS with real
cited tests. Below are the GENUINE gaps/anomalies the audit surfaced (spot-verified against code), grouped by
disposition. Totals: A/B REQ rows ~151, C 32, D 33, H 72. Grounded PASS majority; the exceptions:

## CATEGORY 1 — SPEC-DRIFT (code is correct; the V-Model/spec doc is stale). Disposition: RECONCILE doc to as-built, PASS vs real behavior.

- NF-018/019/020 — default local port :3000 in code (main.ts, config, gate); spec/plan says :4000. Whole infra (ALB, SG) uses 3000 => code right.
- REQ-038b/c — SQS maxReceiveCount=5 shipped + cdk-synth-tested; requirement says 3. Deliberate.
- REQ-IF-006 / REQ-068 — real route /v1/users/me (client test guards against /v1/profiles/me drift); spec names /v1/profiles/me.
- REQ-043 — shipped conflict body fields currentVersion/conflictingVersion; spec says serverVersion/clientVersion.
- REQ-065 — gated widgets render skeleton/placeholder tiles (CR-001 amendment); older REQ text says fully absent.
- REQ-055b — member removal is read-time visibility filtering (design), not pull-triggered deletion.
- REQ-005/006 — ValidationPipe returns 400; acceptance-plan expects 422 (confirm OpenAPI contract = as-built 400).
- REQ-020a — non-owner-403 erasure scenario (ATP-020-B) N/A: erasure is self-service-only by design.
- ARCH-029/030/032, MOD-032 — Config/Telemetry/CI-governance are Inspection artifacts misclassified as Test in matrix => reclassify.
- HAZ-003 — void by design (merged into HAZ-065 per changelog).

## CATEGORY 2 — CHEAP COVERAGE GAP (behavior EXISTS, test missing). Disposition: ADD TEST -> PASS.

- REQ-002b — description-on-update untested.
- REQ-056b — collection survives deletion of a member recipe: untested.
- REQ-019b/c — S3 indefinite retention / no-auto-purge: no positive test.
- REQ-057 (part) — IngredientPicker has ZERO component tests web+mobile (test-mandate violation).
- ARCH-001 — ClerkAuthService real-JWT only unit-tested (integration harness uses dev-auth bypass).
- NF-003 — no timed/JSON-logged create-recipe scenario (ATP upgraded it to Test).

## CATEGORY 3 — REAL CODE GAP (behavior MISSING/incorrect). Disposition: FIX (input validation is NOT optional per prime directive) OR waiver-if-deferred.

- REQ-003a — 100-ingredient cap unenforced (no ArrayMaxSize/max). VERIFIED.
- REQ-007 — 50-tag cap unenforced. VERIFIED.
- REQ-049b — 50-collection-per-user cap unenforced (only string-length maxes). VERIFIED.
- REQ-005a/b/c, REQ-006 — negative prep/cook/total time + non-positive servings rejection untested/possibly unenforced (+ 422-vs-400).
- REQ-011/012 — client-side 5MB + MIME pre-validation ABSENT web+mobile (hook takes size/type but never checks). VERIFIED.
- REQ-030f — cook-time search filter missing everywhere (DTO/DAL/UI only prep+total). Likely 030e/f conflation.
- REQ-034 — disclosure notice renders unconditionally instead of gated to >=1 user-entered ingredient (over-satisfies).
- REQ-057 (behavior) — ingredient typeahead 2-char trigger / 300ms / ranking spec unimplemented.

## CATEGORY 4 — DEFERRED FEATURE (out of v1 scope). Disposition: WAIVER (deferred), owner sign-off.

- REQ-068 / REQ-IF-006 — Home layout persistence "absent in v1" per code comment.
- NF-004 — analytics pipeline not in-repo.
- NF-012b — branch-protection is a GitHub setting (not in-repo artifact).
- NF-015 — backlog-SLO needs live prod telemetry.
- REQ-049b cap / REQ-CN-005 physical-import path — CN-005 needs feature-004 OCR/import endpoint (not in 001).

## CATEGORY 5 — SAFETY / GDPR OPEN HAZARDS. Disposition: FIX or CONFIRMED-ACCEPTED-RESIDUAL waiver w/ justification. OWNER CALL.

- HAZ-052 (Catastrophic) — erasure write-lock: ERASURE_IN_PROGRESS/423 DEFINED + mapped but NEVER THROWN by any mutation path. VERIFIED. Lock doesn't exist. (Mitigating factor to confirm: does erasure delete the Clerk user first, 401-ing further mutations?)
- HAZ-051/067 (Critical, GDPR) + HAZ-039 (Serious) — mitigation claims CloudFront invalidation on delete/erasure; photos ARE served via CloudFront (photos.module cloudfrontUrl) but NO createInvalidation code exists (only S3 purge). Post-delete CDN edge cache persists until TTL. Real residual-exposure window (bounded by CF TTL).
