# Wireframe: Candidate Resolution (Disambiguate UNRESOLVED Food)

**Branch**: `003-usda-food-data` | **Date**: 2026-06-22
**Status**: New screen — introduced by the source-agnostic re-baseline (2026-06-22).
**FRs**: US-2a (disambiguate candidates and resolve), FR-018 (candidate set), `GET /v1/foods/{id}/candidates`, `PATCH /v1/foods/{id}`

---

## Context

When add-by-name (US-2) finds **multiple candidates across sources** that the system cannot
confidently collapse into one golden record, the food becomes **`UNRESOLVED`**. A human is the
final arbiter: the user fetches the candidate list, picks the candidate(s) that match what they
meant, and submits. The system validates each pick belongs to **this food's own candidate set**,
merges it into the golden record, and moves the food to **`RESOLVED`**.

This is reached from any `[Review ❔]` / `[Choose match →]` affordance (food search, ingredient
picker, polling status).

---

## ASCII Wireframe

```
+--------------------------------------------------------------------------+
| Which "plantain" did you mean?                          [✕ Close]         |
+--------------------------------------------------------------------------+
| We found several possible matches across our sources. Pick the one that    |
| best matches the food you're adding. Your choice is saved and respected.   |
|                                                                            |
| +--------------------------------------------------------------------+    |
| | ( ) Plantains, raw                                     [Generic]   |    |
| |     122 kcal | P 1.3g | C 32g | F 0.4g  (per 100g)                |    |
| |     Found in: Source A                              [View detail]  |    |
| +--------------------------------------------------------------------+    |
| | ( ) Plantains, yellow, fried                           [Generic]   |    |
| |     309 kcal | P 1.5g | C 48g | F 11g   (per 100g)               |    |
| |     Found in: Source A                              [View detail]  |    |
| +--------------------------------------------------------------------+    |
| | ( ) Sweet Plantain Chips                  [Branded: SnackCo]      |    |
| |     519 kcal | P 2g | C 64g | F 28g     (per 100g)               |    |
| |     Found in: Source B                              [View detail]  |    |
| +--------------------------------------------------------------------+    |
|                                                                            |
|  None of these match?  [Edit name & search again]                          |
|                                                                            |
|                                   [Cancel]     [Use selected match →]      |
+--------------------------------------------------------------------------+
```

### After resolve (food → RESOLVED)

```
+--------------------------------------------------------------------------+
| ✅ Resolved — "Plantains, raw"                                            |
| Golden record assembled from your pick. Now selectable as an ingredient.  |
|                                                   [View detail] [Done]     |
+--------------------------------------------------------------------------+
```

### Rejected pick (candidate not in this food's set)

```
+--------------------------------------------------------------------------+
| ⚠️ That option is no longer available for this food.                      |
| The candidate list may have refreshed. Reloading choices...               |
|                                                            [Reload]        |
+--------------------------------------------------------------------------+
```

## Flow

```
  UNRESOLVED food
        │
        ▼
  GET /v1/foods/{id}/candidates   → list of candidates (each carries its
        │                            source + that source's item key, used
        ▼                            internally; the source name is shown
  user picks a candidate            generically, the key is not surfaced)
        │
        ▼
  PATCH /v1/foods/{id} { candidate selection }
        │
        ├─ valid (belongs to this food's set) → merge → status = RESOLVED
        └─ invalid (not in this food's set)   → 400/409, status unchanged
```

## Notes

- The candidate list comes from `GET /v1/foods/{id}/candidates`; each candidate carries **which
  source it came from** and that source's item key. The UI shows the source **generically**
  ("Found in: Source A") and a comparable nutrition preview normalized to per-100g — it does **not**
  surface any source-native id (no `fdcId`).
- Submitting calls `PATCH /v1/foods/{id}` with the chosen candidate. The system **validates the
  candidate belongs to this food's own candidate set** before merging; a pick that doesn't belong is
  rejected (`400`/`409`) and the food's `status` is unchanged (US-2a scenario 3).
- The user's manual pick is stored as **ordinary per-field provenance** — once chosen, it's just a
  stored value. The change-driven refresh (US-7) will only ever move it if the originating source
  item changes upstream, so the human decision is automatically protected.
- "None of these match?" lets the user re-name and re-search rather than forcing a wrong pick.
- USDA, if present, appears as one generic source among the candidates — never as "the" source.
- See also: `ingredient-picker.md` (entry point), `food-detail.md` (per-field provenance of the
  resulting golden record).
