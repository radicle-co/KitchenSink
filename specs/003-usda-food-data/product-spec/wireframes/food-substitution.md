# Wireframe: Food Substitution (Disambiguation Helper)

**Branch**: `003-usda-food-data` | **Date**: 2026-05-09
**Updated**: 2026-06-22 — re-baselined to the source-agnostic food data model (substitutes compared over golden records keyed by internal `id`; no `fdcId`; lifecycle uses PENDING/UNRESOLVED/RESOLVED/NOT_FOUND/FAILED).
**FRs**: FR-008 (local search), FR-010 (relevance), FR-033 (polling) — warning-tracked: no standalone substitution FR

---

## ASCII Wireframe

```
+--------------------------------------------------------------------------+
| Choose a Better Match for Ingredient: "milk"                              |
+--------------------------------------------------------------------------+
| Current selection                                                         |
| [x] Whole milk (Generic)            | 61 kcal/100g | golden record       |
|                                                                          |
| Suggested alternatives (local results)                                   |
| [ ] Milk, low fat 1% (Generic)      | 42 kcal/100g | golden record       |
| [ ] Milk, nonfat (Generic)           | 34 kcal/100g | golden record       |
| [ ] Almond milk, unsweetened (Branded: Example Foods)                    |
| |                                    | 13 kcal/100g | golden record       |
|                                                                          |
| Comparison is over assembled golden records (values normalized per-100g; |
| each field carries its own source — tap a row to see provenance).        |
|                                                                          |
| [Preview nutrition impact] [Apply substitution] [Cancel]                 |
|                                                                          |
| If a chosen alternative isn't resolved yet:                              |
| [Pending ⏳] poll status · [Review ❔] choose match · [Not found ⚠️]       |
+--------------------------------------------------------------------------+
```

## Notes

- Alternatives are golden-record foods from the **local store**, found via local search/ranking
  (FR-008, FR-010) and identified by internal `id`. No source-native key is shown (no `fdcId`).
- The comparison is **source-agnostic**: each alternative's nutrition is its merged golden record,
  normalized to per-100g, with **per-field provenance** available on the food detail screen
  (`food-detail.md`). Substitution swaps which golden-record `id` the ingredient links to.
- The **branded/generic** badge is retained to aid the choice.
- If a chosen alternative was just added by name and isn't `RESOLVED`, its lifecycle status is shown
  inline — `PENDING` (poll via FR-033), `UNRESOLVED` (route to Candidate Resolution,
  `candidate-resolution.md`), or `NOT_FOUND` / `FAILED`.
- USDA, where it backed a value, is one generic source among many — never named as "the" source.
- No standalone substitution FR exists; this screen is documented as a UX helper and tracked as a
  warning-level gap for explicit requirement promotion.
