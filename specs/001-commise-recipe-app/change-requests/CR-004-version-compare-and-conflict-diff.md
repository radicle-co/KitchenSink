# CR-004 — Version compare/preview (FR-007b) and changed-only conflict resolution (FR-007c)

- **Status:** Accepted — _design only_ (implementation is W6 + W7, child plans — `docs/superpowers/plans/2026-07-1x-001-version-history.md` and `…-conflict-resolution.md` — not yet built; the X5-min concurrency fix ships earlier as a ship-gate item). Owner-approved 2026-07-18.
- **Date:** 2026-07-18
- **Area:** version-history UI · conflict-resolution UI · `@commise/features-recipes` (`versions/*`) · recipe-service versions module + contract · `version-history.md` + `conflict-resolution.md` wireframes
- **Related:** `spec.md` FR-007b/FR-007c, constraint C-005, `version-history.md` + `conflict-resolution.md` wireframes, the reconciliation plan (W6, W7, W8-a.2/.5/.6/.7).

## ⚠️ Before you change this — the traps

- **`totalTimeMinutes` is independent, NOT `prep + cook`** (domain contract; OQ-4 pending owner ruling) — a recipe may carry inactive time (rest/marinate/chill). The version snapshots and the diff must treat it as its own field.
- **The enriched 409 payload's `currentVersion` is the concurrency TOKEN, not display metadata** (W8-a.5). The resolve submit echoes it as `expectedVersion`; "Keep server" is a **client-side no-op** (no write); only "Overwrite"/"Merge" issue the CAS write with the full merged recipe. A second 409 during resolve re-opens the conflict UI.
- **S3 is transparent** (owner decision 8): there is NO user-facing "View in S3 archive" link. `GET …/versions/{n}` falls back to S3 for versions evicted from the last-10 DB window (W8-a.7); Preview/Compare therefore work for all versions.
- **Reuse `RecipeVersion.createdBy`; do NOT add `editedBy`** (DRY). `editorHandle` is user-controlled → escape at every render surface (W6 attribution AND W7 banner). ⛔ The `deviceLabel` half of this rule was **DELETED by owner ruling on 2026-08-26** — see the amendment below; do not reintroduce the field.

## Context

`version-history.md` specifies per-row **Preview**, a **Compare/diff sidebar** (Added/Removed/Modified), editor/device attribution, and an S3-archive affordance; `conflict-resolution.md` specifies a **changed-only diff** with per-field markers + legend, **A/B/C option cards**, a version/device/timestamp banner, and per-element merge. The shipped UI had Restore-only rows (no Preview/Compare) and a fixed-field conflict view that renders all fields both sides with no changed-only diff, no A/B/C, and a silent "mine" merge default (X5). This CR records the canonical FR-007b/FR-007c designs; the builds are the W6 and W7 child plans (with X5-min shipping earlier per the ship-gate).

## Decision

**Version history (W6, FR-007b):**

1. Per-row **Preview** + **Preview modal** (fields + ingredients at that version), backed by `GET …/versions/{n}` with **transparent S3 fallback** (W8-a.7).
2. **Compare/diff sidebar**: pick two versions → Added/Removed/Modified summary + full diff, computed client-side by a **pure diff function** (mutation-tested: reorder / add / remove / modify / no-change; v1-edge; non-adjacent).
3. Editor/device attribution: `createdBy` + denormalized `editorHandle` (W8-a.2) + `deviceLabel` (W8-a.6, "unknown device" when null), rendered via the escaping path. ⛔ **AMENDED 2026-08-26 — the `deviceLabel` half is deleted;** what ships is editor + timestamp attribution only.
4. No user-facing S3 link; "all versions available" is informational.

**Conflict resolution (W7, FR-007c):**

5. **Changed-only diff** with per-field `[=]`/`[→]` markers + legend — only differing fields, not the fixed set both sides.
6. **A/B/C option cards**: Keep server / Overwrite / Merge manually, each with a description.
7. **Conflict banner**: version numbers, device, timestamps per side (from the enriched 409 payload, W8-a.5).
8. **Per-element merge** (a single step/ingredient), not field-count granularity.
9. **X5 (data-loss defect) — two layers.** UI: disable Resolve until a selection exists; no silent "mine" default. Concurrency: resolve submits the full merged recipe via a **CAS on the 409's `currentVersion`** ("Overwrite"/"Merge"; "Keep server" = client no-op); a second 409 re-opens the UI. **X5-min ships earlier** (ship-gate) as a retrofit of the existing `RecipeConflictView`; this child plan re-hosts both layers in the A/B/C rebuild.
10. **Phantom (zero-diff) conflict**: a 409 with identical content collapses to a "no content differences — safe to keep either" fast path, not an empty A/B/C screen.
11. **Native adaptation** (both wireframes are web-only): the compare/diff sidebar and preview modal become full-screen sheets/takeovers; A/B/C cards stack vertically full-width; merge mode is a full-screen takeover, one field-choice per row.

