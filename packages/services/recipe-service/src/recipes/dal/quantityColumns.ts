/**
 * THE ONE MAPPING between the `IngredientQuantity` value object and the two `numeric(10,3)` columns that
 * store it (U8 / R36 / R40 / R41).
 *
 * DESIGN PATTERN: Adapter — a pure, two-way translation across the persistence boundary, with the value
 * object's own smart constructor ({@link statedQuantity}) as the gate on the way IN, so a row can never
 * produce a quantity the domain would refuse to build.
 *
 * ## Why this is a module and not five inline expressions
 *
 * Before U8 the read side was literally `quantity: Number(row.quantity)`, written out separately at six
 * call sites in `recipes.service.ts` (the wire projection, the clone projection, the nutrition measure, the
 * version snapshot, the substantive-edit comparison, and the update path). Once the column became nullable
 * every one of those became `Number(null) === 0` — a silent, uniform "this line calls for zero of it".
 * Six independent fixes is six chances to miss one, and nothing would have failed to compile.
 *
 * ## `pg` hands back a STRING, and that is not incidental
 *
 * `numeric` is arbitrary-precision, so node-postgres deliberately does not parse it into an IEEE-754
 * double. It arrives as `'2.000'` — the value at the column's scale — and the write side must hand back a
 * string for the same reason. Both facts are contained here.
 */
import { statedQuantity, ABSENT_QUANTITY, type IngredientQuantity, type StatedMeasure } from '@kitchensink/recipe-core';

/** The two `recipe_ingredients` columns that together hold one quantity, as drizzle spells them. */
export interface QuantityColumns {
    /** `quantity numeric(10,3)` — the stated amount, or the LOWER bound of a range. `null` when absent. */
    readonly quantity: string | null;
    /** `quantity_high numeric(10,3)` — the UPPER bound of a range. `null` for an exact or absent quantity. */
    readonly quantityHigh: string | null;
}

/**
 * Spread a quantity across its two columns. Pure.
 *
 * @param quantity - The stated quantity.
 * @returns The column values to write. An absent quantity writes `null` to BOTH columns — ⛔ never `'0'`,
 *   which the database's own checks would happily accept and which would reintroduce the zero-means-absent
 *   confusion the value object exists to remove.
 */
export function quantityColumns(quantity: IngredientQuantity): QuantityColumns {
    switch (quantity.kind) {
        case 'exact':
            return { quantity: quantity.value.toString(), quantityHigh: null };
        case 'range':
            return { quantity: quantity.low.toString(), quantityHigh: quantity.high.toString() };
        case 'absent':
            return { quantity: null, quantityHigh: null };
    }
}

/**
 * Read a persisted row's two columns back as a quantity. Pure.
 *
 * ⚠️ FAILS SAFE RATHER THAN THROWING. `recipe_ingredients_quantity_coherent` is declared `NOT VALID`: it
 * polices every write from migration 0020 onward, but it was never verified against the rows that already
 * existed, and nothing stops a hand-run `UPDATE` or a restore from an older dump. A row that spells a state
 * the domain has no reading for is therefore reported as `absent` — the honest answer ("no amount can be
 * read from this row") — rather than throwing a 500 on a GET, or promoting a stray upper bound to the
 * stated amount and showing a cook a number their recipe never contained.
 *
 * @param columns - The row's `quantity` / `quantityHigh` values as `pg` surfaces them (strings or `null`).
 * @returns The quantity, or {@link ABSENT_QUANTITY} when the pair states no readable amount.
 */
export function quantityFromColumns(columns: QuantityColumns): IngredientQuantity {
    if (columns.quantity === null) {
        return ABSENT_QUANTITY;
    }

    const low = Number(columns.quantity);
    const high = columns.quantityHigh === null ? null : Number(columns.quantityHigh);

    return statedQuantity(low, high) ?? ABSENT_QUANTITY;
}

/**
 * The three `recipe_ingredients` columns holding what the SOURCE printed, before a historical measure was
 * restated (migration 0027).
 */
export interface StatedMeasureColumns {
    /** `stated_quantity numeric(10,3)` — the printed amount, or the LOWER bound of a printed range. */
    readonly statedQuantity: string | null;
    /** `stated_quantity_high numeric(10,3)` — the UPPER bound of a printed range. */
    readonly statedQuantityHigh: string | null;
    /** `stated_unit text` — the unit the source printed (`gill`). `NULL`, never `''`. */
    readonly statedUnit: string | null;
}

/**
 * Spread a stated measure across its three columns. Pure.
 *
 * ⛔ ALL THREE are written on every line, `null` included. A partial write would leave a previous line's
 * `stated_unit` attached to an amount nobody restated — a restatement claim with no restatement behind it,
 * which is the disclosure defect R35 exists to prevent arriving through the persistence layer.
 *
 * @param measure - What the source printed, or `undefined` for the dominant case: a line whose `quantity`
 *   and `unit` ARE what the source said.
 * @returns The column values to write.
 */
export function statedMeasureColumns(measure: StatedMeasure | undefined): StatedMeasureColumns {
    if (measure === undefined) {
        return { statedQuantity: null, statedQuantityHigh: null, statedUnit: null };
    }

    // ⛔ Through the SAME quantity adapter, never a local `.toString()` pair: the stated bounds land in
    // columns of the same type and scale as the restated ones, so one spelling of "a quantity as columns"
    // must cover both or the two halves of one conversion can round differently.
    const { quantity, quantityHigh } = quantityColumns(measure.quantity);

    return { statedQuantity: quantity, statedQuantityHigh: quantityHigh, statedUnit: measure.unit };
}

/**
 * Read a persisted row's three stated columns back as a measure. Pure.
 *
 * ⚠️ FAILS SAFE, for the same reason {@link quantityFromColumns} does and then one more.
 * `recipe_ingredients_stated_measure_coherent` is declared `NOT VALID`: it polices every write from
 * migration 0027 onward, but it was never verified against the rows that already existed, and nothing stops
 * a hand-run `UPDATE` or a restore from an older dump. A row spelling HALF a restatement — a unit with no
 * amount, an amount with no unit, an upper bound with no lower — is reported as "no stated measure" rather
 * than as half a claim, because half a claim is what would reach the verification gate and be asked about.
 *
 * ⛔ A BLANK unit reads as absent too. `recipe_ingredients.unit` spells "unitless" as `''`, and a
 * restatement is never FROM nothing; `trim()` rather than `=== ''` for the reason `verifiedLineIdentity`'s
 * `unitOf` states — a single space passes a `min(1)` wire bound and is persisted verbatim.
 *
 * @param columns - The row's three stated values as `pg` surfaces them (strings or `null`).
 * @returns The stated measure, or `undefined` when the row states none — or states one incoherently.
 */
export function statedMeasureFromColumns(columns: StatedMeasureColumns): StatedMeasure | undefined {
    const unit = columns.statedUnit;

    if (unit === null || unit.trim() === '') {
        return undefined;
    }

    const quantity = quantityFromColumns({
        quantity: columns.statedQuantity,
        quantityHigh: columns.statedQuantityHigh,
    });

    // ⛔ `absent` is not a stated measure: there is nothing that was restated. It is also how the quantity
    // adapter reports an unreadable or incoherent pair, so this one branch covers both.
    return quantity.kind === 'absent' ? undefined : { quantity, unit };
}
