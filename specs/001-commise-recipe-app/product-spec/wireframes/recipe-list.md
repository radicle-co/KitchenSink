# Wireframe: Recipe List (Mobile)

**Branch**: `001-commise-recipe-app` | **Date**: 2026-05-09
**FRs**: [FR-006](../../spec.md#fr-006), [FR-004](../../spec.md#fr-004), [FR-044](../../spec.md#fr-044)

---

## ASCII Wireframe

```
+--------------------------------------------------+
|  [Auth status: Morgan]          [Settings icon]   |  <- FR-045 (auth required)
+--------------------------------------------------+
|                                                  |
|  +--------------------------------------------+  |
|  |  Q  Search recipes...            [Filters]  |  |  <- FR-006: full-text search
|  +--------------------------------------------+  |
|                                                  |
|  [-- My Recipes --]  [-- Community --]          |  <- Tab: own vs public
|                                                  |
|  Filter chips:                                   |  <- FR-006: filter by
|  [+ Italian] [+ Quick (<30m)] [+ Low-carb]     |     tags, cuisine,
|                                                  |     dietary, time
|  +------------------------------------------+   |
|  |  [PHOTO]                            [PRO] |   |  <- PRO: private + owner-chosen (CR-001/D-C)
|  |  Grandma's Pasta                           |   |
|  |  Italian | 45 min | 420 cal | [Medium]    |   |  <- cuisine, total time, lead cal, difficulty
|  |  ★★★★☆  4.2 (18)                           |   |  <- star rating: average + count (CR-001/D-B)
|  |  [Tags: pasta, family, italian]           |   |
|  |  v12  |  Public  |  Edited 2d ago        |   |  <- version badge, visibility badge (mockup)
|  +------------------------------------------+   |
|                                                  |
|  +------------------------------------------+   |
|  |  [PHOTO]                                  |   |
|  |  Lemon Herb Chicken                        |   |
|  |  American  |  30 min  |  310 cal           |   |
|  |  [Tags: chicken, keto, quick]             |   |
|  |  v3  |  Private  |  Created 1w ago         |   |  <- FR-003: private badge
|  +------------------------------------------+   |
|                                                  |
|  +------------------------------------------+   |
|  |  [PHOTO]                                  |   |
|  |  Spicy Thai Basil Tofu                    |   |
|  |  Thai  |  25 min  |  280 cal               |   |
|  |  [Tags: tofu, thai, spicy]               |   |
|  |  v7  |  Public  |  Edited 3d ago          |   |
|  +------------------------------------------+   |
|                                                  |
|  +------------------------------------------+   |
|  |  [PHOTO]                                  |   |
|  |  Overnight Oats                           |   |
|  |  American  |  5 min  |  350 cal           |   |
|  |  [Tags: breakfast, meal-prep]            |   |
|  |  v2  |  Public  |  Created 2w ago         |   |
|  +------------------------------------------+   |
|                                                  |
|  --- end of results ---                          |
|                                            +----+ |
|                                            | +  | |  <- "+" FAB: create recipe (FR-001);
|                                            +----+ |     floats bottom-right, above nav,
|                                                  |     pinned on scroll (not in flow)
+--------------------------------------------------+
|  [Recipes]    [Collections]    [Meal Plan]       |  <- FR-044: feature parity
|    [*]              [ ]            [ ]            |     bottom nav
+--------------------------------------------------+
```

> **Create affordance (canonical):** the create-recipe entry point is the floating action button (FAB) above — a circular, `+`-glyph button pinned bottom-right over the scroll area, **not** an inline button in the header. Web and mobile both render it as a pinned FAB (FR-044 parity). This resolves the prior contradiction where the ASCII omitted the FAB while the interaction note required it.

> **Merged recipe card (canonical — CR-002).** Every card renders the unified design shown on the first card above: photo · title · **cuisine · total time · lead calories · difficulty pill** · **★ rating (average + count)** · tags · **version badge** · **visibility badge** · relative timestamp, plus a **PRO** badge when the recipe uses a premium-only capability. The `difficulty`, star `rating`, and `PRO` badge come from CR-001 (D-A/D-B/D-C); `cuisine`, lead `calories`, `tags`, `version`, and `visibility` come from the original mockup — CR-002 unifies them into one card so the shared `RecipeCard` (also the Home "recent recipes" widget card) never diverges. Cards 2–4 above omit the CR-001 elements only for brevity; the canonical card is the first.

> **Draft presentation (canonical — draft-status ruling).** A recipe whose `status` is `draft` (persisted, W8-a.3) renders a **"Draft" badge that REPLACES the visibility badge** — it MUST NOT show "Public" (a free-tier draft carries `visibility='public'` while being invisible to the community; showing "Public" would mislead). Drafts appear in the **owner's own** My Recipes list and nowhere else (absent from Community / search / other users' views); tapping a draft resumes editing. Save-Draft returns the user to this list where the draft is visibly present (no perceived data loss).

## Layout Notes

| Zone             | Description                                                                                                                                                                                                                                                                              |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Header           | Auth status (avatar) + settings — **app-chrome owned**, intentionally NOT part of the list view/component (rendered by the shell); no unauthenticated access (FR-045)                                                                                                                    |
| Search bar       | Full-text input; tap opens dedicated search page (recipe-search.md)                                                                                                                                                                                                                      |
| Filter chips     | Horizontal scroll; active = filled; each activates a filter (FR-006)                                                                                                                                                                                                                     |
| Tab bar          | "My Recipes" shows owned; "Community" shows public shared recipes (FR-004)                                                                                                                                                                                                               |
| Recipe card      | The **merged canonical card (CR-002)**: photo, title, cuisine tag, total time, lead nutrition calorie, **difficulty pill (CR-001)**, **star rating avg+count (CR-001)**, tags, version badge, visibility badge, relative timestamp, and a **PRO badge (CR-001)** when premium-capability |
| Version badge    | "v{N}" shown when version > 1 (FR-007b)                                                                                                                                                                                                                                                  |
| Visibility badge | "Public" (default, all users) or "Private" (premium only — FR-003) — **REPLACED by a "Draft" badge when `status='draft'`** (owner-only; draft-status ruling)                                                                                                                             |
| Create FAB       | Floating "+" action button, pinned bottom-right above the bottom nav (fixed/absolute, not in document flow); the sole create-recipe entry point on both platforms (FR-001, FR-044)                                                                                                       |
| Bottom nav       | Three tabs; Recipes active; feature parity across web and mobile (FR-044)                                                                                                                                                                                                                |

## Mobile Gesture / Interaction Notes

- Tap recipe card → navigate to [recipe-detail.md](./recipe-detail.md)
- Long-press card → context menu (Edit / Delete / Add to collection)
- Pull-to-refresh → reload list with latest data
- Tap "+" FAB → navigate to [recipe-edit.md](./recipe-edit.md) (new recipe)

## FR Annotation Summary

| Element                        | FR              |
| ------------------------------ | --------------- |
| Auth required                  | FR-045          |
| Create recipe FAB              | FR-001          |
| Search bar                     | FR-006          |
| Filter chips                   | FR-006          |
| Community tab (public recipes) | FR-004          |
| Recipe card photo              | FR-001          |
| Nutrition data                 | FR-007, FR-007a |
| Version badge                  | FR-007b         |
| Visibility badge               | FR-003          |
| Bottom nav                     | FR-044          |
