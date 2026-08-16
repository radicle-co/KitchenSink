-- 0006: `food_nutrient_view` — the nutrient/dictionary JOIN, named once so a batch can read it in ONE query.
--
-- Additive, hand-authored, applied after 0005 by the in-VPC migration runner (FU-MIGRATE) and by the test
-- harness (tests/support/db.ts applies every *.sql in lexical order). The Drizzle mirror lives in
-- src/db/schema/foodNutrientView.ts.
--
-- ## What it is for
--
-- `GET /api/v1/foods/nutrition` used to answer N ids by calling `readGoldenRecord` N times, and each of
-- those runs 1 + 4 statements: a 100-id request — one per recipe-list render — was ~500 round trips. The
-- batched read is 3 statements (statuses, nutrients, portions), and this view is what lets the nutrient one
-- express `food_nutrients JOIN nutrient` without restating the join at the call site. No index is added:
-- `food_nutrients_food_id_idx` and `food_portions_food_id_idx` already cover `food_id = ANY($1)`.
--
-- ## ⛔ It carries `basis` THROUGH, and it decides NOTHING
--
-- No name matching, no unit matching, no FILTER, no CASE, no WHERE. The column-shaped alternative —
--   max(amount) FILTER (WHERE n.name = 'Energy' AND n.unit = 'kcal') AS calories_per_100g
-- — would hard-code LABEL_NUTRIENT_MAP into SQL, giving a business rule a SECOND authority that is free to
-- drift from the first. That rule is precisely the one that distinguishes the kcal row from the kJ row
-- carrying the same name and a 4.184x larger number, and a divergence renders as a plausible calorie count
-- with nothing looking wrong. It would also have to re-express the U+00B5 / U+03BC micro-sign fold in SQL.
-- 100% of selection stays in `selectPer100g` (src/foods/nutrition/nutrientSelection.ts). This view names an
-- access path.
--
-- ## ⛔ NOT materialized, deliberately
--
-- Food's writer is user-triggered and latency-visible: a user adds an ingredient, food answers 202, the USDA
-- fetch fills it in, and the user is polling. A materialized view would report no nutrition for the food
-- that was just resolved — breaking exactly the moment that matters. Do not "optimize" it into one.
-- Implements: FR-028 KTD-3.

CREATE VIEW food_nutrient_view AS
SELECT fn.food_id, n.name AS nutrient, n.unit, fn.basis, fn.amount
FROM food_nutrients fn
JOIN nutrient n ON n.id = fn.nutrient_id;
