# Wireframe: Food Search (Web)

**Branch**: `003-usda-food-data` | **Date**: 2026-05-09
**Updated**: 2026-06-22 — re-baselined to the source-agnostic food data model (search/add by **name**, golden-record results keyed by internal `id`; no `fdcId`, no cache-hit/miss framing).
**FRs**: FR-008 (local search), FR-009 (no external source call on search), FR-010 (relevance + performance), US-2 (add-by-name on miss)

---

## ASCII Wireframe

```
+--------------------------------------------------------------------------+
|  Commise Food Search                              [User ▼] [Settings]  |
+--------------------------------------------------------------------------+
|  Q Search foods by name... (local store only)                              |
|                                                                            |
|  Filters: [Branded / Generic ▼] [Brand ▼] [Has Macros ▼] [Clear]          |
|                                                                            |
|  Showing 24 local matches for "chicken"                                   |
|                                                                            |
|  +--------------------------------------------------------------------+   |
|  | Chicken, breast, meat only, raw                      [Generic]     |   |
|  | 120 kcal | P 22g | C 0g | F 2.6g                                  |   |
|  | Golden record · assembled from 2 sources    [Select] [View detail]|   |
|  +--------------------------------------------------------------------+   |
|                                                                            |
|  +--------------------------------------------------------------------+   |
|  | Chicken breast deli slices              [Branded: Example Foods]   |   |
|  | 90 kcal | P 18g | C 2g | F 1g                                     |   |
|  | Golden record · 1 source                    [Select] [View detail]|   |
|  +--------------------------------------------------------------------+   |
|                                                                            |
|  --- No local match for the name you typed? ---------------------------   |
|                                                                            |
|  +--------------------------------------------------------------------+   |
|  | "gochujang" isn't in your food library yet.                        |   |
|  |                                          [+ Add "gochujang" by name]|   |
|  +--------------------------------------------------------------------+   |
|                                                                            |
|  [Search never calls an external source — adding by name does]            |
+--------------------------------------------------------------------------+
```

### After "Add by name" (PENDING state)

```
+--------------------------------------------------------------------------+
|  +--------------------------------------------------------------------+   |
|  | "gochujang"                                          [Pending ⏳]   |   |
|  | Looking across all sources for a match...                          |   |
|  | This usually takes ~30s.                          [Check status]   |   |
|  +--------------------------------------------------------------------+   |
+--------------------------------------------------------------------------+
```

### Resolution outcomes for an added name

```
  [Pending ⏳]      → still assembling across sources (poll continues)
  [Resolved ✅]     → golden record ready; row becomes selectable
  [Needs review ❔] → multiple candidates found → open Candidate Resolution
                     (see candidate-resolution.md)
  [Not found ⚠️]    → no source has this food → see message below
  [Failed ❌]       → a source errored after retries; try again later
```

### NOT_FOUND message (no source has this food)

```
+--------------------------------------------------------------------------+
|  +--------------------------------------------------------------------+   |
|  | "unicorn meat"                                       [Not found ⚠️] |   |
|  | No source has this food. You can keep it as a freeform ingredient  |   |
|  | (no nutrition data), or try a different name.                      |   |
|  |                          [Keep as freeform] [Edit name & retry]    |   |
|  +--------------------------------------------------------------------+   |
+--------------------------------------------------------------------------+
```

## Notes

- Search is **local-store only**; it never calls an external source (FR-009). To bring a missing food in, the user **adds it by name** (`POST /v1/foods`), which returns `202 Accepted` + an internal `id` and resolves asynchronously (US-2).
- Results are golden records keyed by internal `id` — assembled/merged across one or more sources. The card shows the **branded/generic** badge and (optionally) how many sources contributed; it does **not** expose any source-native key (no `fdcId`).
- Results are relevance-ranked and typo tolerant via `pg_trgm` (FR-010): "avacado" still matches "Avocado, raw".
- An added name moves through `PENDING → RESOLVED` (confident merge) or `PENDING → UNRESOLVED` (multiple candidates → the user disambiguates on the Candidate Resolution screen). `NOT_FOUND` ("no source has this") and `FAILED` are surfaced explicitly inline.
- USDA is **one source among many**; the UI never names a specific source as "the" database.
