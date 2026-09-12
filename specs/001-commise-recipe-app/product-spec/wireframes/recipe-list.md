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

## Loading State

- **When:** the first load of the library, with nothing to show yet.
- **Shown:** the heading, the source tabs and the search field stay on screen and usable. Only the results area shows the card skeleton, captioned "Loading recipes" (`list.loadingLabel`). No filter chips (they come from the loaded recipes) and **no create dial** — until the library answers, the app cannot tell whether it is empty, and an empty library shows its own create button instead.
- **Behaviour:** the caption announces politely. The skeleton does not animate for anyone who has asked for reduced motion.
- **Authority:** `docs/CODING_STANDARDS.md` §11.0 — the pending read suspends the results only, never the heading, tabs or search.

## Load Error State

- **When:** the first load fails, with nothing to show.
- **Shown:** the heading, tabs and search stay. The results area is replaced by the error message and **Try again**. On **My Recipes** the create dial **still shows**: creating a recipe does not depend on this read, and a true-empty library cannot be detected here, so no empty-state create button replaces it. Hiding it would leave Try again as the only action. Never on **Community**.
- **Behaviour:** the error is announced as an alert. Focus stays where it was. After a successful Try again, the loaded results replace the error in place.
- **Build note:** the dial belongs to the results area, so the load-error body (`RecipeListLoadError`) renders it explicitly — unconditionally, because this list is only ever the **My Recipes** source (Community is the discovery surface, which has no dial). The loading body (`RecipeListLoading`) never renders it.

## Refresh Failure State

- **When:** a refresh fails while recipes are on screen — pull-to-refresh on mobile, or a focus/reconnect refresh on either platform.
- **Shown:** the recipes stay, and an inline notice above the list reads "We couldn’t refresh your recipes." with **Try again**. The load-error state above is only for a load that failed with nothing to show. It replaces the results area, not the page.
- **Behaviour:** the notice announces politely, keeps its button (busy) while any retry runs, and clears on the next successful refresh. When its own Try again succeeds, focus moves to the page heading.
- **Authority:** `docs/CODING_STANDARDS.md` §11.0.

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
