# Wireframe: Nutrition Panel (Recipe Context)

**Branch**: `003-usda-food-data` | **Date**: 2026-05-09
**Updated**: 2026-06-22 — re-baselined to the source-agnostic food data model (per-ingredient values come from golden records with **per-field source provenance**; ingredients identified by internal `id`, not `fdcId`; lifecycle uses PENDING/UNRESOLVED/RESOLVED/NOT_FOUND/FAILED).
**FRs**: FR-002, FR-028 (golden record + per-field provenance), SC-008 (nutrient fidelity), US-7 (change-driven refresh)

---

## ASCII Wireframe

```
+--------------------------------------------------------------------------+
| Nutrition Panel                                                            |
+--------------------------------------------------------------------------+
| Serving basis: [per 100g ▼] [per serving ▼]                               |
|                                                                            |
| Total (resolved ingredients only):                                         |
| Calories  412 kcal   Protein  26g   Carbs  34g   Fat  18g                |
|                                                                            |
| Ingredient contribution                                                    |
| - Chicken breast (Generic):  120 kcal / 100g   [Resolved ✅]              |
| - Olive oil (Generic):       884 kcal / 100g   [Resolved ✅]              |
| - Gochujang:                 —                  [Pending ⏳] (not included) |
| - Plantain:                  —                  [Review ❔]  (choose match) |
|                                                                            |
| ⓘ Values come from golden records; each field carries its source.         |
|   Tap an ingredient to see per-field provenance (see food-detail.md).     |
|                                                                            |
| Status legend:                                                             |
| [Resolved ✅] [Pending ⏳] [Needs review ❔] [Not found ⚠️] [Failed ❌]      |
+--------------------------------------------------------------------------+
```

## Notes

- Each ingredient's contribution is read from its **golden-record food** (by internal `id`), whose
  values are normalized to per-100g and each carry **per-field provenance** (which source supplied
  the value). The panel surfaces the rolled-up totals; the per-field source breakdown lives on the
  food detail screen (`food-detail.md`).
- Only `RESOLVED` ingredients count toward the totals. `PENDING` and `UNRESOLVED` ("needs review")
  ingredients are listed but excluded until they resolve; `NOT_FOUND` and `FAILED` contribute no
  nutrition. A `[Review ❔]` ingredient links to Candidate Resolution (`candidate-resolution.md`).
- Stored golden-record values are served as-is (no ingest-time transformation beyond the adapter's
  per-100g normalization), preserving fidelity against source values (SC-008). Change-driven refresh
  (US-7) updates a field only when its originating source item changes upstream.
- Unit-display controls are UX aids; explicit unit conversion remains warning-tracked.
- USDA, where it supplied a value, is one generic source among many — never named as "the" source.
