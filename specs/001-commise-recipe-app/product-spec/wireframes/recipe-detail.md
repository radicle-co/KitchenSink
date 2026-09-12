# Wireframe: Recipe Detail (Mobile)

**Branch**: `001-commise-recipe-app` | **Date**: 2026-05-09
**FRs**: [FR-001](../../spec.md#fr-001), [FR-007](../../spec.md#fr-007), [FR-007a](../../spec.md#fr-007a), [FR-007b](../../spec.md#fr-007b), [FR-003](../../spec.md#fr-003), [FR-044](../../spec.md#fr-044)

---

## ASCII Wireframe

```
+--------------------------------------------------+
|  [< Back]     Grandma's Pasta       [Edit] [More]|  <- FR-002 (owner sees Edit)
+--------------------------------------------------+
|                                                  |
|  +------------------------------------------+   |
|  |                                          |   |
|  |     [ HERO PHOTO 1 of 3 ]                |   |  <- FR-001: photos (max 10)
|  |                                          |   |
|  |     <  [photo 2]  [photo 3]  >           |   |
|  |                                          |   |
|  +------------------------------------------+   |
|                                                  |
|  [Italian] [pasta] [family recipes]             |  <- FR-001: tags/categories
|                                                  |
|  Serves: 4  |  Prep: 15m  |  Cook: 30m          |  <- FR-001: times, servings
|  Total: 45 min                                  |
|                                                  |
|  +-- Nutrition (per serving) -----------------+ |
|  |  420 cal  |  18g protein  |  62g carbs  | 12g fat |  |  <- FR-007, FR-007a
|  +------------------------------------------+   |
|  Note: Nutrition includes USDA database items.   |  <- FR-007a: user-entered flag
|  User-entered ingredients marked with (*).      |
|                                                  |
|  +-- Ingredients (12) -------------------------+ |
|  |                                            |   |
|  |  [ ]  200g  Pasta (Barilla, penne)        |   |  <- FR-001, FR-007
|  |  [ ]  150g  Chicken breast, diced         |   |     real food DB backing
|  |  [ ]  2 tbsp  Olive oil                   |   |
|  |  [ ]  4 cloves  Garlic, minced           |   |
|  |  [ ]  1 cup   Cherry tomatoes           |   |
|  |  [ ]  100g   Kale, chopped               |   |  <- (* user-entered) notice
|  |  [ ]  50g    Parmesan, grated (user-entered*) |  <- FR-007a: flagged
|  |  [ ]  1 tsp   Salt                      |   |
|  |  [ ]  1/2 tsp  Black pepper             |   |
|  |                                            |   |
|  +------------------------------------------+   |
|                                                  |
|  +-- Instructions (5 steps) -------------------+ |
|  |  STEP 1                                    |   |  <- FR-001: step-by-step
|  |  Bring a large pot of salted water to     |   |
|  |  boil. Cook pasta per package directions.  |   |
|  |                                            |   |
|  |  STEP 2                                    |   |
|  |  While pasta cooks, heat olive oil in a   |   |
|  |  large skillet over medium-high heat...    |   |
|  |                                            |   |
|  +------------------------------------------+   |
|                                                  |
|  +------------------------------------------+   |
|  |  [Clone to My Recipes]    [v12] [Public]  |   |  <- FR-005, FR-007b, FR-003
|  +------------------------------------------+   |
|                                                  |
+--------------------------------------------------+
|  [Recipes]    [Collections]    [Meal Plan]       |  <- FR-044: bottom nav
+--------------------------------------------------+
```

## Layout Notes

| Zone                | Description                                                                     |
| ------------------- | ------------------------------------------------------------------------------- |
| Back button         | Returns to recipe list                                                          |
| Edit button         | Shown only to recipe owner; navigates to recipe-edit.md                         |
| Hero photo carousel | Swipeable; dots indicator; photos link to full-screen lightbox                  |
| Tags                | Tappable chips for filtering (FR-001)                                           |
| Nutrition panel     | Per-serving values from USDA-backed ingredients; user-entered flagged (FR-007a) |
| Ingredients list    | Checkbox for tracking; quantity + unit + name + source badge                    |
| Instructions        | Numbered steps; checkbox per step for cooking progress                          |
| Footer bar          | Clone CTA (public recipes only); version badge; visibility badge                |
| Bottom nav          | Same as recipe-list.md                                                          |

## Refresh Failure State

- **When:** a focus/reconnect refresh fails while the recipe is on screen.
- **Shown:** the recipe stays, and an inline notice below the title band reads "We couldn’t refresh this recipe." with **Try again**. A load that failed with nothing to show is the not-found or load-error state instead.
- **Behaviour:** the notice announces politely, keeps its button (busy) while any retry runs, and clears on the next successful refresh. When its own Try again succeeds, focus moves to the recipe title.
- **Authority:** `docs/CODING_STANDARDS.md` §11.0.

## FR Annotation Summary

| Element                        | FR              |
| ------------------------------ | --------------- |
| Hero photo carousel (max 10)   | FR-001          |
| Tags and categories            | FR-001          |
| Prep/cook/total time, servings | FR-001          |
| Nutrition panel (per serving)  | FR-007, FR-007a |
| User-entered ingredient flag   | FR-007a         |
| Ingredient list (with food DB) | FR-007, FR-007a |
| Step-by-step instructions      | FR-001          |
| Clone button                   | FR-005          |
| Version badge                  | FR-007b         |
| Visibility badge               | FR-003          |
| Bottom nav                     | FR-044          |
