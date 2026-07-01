# Wireframe: Food Detail (Mobile)

**Branch**: `003-usda-food-data` | **Date**: 2026-05-09
**Updated**: 2026-06-22 — re-baselined to the source-agnostic food data model (golden record keyed by internal `id`, with **per-field source provenance** instead of a single-source record view; no `fdcId`, no `fetch_status`).
**FRs**: FR-002 (complete food data), FR-007 (status semantics), FR-028 (golden record + per-field provenance), US-2a scenario 4 (provenance), US-7 (change-driven refresh)

---

## ASCII Wireframe

```
+--------------------------------------------------+
| [< Back]  Food Detail                 [Add]      |
+--------------------------------------------------+
| Chicken, breast, raw                  [Generic]  |
| Status: Resolved ✅                              |
| Assembled from 2 sources                         |
|                                                  |
| +-- Nutrition (per 100g) ----------------------+ |
| | Field      Value        Source               | |
| | Calories   120 kcal     Source A             | |
| | Protein    22.5 g       Source A             | |
| | Carbs      0.0 g        Source A             | |
| | Fat        2.6 g        Source B             | |
| | Fiber      0.0 g        Source A             | |
| | Sodium     45 mg        Source B             | |
| +----------------------------------------------+ |
| | ⓘ Each value shows the source it came from.  | |
| |   Tap a row for source detail.               | |
| +----------------------------------------------+ |
|                                                  |
| +-- Identity fields ---------------------------+ |
| | Name        Source A   (highest priority)    | |
| | Brand       —          (generic food)        | |
| | Picked by   you        (manual resolution)   | |
| +----------------------------------------------+ |
|                                                  |
| [Use this food in ingredient row]                |
+--------------------------------------------------+
```

### Non-resolved states (held `id`, status retrievable)

```
| Status: Pending ⏳    → assembling across sources; [Check status]        |
| Status: Needs review ❔→ multiple candidates; [Choose match →]            |
|                         (see candidate-resolution.md)                     |
| Status: Not found ⚠️  → no source has this food (tombstone)              |
| Status: Failed ❌     → a source errored after retries; [Retry] later     |
```

## Notes

- The detail view shows a **golden record** keyed by an internal `id` and assembled/merged across
  one or more sources. Each nutrient and each scalar identity field shows **its own provenance** —
  the specific source that value came from — backed by `food_nutrients.source_id` (multi-valued) and
  `food_field_provenance(food_id, field, source_id)` (scalars). There is **no** single "data
  source" line and **no** source-native key (no `fdcId`).
- Different fields may come from different sources: per the merge rules, presence beats absence,
  identity/short fields take the **higher-priority source**, and conflicting nutrients take the
  higher-priority source after normalization to per-100g. The table makes this visible per row.
- A value the **user** chose during candidate resolution (US-2a) is shown as provenance "you" and is
  preserved by the change-driven refresh (US-7) unless its originating source item changes upstream.
- The **branded/generic** badge is retained. Branded foods show the brand; generic foods show "—".
- Lifecycle `status` is always retrievable for a held `id` (FR-007) — `PENDING` / `UNRESOLVED`
  return `202`, `RESOLVED` returns `200`, `NOT_FOUND` / `FAILED` return `404` with status visible.
- USDA, when it contributed a value, appears as one generic source label — never as "the database".
