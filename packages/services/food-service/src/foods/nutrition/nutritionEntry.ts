/**
 * ONE authoritative answer to "what does a nutrition entry say about a food" — shared by the edge-cached
 * `GET /api/v1/foods/nutrition` and the per-caller `GET /api/v1/foods/authored-nutrition`.
 *
 * ## Why it is a module rather than two inline blocks
 *
 * This projection existed twice, ~25 near-identical lines inside each batch method. That was tolerable while
 * both said the same thing, and stopped being tolerable the moment one of them had to WITHHOLD: two copies
 * of a rule mean the withholding can be added to one and forgotten in the other — and the one most easily
 * forgotten is the shared batch, whose responses CloudFront caches on the URL alone (ADR-0020).
 *
 * ## ⛔ The withholding rule (owner ruling 6, 2026-09-07)
 *
 * A `WITHDRAWN` food reports its status and no numbers: no macros, no portions. The accepted consequence is
 * recorded rather than discovered — **a recipe's nutrition total changes on the day a food is withdrawn**:
 * the line stops counting and the recipe's figure reports incomplete. That is exactly what the recipe-side
 * treatment explains to the cook. The retained row buys the FACT and the DATE, not the figures.
 *
 * ⛔ **The entry is RETURNED, never omitted.** Dropping the food would put its id in `unknownIds`, which
 * already carries two meanings ("no such row", and — on the authored batch, which is caller-scoped — "an id
 * you do not own"). Folding a third, perfectly distinguishable fact into that bucket would destroy the only
 * channel recipe-service has for learning a food was withdrawn. Absence is not dissent (ADR-0026 §3), one
 * service over.
 *
 * ⛔ **Portions are withheld with the macros.** A portion (`"1 cup" = 240 g`) is a nutritional statement
 * about the substance; returning them while withholding macros would let a caller convert the line to grams
 * for a food we are declining to describe. Nothing a cook reads is lost — a recipe line's own quantity and
 * unit come from `recipe_ingredients`, never from here.
 *
 * ⛔ **`DELETING` is refused, not mapped.** It is store-internal, and it is not a synonym for withdrawn: it
 * reverts to `RESOLVED` when an erasure keeps a referenced food as an orphan, so publishing it as a removal
 * would assert a terminal fact about a state that is about to un-happen. Callers filter it before calling
 * here; this throws rather than guessing, which is the same posture `publishableStatusOf` takes.
 *
 * DESIGN PATTERN: Pure projection — total over its input, table-testable, and unaware of Nest, the DAO and
 * HTTP.
 */
import type { NutritionRecord } from '../dao/food.dao.js';
import type { FoodNutrition } from '../foods.schema.js';
import { projectNutrition } from './nutrientSelection.js';
import { normalizePortions } from './portionNormalization.js';

/**
 * Project one stored record into its wire entry, applying the withdrawal rule.
 *
 * @param id - The REQUESTED id, which is what the entry reports. Callers iterate the requested ids and look
 *   the record up, because a batched `WHERE id = ANY(…)` promises no row order and the response order is
 *   part of what the edge caches under the canonical URL.
 * @param record - The stored golden-record slice for that id.
 * @returns The entry to publish: status always, macros and portions only when the food is not withdrawn.
 * @throws When the record is `DELETING`, which no caller may publish. Pure.
 */
export function nutritionEntryFor(id: string, record: NutritionRecord): FoodNutrition {
    if (record.status === 'DELETING') {
        throw new Error('DELETING is store-internal and must not reach the wire (U18)');
    }

    if (record.status === 'WITHDRAWN') {
        // ⛔ The macro keys are ABSENT, not present-and-undefined. Every macro is `.optional()` on the wire
        // and absence there already means "no nutrient row qualified"; emitting the keys with undefined
        // values would serialize differently and invite a client to branch on the difference.
        return { id, status: record.status, portions: [] };
    }

    return {
        id,
        status: record.status,
        // Mapped at the seam rather than widening the projection's input type. Stored amounts are STRINGS on
        // purpose (arbitrary precision, no float drift — SC-008); the projection works in numbers because
        // the wire contract does, and this is the one place that conversion happens.
        ...projectNutrition(
            record.nutrients.map((nutrient) => ({
                nutrient: nutrient.nutrient,
                amount: Number(nutrient.amount),
                unit: nutrient.unit,
                basis: nutrient.basis,
            })),
        ),
        portions: normalizePortions(
            record.portions.map((portion) => ({
                label: portion.label,
                gramWeight: Number(portion.gramWeight),
            })),
        ),
    };
}
