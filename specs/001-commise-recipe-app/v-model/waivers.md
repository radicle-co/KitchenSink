# Waiver Register: 001-commise-recipe-app

**Feature**: Commise - Recipe Management Core
**Created**: 2026-07-25
**Owner**: Recipe Platform Team
**Status**: Active

---

### WAV-001

**Title:** HEIC/HEIF Recipe-Photo Support Deferred (REQ-012/REQ-013 Scope Reduction)
**Artifact:** REQ-012, REQ-013
**Justification:** The original spec draft named a five-type photo MIME allowlist (`image/jpeg`,
`image/png`, `image/webp`, `image/heic`, `image/heif`) for both the client pre-transmission guard
(REQ-012) and the server's magic-byte revalidation (REQ-013). Implementation investigation found the
recipe-service's installed `sharp` build's `heif` codec decodes AVIF only — it has no HEVC/H.265 decoder
(patent-encumbered, not bundled in prebuilt `sharp`/libvips binaries) — so a real HEIC/HEIF photo (e.g.
from an iPhone) would pass the server's `file-type`-based magic-byte detection but then fail cover-
thumbnail generation (FOLLOW-UP-CR-001-A). A client that accepted HEIC/HEIF per the original REQ-012
would therefore diverge from what the server could actually deliver end to end. Rather than ship that
divergence (client accepts, server can't reliably serve), the allowlist on BOTH sides is narrowed to the
three formats the pipeline verifiably handles: `image/jpeg`, `image/png`, `image/webp`. This also aligns
with `specs/001-commise-recipe-app/spec.md` FR-001a, which only ever named these three types — the
five-type list was a drift introduced downstream in the v-model `requirements.md`/`acceptance-plan.md`
artifacts, not a spec.md change.
**Scope:** `ALLOWED_RECIPE_PHOTO_MIME_TYPES` (`packages/shared/recipe-core/src/recipe.types.ts`),
`ALLOWED_UPLOAD_CONTENT_TYPES` (`packages/services/recipe-service/src/photos/photos.service.ts`,
re-exports the recipe-core constant), and all client/server tests + user-facing copy that enumerated the
allowlist.
**Remediation path:** Widen the shared allowlist (and the `file-type`-based detector, which already
recognizes HEIC/HEIF magic bytes) to include `image/heic`/`image/heif` once the thumbnail pipeline is
verified to genuinely decode + re-encode them end to end (e.g. a `libheif` build with an HEVC decoder, or
a pre-upload client-side HEIC→JPEG transcode).
**Approved By:** Recipe Platform Team
**Engineering Change Order:** ECO-001-001

---

### WAV-002

**Title:** Home Layout Persistence Deferred (REQ-068 / REQ-IF-006 Scope Reduction)
**Artifact:** REQ-068, REQ-IF-006
**Justification:** Both requirements call for persisting each user's Home layout (widget order and
hidden set) across devices via the identity service's (002) `PATCH /v1/users/me` profile-preferences
endpoint (`preferences.homeLayout` JSONB key). Implementation investigation found that Home v1 ships
with a fully working default-template widget surface (discovery, capability/tier gating,
CR-001 skeleton placeholders, per-widget error isolation), but the personalization read/write path
itself was deliberately not wired up — confirmed by the shipped code comment in both platforms'
`HomeWidgetSurface.tsx` ("order/hidden personalization lives in the identity profile preferences
(002); absent in v1"). No code in the repository calls `/v1/users/me` for a `homeLayout` value, and
`curateHomeWidgets`'s `ctx.order`/`ctx.hidden` inputs are never populated from any persisted source.
Every user, on every device, currently sees the same default widget order with nothing hidden.
**Residual Risk:** Low — cosmetic/UX only. Users cannot reorder or hide Home widgets, and no such
customization persists across devices or sessions. There is no data-integrity, security, or GDPR
exposure: no home-layout data is written, read, or exposed to another user. The acceptance scenarios
ATP-068-A and ATP-IF-006-A (cross-device layout persistence) cannot presently be executed end-to-end.
**Scope:** `packages/apps/commise/web/src/components/home/HomeWidgetSurface.tsx`,
`packages/apps/commise/mobile/src/components/home/HomeWidgetSurface.tsx`, the (currently unpopulated)
`ctx.order`/`ctx.hidden` inputs to `curateHomeWidgets` (`@commise/features-core`), and
`acceptance-plan.md` ATP-068-A / ATP-IF-006-A.
**Remediation path:** Implement `homeLayout` read (on Home mount) and write (on reorder/hide action)
through the existing, already-tested `PATCH /v1/users/me` profile-preferences endpoint once the
identity service's `preferences` JSONB surface is confirmed ready to carry it; wire the result into
`curateHomeWidgets`'s `ctx.order`/`ctx.hidden` context on both platforms.
**Approved By:** Recipe Platform Team
**Engineering Change Order:** N/A — no code change in this documentation-reconciliation pass; tracked
as future work.

---

### WAV-003

**Title:** Product Analytics Pipeline Not In-Repo (REQ-NF-004)
**Artifact:** REQ-NF-004
**Justification:** REQ-NF-004 requires that at least 80% of free-tier users exercise all three core
features (recipe creation, search, sharing) within their first calendar week, measured by the product
analytics pipeline (`analytics.events` table, `weekly_core_feature_adoption_pct` metric). This pipeline
is provided by a separate, not-yet-built analytics-instrumentation feature — it is an external system
this feature assumes the existence of, not something 001 implements. `requirements.md` already marks
this row `Analysis` (not `Test`) and flags it "out-of-V-Model-test-scope" (PRF-REQ-037); this waiver
formalizes that status in the register.
**Residual Risk:** None to feature correctness or safety — this is a soft, P3-demoted engagement/business
target, not a release-blocking functional obligation. The risk is purely one of deferred business
visibility: engagement cannot be measured until the analytics pipeline exists and accrues a week of data.
**Scope:** REQ-NF-004 and its acceptance-plan validation section (`ATP-NF-004-*`).
**Remediation path:** Build/instrument the analytics pipeline (`analytics.events` table and the
`weekly_core_feature_adoption_pct` metric) in a future feature, then re-verify against one week of live
production telemetry.
**Approved By:** Recipe Platform Team
**Engineering Change Order:** N/A — external dependency, not an 001 code change.

---

### WAV-004

**Title:** CI Merge-Gate Enforcement Is a GitHub Org Setting, Not an In-Repo Artifact (REQ-NF-012b)
**Artifact:** REQ-NF-012b
**Justification:** REQ-NF-012b requires the CI pipeline to block merge of any pull request unless all
five required check categories pass. The five checks themselves run as in-repo, inspectable GitHub
Actions workflows (`.github/workflows/{ci-pr,ci-main,ci-full,_ci}.yml`), but the actual **merge-blocking
enforcement** is configured as a GitHub repository branch-protection rule (required status checks) in
the repository's Settings UI — there is no Terraform/IaC definition of branch protection anywhere in
this repository, so it cannot be inspected, diffed, or tested from the codebase itself.
**Residual Risk:** Low but non-zero — branch-protection configuration can drift or be manually altered
outside of code review, with no in-repo record to detect the change. Mitigated in practice by GitHub
org-level admin permission restrictions (outside this feature's scope).
**Scope:** REQ-NF-012b and its acceptance-plan validation section (`ATP-NF-012a/b`).
**Remediation path:** Codify branch protection as infrastructure-as-code (e.g., via Terraform's GitHub
provider or a scripted `gh api` call in a repo-admin workflow) in a future change, making it an in-repo,
inspectable/testable artifact.
**Approved By:** Recipe Platform Team
**Engineering Change Order:** N/A — GitHub org setting, not an 001 code change.

---

### WAV-005

**Title:** Archive Backlog SLO Requires Live Production Telemetry (REQ-NF-015)
**Artifact:** REQ-NF-015
**Justification:** REQ-NF-015 requires that, under the `STD-LOAD-NORMAL` load condition (500 concurrent
authenticated users, 80/20 read/write mix, 120 write ops/minute sustained for 30+ minutes against a
production-equivalent staging environment), the `recipe_version_pending_archives` row count remains
below 100. `requirements.md` already classifies this row `Analysis` (not `Test`) for exactly this
reason: it cannot be proven by the unit/integration/e2e suite alone — it requires a sustained,
production-equivalent load run and cannot be meaningfully asserted against a LocalStack/ephemeral-DB
test environment.
**Residual Risk:** Moderate but bounded and monitored — if the backlog SLO were breached in production,
REQ-NF-016 (CloudWatch alarm at >100 rows for 15+ minutes) and REQ-NF-017 (alarm on oldest row >1 hour)
both fire independently of this waiver and are inspection-verified as wired (not merely aspirational).
The residual risk is limited to the gap between "SLO not pre-launch-proven" and "SLO breach silently
undetected," and the alarms close that second, more severe gap.
**Scope:** REQ-NF-015 and its acceptance-plan validation section (`ATP-NF-015-A`).
**Remediation path:** Execute the `STD-LOAD-NORMAL` scripted k6 load test (per the Testing Policy's
Services tier) against a production-equivalent staging environment once available, and continue relying
on the REQ-NF-016/017 CloudWatch alarms for ongoing production verification.
**Approved By:** Recipe Platform Team
**Engineering Change Order:** N/A — requires a staging environment run, not an 001 code change.

---

### WAV-006

**Title:** Physical-Copy (OCR) Import Path Deferred to Feature 004 (REQ-CN-005)
**Artifact:** REQ-CN-005
**Justification:** REQ-CN-005 requires that recipes flagged as imported from a physical copy
(photo/OCR) default to private visibility on creation. The `imported_physical` `sourceType` is a fully
implemented, policy-enforced enum value in this feature — `recipes/domain/visibilityPolicy.ts`
correctly forces it (and `imported_paid`) to private-only — but the **only way to create** a recipe with
that `sourceType` in 001 is via clone/seed data; the actual user-facing photo/OCR import action that
would set it from a real user flow is owned by feature `004` (out of 001's scope) and does not exist
yet. The acceptance scenario as written ("user imports a recipe marked as physical-copy origin")
therefore cannot be exercised end-to-end through a real import UI/API in this feature.
**Residual Risk:** Low — the privacy-default _policy_ itself is implemented and can be (and is)
verified directly against the `sourceType` enum value, so the GDPR/privacy-sensitive behavior this
requirement protects is not actually unverified. The residual gap is narrowly that the full user
journey (photo capture → OCR → recipe creation) cannot be exercised until feature 004 ships its
import endpoint.
**Scope:** REQ-CN-005 and its acceptance-plan validation section (`ATP-CN-005-A`).
**Remediation path:** Once feature `004`'s OCR/import endpoint ships and can create
`imported_physical` recipes via a genuine user-initiated import action, re-verify ATP-CN-005-A
end-to-end through that real flow instead of clone/seed data.
**Approved By:** Recipe Platform Team
**Engineering Change Order:** N/A — blocked on feature-004 scope, not an 001 code change.