## Alternatives rejected

- **Add `editedBy` for version attribution.** Rejected: `RecipeVersion.createdBy` already carries it — a second source of truth.
- **A user-facing S3 archive link.** Rejected: S3 is a cheap-storage implementation detail; users load any prior version through the normal API (owner decision 8).
- **Selection-gating alone for X5.** Rejected: it fixes the zero-choice UI default but not the concurrent-write lost-update — the resolve must CAS on the reconciled server version.

## ⛔ AMENDMENT — device attribution is DELETED (owner ruling, 2026-08-26)

The owner ruled on **2026-08-26** that device attribution comes out entirely: _"I don't care what device
they were on when they edited something."_ This amends **W8-a.6** and, through it, the FR-007b version-history
story recorded below. Every mention of `deviceLabel` / `device_label` in this document is **historical** from
this date; the field is gone from the Drizzle definition, the create/update REQUEST contract, the
`RecipeVersion` and `VersionConflictSide` RESPONSE contracts, the GDPR export projection, the W6 row
attribution and the W7 conflict banner and per-side cards.

**What the removal actually costs: nothing that ever reached a user.** Verified before deleting — **no writer
for the field existed anywhere.** Neither app, nor the typed client, nor any test outside the field's own unit
tests ever put `deviceLabel` on a create or update body, so every `recipe_versions.device_label` was `NULL`,
every render took the omit branch, and the _"(from iPhone)"_ suffix, the banner's _" on {device}"_ clause and
the per-side card's _"Device:"_ row have never once appeared in the product. There is also a recorded reason
it was never wired: this document's own trap list and `recipes.schema.ts` note that the published contract
listed the field only on the RESPONSE while marking both request bodies `additionalProperties: false` — the
contract forbade the field the service was waiting for. That defect had already been fixed; the ruling makes
the fix moot.

**What is genuinely lost is a capability, not a behaviour.** The W6/W7 designs below intended a cook editing
from two devices to be able to tell _which_ device produced a given version, which is the most legible way to
answer "did I do that on my phone?" during a conflict. After this amendment the version row attributes an
EDITOR (`by @handle`, W8-a.2) and a TIME, and nothing distinguishes two versions the same person wrote from
two different devices. That is a real reduction in the conflict story's explanatory power, and it is accepted
rather than denied — the owner's judgement is that it is not worth the field.

⚠️ **The `device_label` COLUMN is still in the physical table, deliberately, and its DROP is deferred to a
later release.** ADR-0022's standing precondition is EXPAND-FIRST — a contracting migration ships a release
LATER than the code that stopped reading the column — and migrations run in-stack BEFORE the new tasks serve,
so dropping it in the same release would leave the previous image issuing statements against a column that no
longer exists: a permanently-lost version row on every save (`recordSnapshot` swallows its error), plus
user-visible `500`s on version history, on the enriched 409, and on the GDPR export. The full per-path trace
is in `0014_version_device_label.sql`'s header.

**FOLLOW-UP (must ship):** a later release adds its own numbered migration performing
`ALTER TABLE recipe_versions DROP COLUMN IF EXISTS device_label;`. By then no image names the column, so that
migration carries no window. Do **not** amend `0014` to do it — that file has already run, and the runner
tracks applied migrations by name only.

## Impact

| Artifact                                            | Change                                                                                                                                                    |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| recipe-service versions module + `api.openapi.yaml` | enriched 409 payload (W8-a.5), ~~`deviceLabel` column (W8-a.6)~~ — deleted 2026-08-26, S3-fallback on the snapshot GET (W8-a.7), `editorHandle` (W8-a.2). |
| `@commise/features-recipes` `versions/*`            | Preview modal, Compare/diff sidebar + pure diff fn, changed-only conflict diff, A/B/C cards, per-element merge, CAS-resolve; web + `.native`.             |
| `version-history.md` / `conflict-resolution.md`     | reconciled during the W6/W7 child plans with native-adaptation notes.                                                                                     |

## Consequences

- The concurrent-edit lost-update is closed at the contract level (CAS token), not just the UI.
- Preview/Compare work for the full version history, with S3 invisible to the user.
- One pure diff function underpins both the compare sidebar and the changed-only conflict view.

## Hand-off

- **Backend (`be-1` / `db-arch-1`):** the enriched-409 same-transaction payload, ~~`deviceLabel` migration~~ (deleted 2026-08-26), S3-fallback read (W8-a.5/.7), with the concurrency + fallback integration tests.
- **Frontend (`fe-1`):** the W6 and W7 child plans; the **X5-min** retrofit lands earlier as a ship-gate item (see the reconciliation plan, §Delivery & release gating).
