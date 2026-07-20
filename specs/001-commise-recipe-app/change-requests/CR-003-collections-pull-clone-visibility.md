# CR-003 — Collections: pull-updates preview, clone, and visibility (FR-010/011 UI surfaces)

- **Status:** Accepted — _design only_ (implementation is W5, a child plan — `docs/superpowers/plans/2026-07-1x-001-collections.md` — not yet built). Owner-approved 2026-07-18.
- **Date:** 2026-07-18
- **Area:** collection detail UI · `@commise/features-recipes` (`collections/*`) · recipe-service collections module + contract · `collection-view.md` wireframe
- **Related:** `spec.md` FR-008/009/010/011, `collection-view.md` wireframe, the reconciliation plan (W5, W8-a.8, decision 7).

## ⚠️ Before you change this — the traps

- **Pull-from-source has NO dry-run today** — the shipped `POST /v1/collections/{id}/pull-from-source` _commits_ (records `addedVia=pull`). The preview dialog needs a **separate read-only endpoint** (W8-a.8), not a flag on the mutating handler.
- **The preview→commit boundary is a TOCTOU.** The user acts on a _previewed_ diff; the source can change before they confirm. The commit re-derives live and MUST warn / re-preview on any difference — including the caller's OWN clone membership changing (not just the source). Authoritative check = diff-vs-previewed-diff, not a source-only marker (W8-a.8).
- **Preview must not disclose gone-private/gone-draft source recipes.** The diff is computed over the owner-visibility-AND-status-scoped source listing (`CollectionsDal.listRecipes`, W8-a.3), same authz as the real pull (`requireOwned`).
- **Member rows compose `RecipeCard.*` (P7)** — no bespoke row card.

## Context

The `collection-view.md` wireframe specifies a right sidebar with **Pull Updates from Source**, **Clone Collection**, and a **visibility toggle** (premium), a **pull-updates preview dialog** (new/removed/unchanged breakdown), member rows with source-indicator + metadata, a clone-info panel, and a back affordance. The shipped collection detail had none of the sidebar actions, no preview dialog, and metadata-poor rows. This CR records the canonical design for those FR-010/011 surfaces; the build is the W5 child plan.

## Decision

1. **Pull-Updates preview dialog (owner decision 7).** A read-only preview endpoint (W8-a.8) returns `{ added, removed, unchanged }` over one shared diff function also used by the commit. The dialog shows the breakdown; **Confirm** calls `pull-from-source` echoing the previewed diff; the server recomputes live and **warns / re-previews** if it differs (source drift OR own-membership change) before applying. The dialog is built on the house **Radix `Dialog`** pattern (B6 — focus trap / Escape / focus-return).
2. **Clone Collection** + **clone-info panel** (`[View Source]`, "Last pulled") per FR-011.
3. **Visibility toggle** (public/private), premium-gated via the shared authorization **Specification/Policy** module (`canGoPrivate(collection, viewer)`, W9-f P4) — never an inline `=== 'premium'` per container.
4. **Member rows** compose `RecipeCard.*` (P7): source-indicator checkbox, `by @author` (= `authorHandle`, W8-a.2), `vN`, visibility, calories.
5. **Header**: visibility badge, recipe count, source attribution + "Last pulled".
6. **Native adaptation** (the wireframe is web-only): the preview/drift dialog is a full-screen sheet at narrow widths; the sidebar actions collapse into the screen header's action row.

## Alternatives rejected

- **A `?dryRun=true` flag on the committing pull handler.** Rejected: a read-only preview endpoint makes "preview cannot mutate" unrepresentable rather than merely intended (make illegal states unrepresentable).
- **A source-version marker (e.g. `collections.updated_at`) as the drift guard.** Rejected: membership rows don't touch it, and it misses own-clone-membership changes; the authoritative check is the recomputed-diff-vs-previewed-diff (W8-a.8).

## Impact

| Artifact                                               | Change                                                                                                        |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| recipe-service collections module + `api.openapi.yaml` | new read-only `pull-from-source/preview` endpoint + shared diff fn (W8-a.8).                                  |
| `@commise/features-recipes` `collections/*`            | sidebar actions, preview/drift dialog (Radix), clone-info panel, `RecipeCard.*` member rows; web + `.native`. |
| authorization module (`recipe-core` / P4)              | `canGoPrivate` predicate consumed by the visibility toggle.                                                   |
| `collection-view.md`                                   | (unchanged here — reconciled during the W5 child plan with the native-adaptation note).                       |

## Consequences

- The user is never silently given a pulled set different from the one they previewed.
- One diff function governs preview and commit — they cannot disagree.
- No bespoke collection-row card; the compound `RecipeCard` is reused.

## Hand-off

- **Backend (`be-1`):** the read-only preview endpoint + shared diff fn + drift-echo protocol (W8-a.8), with the no-mutation and drift-warning integration tests.
- **Frontend (`fe-1`):** the W5 child plan — sidebar actions, preview/drift dialog, member-row composition, visibility gating; web + `.native` parity + Maestro.
