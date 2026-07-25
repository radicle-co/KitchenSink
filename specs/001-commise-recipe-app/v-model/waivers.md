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
