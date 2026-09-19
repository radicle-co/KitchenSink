# Wireframe: Recipe Search (Web)

**Branch**: `001-commise-recipe-app` | **Date**: 2026-05-09
**FRs**: [FR-006](../../spec.md#fr-006), [FR-004](../../spec.md#fr-004), [FR-044](../../spec.md#fr-044)

---

## ASCII Wireframe

```
+--------------------------------------------------------------------------+
|  Commise                                          [Morgan ▼] [Settings]|
+--------------------------------------------------------------------------+
|                                                                          |
|  +------------------+  +--------------------------------------------+   |
|  |                  |  |  Q  Search recipes...                       |   |  <- FR-006
|  |  FILTERS         |  +--------------------------------------------+   |
|  |                  |                                                  |   |
|  |  [ Clear all ]  |  Sort by: [ Relevance ▼ ]  [ Newest ▼ ]        |   |
|  |                  |                                                  |   |
|  |  Cuisine         |  Showing 47 results for "pasta"               |   |
|  |  [ ] Italian    |                                                  |   |
|  |  [ ] American   |  +------------------------------------------+ |   |
|  |  [ ] Thai       |  | [PHOTO]                                    | |   |
|  |  [ ] Mexican   |  | Grandma's Pasta                             | |   |
|  |  [ ] Indian    |  | by @alexk   |  Italian  |  45 min  |  Public | |   |  <- FR-004
|  |                  |  | 420 cal/serving  |  [Clone]               | |   |
|  |  Dietary        |  +------------------------------------------+ |   |
|  |  [ ] Vegetarian |                                                |   |
|  |  [ ] Vegan      |  +------------------------------------------+ |   |
|  |  [ ] Keto       |  | [PHOTO]                                    | |   |
|  |  [ ] Low-carb  |  | Simple Marinara Pasta                      | |   |
|  |  [ ] Gluten-free| | by @cookingwithkids |  30 min |  Public   | |   |
|  |                  |  | 310 cal/serving  |  [Clone]               | |   |
|  |  Prep time      |  +------------------------------------------+ |   |
|  |  (o) Any        |                                                |   |
|  |  ( ) < 15 min   |  +------------------------------------------+ |   |
|  |  ( ) 15-30 min |  | [PHOTO]                                    | |   |
|  |  ( ) 30-60 min |  | Creamy Garlic Pasta                        | |   |
|  |  ( ) > 60 min  |  | by @chefcarlos |  Italian  |  25 min | Public | |   |
|  |                  |  | 390 cal/serving  |  [Clone]               | |   |
|  |  Cook time      |  +------------------------------------------+ |   |
|  |  (o) Any        |                                                |   |
|  |  ( ) < 30 min  |  +------------------------------------------+ |   |
|  |  ( ) 30-60 min |  | [PHOTO]                                    | |   |
|  |  ( ) > 60 min  |  | Pasta Primavera                           | |   |
|  |                  |  | by @freshmarket |  40 min |  Public    | |   |
|  |  Ingredients    |  | 350 cal/serving  |  [Clone]               | |   |
|  |  [________]     |  +------------------------------------------+ |   |
|  |  e.g. chicken  |                                                  |   |
|  |                  |  +------------------------------------------+ |   |
|  |  Tags           |  | [PHOTO]                                    | |   |
|  |  [ ] family     |  | Spaghetti alla Carbonara                   | |   |
|  |  [ ] quick      |  | by @romancook |  Italian  |  35 min | Public | |   |
|  |  [ ] weeknight  |  | 480 cal/serving  |  [Clone]               | |   |
|  |  [ ] meal-prep  |  +------------------------------------------+ |   |
|  |  [ ] comfort    |                                                  |   |
|  |                  |  [ Load more results (12 more) ]            |   |
|  |  [ Apply ]      |                                                  |   |
|  +------------------+                                                  |   |
|                                                                          |
+--------------------------------------------------------------------------+
```

## Layout Notes

| Zone           | Description                                                                                           |
| -------------- | ----------------------------------------------------------------------------------------------------- |
| Left sidebar   | Sticky filter panel; checkboxes per category; radio for time ranges; text input for ingredient filter |
| Search bar     | Full-text search with live suggestions (FR-006)                                                       |
| Sort dropdown  | Relevance, Newest, Most Cloned, Quickest                                                              |
| Results header | Shows query + result count                                                                            |
| Recipe card    | Photo, title, author handle, cuisine tag, cook time, calories per serving, visibility, clone button   |
| Clone button   | Available on all public recipe cards (FR-005)                                                         |
| Load more      | Paginated; no infinite scroll (pagination preferred for performance)                                  |

## Filter Options (FR-006)

| Filter           | Type                                        | FR     |
| ---------------- | ------------------------------------------- | ------ |
| Keyword          | Full-text search                            | FR-006 |
| Cuisine          | Multi-select checkbox                       | FR-006 |
| Dietary category | Multi-select checkbox                       | FR-006 |
| Prep time        | Radio (Any / <15 / 15-30 / 30-60 / >60 min) | FR-006 |
| Cook time        | Radio (Any / <30 / 30-60 / >60 min)         | FR-006 |
| Ingredient       | Text input (matches ingredient list)        | FR-006 |
| Tags             | Multi-select checkbox                       | FR-006 |

## Loading State

- **When:** a search, or the default browse, is loading with nothing to show yet.
- **Shown:** the heading, source tabs, search field and filter bar stay on screen and usable, and so do the sort control (while searching, or after a rail's "see all") and back-to-browse (after a rail's "see all" while nothing is typed). Only the results area shows the card skeleton with its caption.
- **Filter bar:** on a first load it shows only the ingredient box and any filters already active, because there are no facets yet. Once facets exist, the bar keeps showing the **last settled** facets while a newer search is pending. It never empties while you type, which would make the filter groups jump on every keystroke.
- **Authority:** `docs/CODING_STANDARDS.md` §11.0 — the pending read suspends the results only.

## Updating Results State (a newer search is pending)

- **When:** results (or the browse rails) are on screen and the query, a filter or the sort has changed, but the new results have not arrived. This is the state after the 300 ms debounce, while the deferred query resolves.
- **Shown:** the **previous results stay, at full strength and fully usable**. They are not dimmed and not replaced by the skeleton. The results header keeps naming the query those results belong to ("Showing 12 recipes for “past”", `resultsForQuery`), which tells the viewer what they are looking at. If the new results take longer than **500 ms**, a thin, still (not moving) teal bar appears in the gap directly above the results. It takes no layout space, so nothing shifts.
- **Not dimmed, on purpose:** faded card text falls below the 4.5:1 text contrast floor. The stale results are still valid and can still be opened or cloned, so they must stay readable (`packages/apps/commise/ui/src/tokens/colors.ts`: "An ALPHA-tinted text colour is not a text colour").
- **Behaviour:** nothing is announced when the search starts, and the results are deliberately **not** marked busy — JAWS hides content marked busy, which would take away the results this state keeps usable. When the new results land, the new header text is announced once, politely ("Showing 9 recipes for “pasta”", or "No matching recipes"). The same announcement follows **Load more** ("Showing 24 recipes for “pasta”"), because the load-more control itself announces only a failure, and a background refresh that changes the count is announced the same way. If the pending search fails, the load-error state replaces the results, and focus stays in the search field.

## Load Error State

- **When:** a search (or the default browse load) fails with nothing loaded for it.
- **Shown:** everything above the results stays: heading, tabs, search, filter bar, back-to-browse and sort. The results area, or the browse rails, is replaced by the error message and **Try again**. A search that fails does not clear the typed query.
- **Behaviour:** the error is announced as an alert, and focus stays where it was.
- **One browse rail:** each rail loads on its own, so a rail that fails while the others load shows only "Couldn’t load this row." with **Try again** under its own heading, retrying that rail alone. The other rails, every heading and the cuisine shortcuts stay. The rail's failure is announced as an alert, so a retry that fails again is heard; pressing **Try again** moves focus to that rail's heading, because the pressed button is replaced by the rail's loading body. (Build note: each rail reads behind its own boundary, and a failure there stays until it is retried, so the retry is the way out.)

## Refresh Failure State

- **When:** a refresh fails while results or browse rails are on screen — pull-to-refresh on mobile, or a focus/reconnect refresh on either platform.
- **Shown:** what is on screen stays. Over search results, an inline notice reads "We couldn’t refresh these results."; over the browse rails, ONE notice for the whole block reads "We couldn’t refresh these recipes." Each has **Try again**. The load-error state above is only for a search that failed with nothing to show. It replaces the results area, not the page.
- **Behaviour:** the notice announces politely, keeps its button (busy) while any retry runs, and clears on the next successful refresh. When its own Try again succeeds, focus moves to the page heading (results) or the first rail’s heading (rails).
- **Authority:** `docs/CODING_STANDARDS.md` §11.0.

## FR Annotation Summary

| Element                     | FR     |
| --------------------------- | ------ |
| Full-text search            | FR-006 |
| Filter sidebar              | FR-006 |
| Public recipe results only  | FR-004 |
| Author attribution on cards | FR-005 |
| Clone button                | FR-005 |
| Sort controls               | FR-006 |
| Pagination                  | FR-006 |
| Web layout                  | FR-044 |
