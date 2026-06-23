# Wireframe: Ingredient Picker (Recipe Editor)

**Branch**: `003-usda-food-data` | **Date**: 2026-05-09
**Updated**: 2026-06-22 — re-baselined to the source-agnostic food data model (ingredients link to a golden-record food by internal `id`; misses are **added by name** and move through the `PENDING → (UNRESOLVED) → RESOLVED / NOT_FOUND / FAILED` lifecycle; no `fdcId`).
**FRs**: FR-003 (202 on miss), FR-004/FR-013 (add dedup), FR-011 (enqueue on miss), FR-033 (polling), US-2 / US-2a (add-by-name + candidate disambiguation)

---

## ASCII Wireframe

```
+--------------------------------------------------------------------------+
| Recipe Editor — Ingredients                                               |
+--------------------------------------------------------------------------+
| 1) [200] [g] [ chicken breast________________ ] [Search] [Matched ✅]     |
|    -> Chicken, breast, raw (Generic) · golden record                       |
|                                                                            |
| 2) [1] [tbsp] [ gochujang____________________ ] [Add by name] [Pending ⏳]|
|    -> status: PENDING (ETA ~25s) [Check status]                            |
|                                                                            |
| 3) [2] [whole] [ plantain____________________ ] [Add by name] [Review ❔] |
|    -> UNRESOLVED: 3 candidates found  [Choose match →]                     |
|       (opens Candidate Resolution — see candidate-resolution.md)           |
|                                                                            |
| 4) [10] [g] [ custom spice blend_____________ ] [Add by name] [Not found ⚠️]|
|    -> no source has this; kept as freeform ingredient (no nutrition)       |
|                                                                            |
| 5) [1] [cup] [ heirloom broth________________ ] [Add by name] [Failed ❌]  |
|    -> a source errored after retries; [Retry] later                        |
|                                                                            |
| [Add ingredient row]                                                       |
+--------------------------------------------------------------------------+
```

### Per-row state legend

```
  [Matched ✅]   linked to an existing golden-record food (by internal id)
  [Pending ⏳]   added by name; assembling across sources (poll via Check status)
  [Review ❔]    UNRESOLVED — multiple candidates; user must pick (US-2a)
  [Not found ⚠️] NOT_FOUND — no source has it; usable only as freeform text
  [Failed ❌]    a source fetch errored after retries; retryable later
```

## Notes

- A matched row links an ingredient to a **golden-record food by its internal `id`** (the optional Food↔Ingredient link). No source-native key is shown.
- A miss is resolved by **adding the name** (`POST /v1/foods`), which returns `202 Accepted` + `id` and enqueues a background sync (FR-003, FR-011). The row then polls `GET /v1/foods/{id}` (FR-033) and reflects the lifecycle status without blocking recipe save.
- Concurrent / duplicate adds for the same normalized name collapse to one `id` (FR-004 / FR-013) — a viral ingredient is fetched once.
- `UNRESOLVED` rows surface a **[Choose match →]** action that opens the Candidate Resolution screen; once the user picks, the row flips to `Matched ✅`.
- `NOT_FOUND` rows remain usable as freeform text (no nutrition contribution); `FAILED` rows offer a retry (the food is re-fetchable).
- USDA is just one of the sources the background fan-out consults; the picker never names it.
