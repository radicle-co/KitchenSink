-- 0009_ingredient_portions.sql (#11) — household-measure portions for nutrition scaling.
--
-- Per-serving nutrition (#9) scales a catalog ingredient's per-100g values by the line's mass. That works
-- for mass units (g/kg/oz/lb) but not for volumetric/count units (cup/tbsp/clove), whose gram weight is
-- ingredient-specific. The food service supplies those weights (`FoodView.portions[].gramWeight`); this
-- column stores them, normalized to grams-per-unit (`[{ "unit": "cup", "gramsPerUnit": 125 }]`), captured
-- when a food resolves. NULL until resolved / when the food supplies no usable portions.

ALTER TABLE "ingredients" ADD COLUMN "portions" jsonb;
