# CR-002 — List-card merge: one canonical `RecipeCard` unifying the CR-001 fields and the original mockup

- **Status:** Accepted — _design only_ (wireframe `recipe-list.md` amended; implementation is W1 Task 1.2 of the reconciliation program, not yet built). Owner-approved 2026-07-18.
- **Date:** 2026-07-18
- **Area:** recipe list/card UI · `@commise/features-recipes` (`card/RecipeCard.*`, `card/model.ts`) · Home "recent recipes" widget · `recipe-list.md` wireframe
- **Related:** [CR-001](./CR-001-mockup-parity.md) (difficulty / ratings / derived PRO), `recipe-list.md` wireframe, the reconciliation plan (`docs/superpowers/plans/2026-07-18-001-mockup-parity-reconciliation.md` — W1, decision 4).

## ⚠️ Before you change this — the traps

- **The list card and the Home "recent recipes" widget card are the SAME component** (`card/RecipeCard.*`, driven by `card/model.ts` → `RecipeCardModel`, rendered on Home via `RecentRecipeItem`). Reshaping the model reshapes both surfaces — the widget and its tests are in scope, not collateral damage.
- **Do NOT widen a flat prop bag.** The card is built as a **compound component** (W9-f P7): `RecipeCard.Cover / .Title / .Meta / .Badges / .Rating / .Tags`, each composing from a shared context. Four surfaces (list, Home widget, search result, collection member row) compose their own arrangement; adding a per-surface boolean/optional prop is the accretion this CR exists to prevent.
- **PRO is derived, never stored** (CR-001/D-C): `usesPremiumCapability` in `@kitchensink/recipe-core`. The card renders the server-projected boolean; it does not recompute the rule.
- **`difficulty` absent → no pill, never a guessed value** (CR-001/D-A). `averageRating` absent (unrated) → no stars, never `0`.

## Context

CR-001 added `difficulty`, a star `rating` (average + count), and a derived `PRO` badge to the recipe card — but the `recipe-list.md` wireframe still drew the _original_ card (cuisine · time · lead calories · tags · version badge · visibility badge · timestamp). Two card designs for one component. The audit (reconciliation program) found the shipped `RecipeCard` had drifted toward the CR-001 fields while dropping several mockup fields (version badge, visibility badge). This CR unifies them so the wireframe and the code describe one card.

## Decision — one merged card, canonical on both the wireframe and the code

The single canonical `RecipeCard` renders **all** of:

| Element                | Source           | Notes                                                                                                                           |
| ---------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| photo (cover)          | mockup / CR-001  | `coverPhotoUrl` — server-resolved thumbnail (CR-001/D-D adjacent), not the full original                                        |
| title                  | mockup           |                                                                                                                                 |
| cuisine tag            | mockup           | omitted when absent                                                                                                             |
| total time             | mockup           |                                                                                                                                 |
| lead calories          | mockup           | `leadCaloriesPerServing` — a **new denormalized field on the list projection** (W8-a.1), nullable; omitted when absent          |
| difficulty pill        | CR-001/D-A       | omitted when `difficulty` is null; label + color (NFR-004)                                                                      |
| ★ rating (avg + count) | CR-001/D-B       | omitted when unrated (`averageRating` null)                                                                                     |
| tags                   | mockup           |                                                                                                                                 |
| version badge `v{N}`   | mockup           | shown when `currentVersion > 1`                                                                                                 |
| visibility badge       | mockup / FR-003  | "Public" / "Private" — **REPLACED by a "Draft" badge** when `status='draft'` (draft-status ruling; owner-only surface)          |
| relative timestamp     | mockup           |                                                                                                                                 |
| PRO badge              | CR-001/D-C       | derived `usesPremiumCapability`; premium-only capability                                                                        |
| author handle          | (search surface) | `by @handle` = the denormalized `authorHandle` (W8-a.2); rendered on the search/discovery composition, not the owner's own list |

**Author/editor "handle" = the identity service's `profiles.displayName`** (doc-review ruling), denormalized onto recipe rows at write time and kept fresh by the handle-sync path (W8-a.2). No new identity concept.

## Alternatives rejected

- **Keep two cards (list vs widget/search).** Rejected: guarantees drift; the shared component exists precisely so list, Home widget, search, and collection rows can never disagree.
- **Fully restore the raw mockup card, dropping CR-001's difficulty/rating/PRO.** Rejected: CR-001 is ratified and its fields are shipped/valued; "mockup is the floor" (Decision 1) means the card shows _at least_ the mockup, retaining superior shipped affordances.
- **Widen the flat `RecipeCardModel` prop bag with per-surface optionals.** Rejected: the exact prop-accretion / boolean-prop anti-pattern; the compound-component composition (P7) is the fitting shape.

## Impact

| Artifact                                        | Change                                                                                                                                                                                                                                                             |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `recipe-list.md` wireframe                      | Card ASCII + Layout Notes updated to the merged design; draft-badge rule added (done in this CR).                                                                                                                                                                  |
| `@commise/features-recipes` `card/RecipeCard.*` | Rebuilt as a compound component (P7); `card/model.ts` `RecipeCardModel` gains `cuisine?`, `leadCaloriesPerServing?`, `tags`, `currentVersion`, `visibility`, `status`, `authorHandle` (reusing existing `updatedAt`, difficulty, rating, `usesPremiumCapability`). |
| Home widget                                     | `RecentRecipeItem` + `RecipeWidgetCard` tests updated (same component).                                                                                                                                                                                            |
| `Recipe` list projection                        | `leadCaloriesPerServing` (W8-a.1) + `authorHandle` (W8-a.2) added; drafts excluded from non-owner list surfaces (W8-a.3).                                                                                                                                          |

## Consequences

- One authoritative card; list, Home widget, search, and collection rows can no longer diverge.
- The compound-component seam makes future card fields additive compositions, not prop-bag growth.
- A draft can never render "Public" — the badge replacement makes the misleading state unrepresentable on the card.

## Hand-off

- **Frontend (`fe-1`):** W1 Task 1.2 — the compound `RecipeCard` + merged model + the card-branch test matrix (including the draft-badge and PRO-absent branches), web + `.native` parity.
