# Wireframe: Collection View (Web)

**Branch**: `001-commise-recipe-app` | **Date**: 2026-05-09
**FRs**: [FR-008](../../spec.md#fr-008), [FR-009](../../spec.md#fr-009), [FR-010](../../spec.md#fr-010), [FR-011](../../spec.md#fr-011), [FR-044](../../spec.md#fr-044)

---

## ASCII Wireframe

```
+--------------------------------------------------------------------------+
|  Commise                                          [Morgan ▼] [Settings]|
+--------------------------------------------------------------------------+
|                                                                          |
|  [< Back to My Collections]                                             |
|                                                                          |
|  +------------------------------------------+  +-----------------------+ |
|  |  [EDIT]   Keto Week                      |  |  COLLECTION ACTIONS   | |  <- FR-008
|  |  [DELETE]                                 |  |                       | |
|  +------------------------------------------+  |  [+ Add Recipes]       | |  <- FR-009
|                                               |  [Pull Updates from     | |
|  [icon: folder]  Public  |  8 recipes        |  |   Source]             | |  <- FR-011
|  Source: @mealplan_clara's "Keto Staples"   |  |  [Clone Collection]   | |  <- FR-011
|  Last pulled: 2026-05-01                    |  |                       | |
|  +------------------------------------------+  |  Visibility:          | |
|  |  [ ]  [x]  Recipe title                |  |  [ ( Public  ) Private ] | |  <- FR-010
|  |           Chicken Alfredo             |  |  |  (premium only)       | |
|  |           by @alexk  |  v3  |  Private |  |                       | |
|  |           520 cal                      |  |  [ Save changes ]      | |
|  +------------------------------------------+  +-----------------------+ |
|                                               |                       |
|  +------------------------------------------+  |  CLONE INFO (if cloned)
|  |  [ ]  [x]  Recipe title                |  |  |  Source collection:   | |
|  |           Bacon & Egg Cups             |  |  |  @mealplan_clara /    | |
|  |           by @chefmark  |  v1  |  Public|  |  |  Keto Staples         | |
|  |           310 cal                      |  |  |  Cloned: 2026-04-28  | |
|  +------------------------------------------+  |  [View Source]        | |
|                                               |                       | |
|  +------------------------------------------+  +-----------------------+ |
|  |  [x]       Recipe title                |  |
|  |            Avocado Toast                |  |  Note: Checkbox [x] marks   |
|  |            by @you  |  v7  |  Private  |  |  recipes added directly     |
|  |            290 cal                      |  |  by you (never overwritten |
|  +------------------------------------------+  |  by Pull Updates)          |
|                                               |  Checkbox [ ] = from source|
|  +------------------------------------------+  |
|  |  [ ]  [x]  Recipe title                |  |
|  |            Cauliflower Fried Rice       |  |
|  |            by @mealplan_clara | v2 | Pub|  |
|  |            220 cal                      |  |  <- From source collection
|  +------------------------------------------+  |  (will sync on Pull)       |
|                                               |
|  [ Load more (4 more) ]                       |
|                                               |
+--------------------------------------------------------------------------+
```

## Layout Notes

| Zone                    | Description                                                                                                                                                                   |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Collection header       | Name (editable), edit/delete actions; visibility badge; source attribution if cloned                                                                                          |
| Recipe list             | Row indicates recipe source: added by owner (protected from Pull) vs. from source (will sync) — shipped as a text label, not the `[x]`/`[ ] ` checkbox glyph below (see note) |
| Right sidebar           | Actions: Add Recipes, Pull Updates, Clone; Visibility toggle (FR-010); Clone info panel                                                                                       |
| Pull Updates action     | Available only on cloned collections; shows preview before executing (FR-011)                                                                                                 |
| Clone Collection action | Creates a new snapshot clone; new collection has its own sourceCollectionId                                                                                                   |
| Visibility toggle       | Public by default; Private option only for premium users (FR-010)                                                                                                             |

**Reconciled (C7):** the `[x]`/`[ ]` checkbox glyph above is a wireframe shorthand for a **read-only source
indicator**, not a selection control — nothing on this row is user-togglable. The shipped
`CollectionMemberRow` (`features/recipes/src/collections/CollectionMemberRow.tsx`/`.native.tsx`) intentionally
renders it as a visible TEXT label ("Added by you" / "From source collection", `detail.sourceIndicatorOwned` /
`detail.sourceIndicatorFromSource`) instead of a checkbox: a real checkbox affords toggling, which would be
actively misleading for a value the user cannot change, and WCAG 1.4.1 requires this status not be conveyed by
shape/checked-state alone. The text label is strictly clearer than the glyph it replaces and is kept as-built.

## Pull Updates Preview Dialog (FR-011)

```
+--------------------------------------------------------------------------+
|  Pull Updates from Source Collection                                     |
|  @mealplan_clara / Keto Staples                                        |
+--------------------------------------------------------------------------+
|                                                                          |
|  2 new public recipes will be added:                                    |
|  +------------------------------------------+                           |
|  |  [ ]  Keto Almond Butter Cookies         |  <- pre-checked           |
|  |  [ ]  Zucchini Noodle Bowl                |  <- pre-checked           |
|  +------------------------------------------+                           |
|                                                                          |
|  0 recipes removed from source (nothing to reconcile)                  |
|                                                                          |
|  3 recipes from source already in this collection (no changes)        |
|                                                                          |
|  Note: Recipes you added directly will not be overwritten.            |
|                                                                          |
|  [Cancel]    [Pull 2 Recipes]                                          |
|                                                                          |
+--------------------------------------------------------------------------+
```

## FR Annotation Summary

| Element                                                 | FR            |
| ------------------------------------------------------- | ------------- |
| Collection name (edit/rename)                           | FR-008        |
| Delete collection                                       | FR-008        |
| Recipe membership list                                  | FR-009        |
| Add recipes to collection                               | FR-009        |
| Remove recipes from collection                          | FR-009        |
| Visibility toggle (public/private)                      | FR-010        |
| Premium-only private toggle                             | FR-010, C-004 |
| Pull Updates from source                                | FR-011        |
| Pull preview dialog                                     | FR-011        |
| Source attribution on cloned collection                 | FR-011        |
| Clone collection action                                 | FR-011        |
| Recipe source indicator (checkbox state)                | FR-011        |
| No-cascade-delete (recipes survive collection deletion) | FR-012        |
| Web layout                                              | FR-044        |
