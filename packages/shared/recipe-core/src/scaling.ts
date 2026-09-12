/**
 * DISPLAY-ONLY recipe scaling: re-express a stored recipe for a serving count the cook chooses. Pure — no
 * I/O, no mutation, and deliberately no write path. The stored recipe is never touched, and nothing here
 * reaches the wire.
 *
 * ## The model, stated explicitly, because "scale everything" is WRONG
 *
 * The scale is an ABSOLUTE serving count (`servings`), not an abstract multiplier, so the control can
 * default to — and return to — the count the author created the recipe with. The ratio `r` it implies is
 * then applied ONLY where the underlying quantity is genuinely proportional to batch size:
 *
 * | Field                  | Scales? | Why                                                                   |
 * | ---------------------- | ------- | --------------------------------------------------------------------- |
 * | ingredient `quantity`  | YES     | Mass/volume of an ingredient is linear in yield. Uncontroversial.      |
 * | `prepTimeMinutes`      | YES     | Hands-on work: twice the onions is about twice the chopping.           |
 * | `cookTimeMinutes`      | **NO**  | Thermal, not proportional — see below.                                 |
 * | step `timerSeconds`    | **NO**  | Process durations (simmer 10 min, rest 5 min) are batch-independent.   |
 * | `totalTimeMinutes`     | DERIVED | Rebuilt from the prep delta, so inactive time survives.                 |
 * | per-serving nutrition  | **NO**  | Mathematically invariant — see below.                                  |
 *
 * **Why cook time does not scale.** Heat enters food through its surface, and the time to bring a mass to
 * temperature is governed by its characteristic thickness, not its weight: doubling a casserole spreads it
 * wider or deeper, adding a fraction of its bake time, never doubling it — and doubling a pot of simmering
 * stock adds essentially nothing. The asymmetry of being wrong is what settles it: an over-stated PREP
 * estimate costs a cook some scheduling slack, while an under-stated COOK time produces undercooked food,
 * which is a safety failure. So the direction with a safety consequence is left alone and disclosed
 * (`RecipeScaling.isScaled` drives that disclosure) rather than guessed at.
 *
 * **Why per-serving nutrition is untouched.** Scaling multiplies the ingredient mass AND the serving count
 * by the same `r`, so `total(r) / (servings * r)` is the original per-serving figure. Recomputing it under
 * scaling could only introduce a double-count. Asserted in `__tests__/scaling.test.ts`.
 *
 * This deliberately DIVERGES from the unmerged `008-cooking-mode` design (a 0.5/1/2/3 multiplier scoped to
 * Cooking Mode, which by its D-002 scales no timing at all). The divergence is the owner's call; the
 * safety half of D-002's reasoning is preserved here, at a finer grain.
 *
 * ⛔ THIS MODULE IS NOT ON `@kitchensink/recipe-core`'s BARREL, AND ADDING IT THERE IS A REGRESSION.
 * It is reachable only as `@kitchensink/recipe-core/scaling` (a declared package export). Two reasons, and
 * they agree:
 *
 *  1. LAYERING. The barrel carries WIRE/DOMAIN shapes the recipe service itself composes. This is
 *     PRESENTATION policy — the service has no use for it.
 *  2. THE ENFORCED CONSEQUENCE. The recipe service's `*.schema.ts` files import that barrel, and
 *     `computeContractHash` (`@kitchensink/contract-gen`) fingerprints the raw TEXT of every transitively
 *     reachable composed source. Re-exporting this module from the barrel therefore changes the service's
 *     `CONTRACT_HASH` — forcing a contract regeneration, and client-visible contract churn, for a change no
 *     client can observe. Measured, not theorised: doing it fails `recipe-service`'s
 *     `contract/__tests__/contract.test.ts`, and so does merely adding a COMMENT to that barrel, because the
 *     fingerprint is over source text.
 */
import { ABSENT_QUANTITY, type IngredientQuantity } from './ingredientQuantity.js';
import type { RecipeIngredientView } from './recipe.types.js';

/** The fewest servings the display control offers. A zero-serving recipe is meaningless (per the schema). */
export const MIN_SCALED_SERVINGS = 1;

/**
 * The most servings the display control offers.
 *
 * This is a DISPLAY bound, not a wire bound: `recipeServingsSchema` permits anything up to `INT4_CEILING`,
 * and a stored recipe with more servings than this is still read and rendered normally — only the scaling
 * control is capped. The cap exists so the control has a defined range and so a mistyped serving count
 * cannot produce absurd quantities. The specific value is a judgement call, open to an owner ruling.
 */
export const MAX_SCALED_SERVINGS = 100;

/**
 * Decimal places kept when scaling a quantity.
 *
 * This erases IEEE-754 representation error (`0.3 * (1/3)` is `0.09999999999999999`), it is NOT a display
 * decision: rounding here to the 2 places a UI might show would destroy legitimate culinary quantities such
 * as an eighth of a teaspoon. DISPLAY rounding already has exactly one owner — `formatQuantity`'s
 * `Intl.NumberFormat` (features-recipes `detail/model.ts`), which shows 3 fraction digits by default. Do
 * not consolidate the two: this one is arithmetic hygiene, that one is presentation.
 */
const QUANTITY_PRECISION = 6;

/** A recipe scaling was asked for with a value the domain cannot express. */
export class RecipeScalingError extends Error {
    /** Which input was rejected. */
    public readonly reason: 'servings' | 'quantity';
    /** The offending value. */
    public readonly value: number;

    public constructor(reason: 'servings' | 'quantity', value: number, message: string) {
        super(message);
        this.name = 'RecipeScalingError';
        this.reason = reason;
        this.value = value;
        Object.setPrototypeOf(this, RecipeScalingError.prototype);
    }
}

/** Type guard for {@link RecipeScalingError}. */
export function isRecipeScalingError(error: unknown): error is RecipeScalingError {
    return error instanceof RecipeScalingError;
}

/** The chosen serving count, the recipe's own, and the ratio between them. */
export interface RecipeScaling {
    /** The serving count the recipe was authored with — what the control defaults (and returns) to. */
    readonly baseServings: number;
    /** The serving count the cook is viewing. */
    readonly servings: number;
    /** `servings / baseServings`. */
    readonly ratio: number;
    /** Whether the view differs from the stored recipe (drives the "cook times unchanged" disclosure). */
    readonly isScaled: boolean;
}

/** Exactly the fields scaling reads — never a whole `RecipeDetail`, which would couple arithmetic to the read model. */
export interface ScalableRecipe {
    readonly servings: number;
    readonly prepTimeMinutes: number;
    readonly cookTimeMinutes: number;
    readonly totalTimeMinutes: number;
    readonly ingredients: readonly RecipeIngredientView[];
}

/** A recipe re-expressed for a chosen serving count. Cook time is carried through UNCHANGED, on purpose. */
export interface ScaledRecipe {
    readonly scaling: RecipeScaling;
    /** The ingredient lines with scaled quantities; every other field is carried through verbatim. */
    readonly ingredients: readonly RecipeIngredientView[];
    /** Hands-on prep, scaled. */
    readonly prepTimeMinutes: number;
    /** Cook time, IDENTICAL to the stored value. Present so a caller reads one consistent set of timings. */
    readonly cookTimeMinutes: number;
    /** Stored total, adjusted by the prep delta only — inactive time is neither scaled nor lost. */
    readonly totalTimeMinutes: number;
}

/** The inclusive range of serving counts the control may offer for a given recipe. */
export interface ServingsRange {
    readonly min: number;
    readonly max: number;
}

/**
 * The serving counts the control may offer for a recipe. Pure.
 *
 * The upper end is `max(MAX_SCALED_SERVINGS, baseServings)`, NOT the flat cap. A recipe may legitimately be
 * authored with more servings than the cap — the wire allows up to `INT4_CEILING` — and a flat cap would
 * both refuse to render such a recipe at its own yield and trap the cook below it once they scaled down.
 * The cap constrains how far a cook may scale UP from an ordinary recipe; it is not a claim about which
 * recipes exist.
 *
 * @param baseServings - The recipe's authored serving count.
 * @returns The inclusive range of choosable serving counts.
 */
export function servingsRange(baseServings: number): ServingsRange {
    return { min: MIN_SCALED_SERVINGS, max: Math.max(MAX_SCALED_SERVINGS, baseServings) };
}

/**
 * Coerce any number to a serving count the control may hold — rounded to a whole serving and clamped into
 * {@link servingsRange}. `NaN` (an emptied numeric field) becomes the minimum. Pure.
 *
 * This is the PARSE step that makes {@link makeRecipeScaling}'s throw unreachable from the UI: the state
 * holding the chosen serving count is fed through here, so it can never hold an unrepresentable value.
 *
 * @param value - A raw candidate serving count (e.g. a number input's parsed value).
 * @param baseServings - The recipe's authored serving count, which defines the range.
 * @returns A whole serving count within the supported range.
 */
export function clampServings(value: number, baseServings: number): number {
    const { min, max } = servingsRange(baseServings);

    if (Number.isNaN(value)) {
        return min;
    }

    return Math.min(max, Math.max(min, Math.round(value)));
}

/**
 * Build the {@link RecipeScaling} between a recipe's own serving count and the one the cook chose. Pure.
 *
 * @param baseServings - The recipe's authored serving count (a positive integer; the wire guarantees it).
 * @param servings - The chosen serving count, already within the supported range (see {@link clampServings}).
 * @returns The scaling.
 * @throws {RecipeScalingError} When either count is not a representable whole serving count. Reaching this
 *   means a data defect (a recipe with a nonsensical `servings`) or an unparsed UI value — not a user error.
 */
export function makeRecipeScaling(baseServings: number, servings: number): RecipeScaling {
    if (!Number.isInteger(baseServings) || baseServings < MIN_SCALED_SERVINGS) {
        throw new RecipeScalingError('servings', baseServings, `Recipe has a non-positive serving count`);
    }

    const { min, max } = servingsRange(baseServings);

    if (!Number.isInteger(servings) || servings < min || servings > max) {
        throw new RecipeScalingError(
            'servings',
            servings,
            `Serving count must be a whole number between ${min} and ${max}`,
        );
    }

    return {
        baseServings,
        servings,
        ratio: servings / baseServings,
        isScaled: servings !== baseServings,
    };
}

/** Round away binary floating-point error while preserving genuine precision. Pure. */
function roundQuantity(value: number): number {
    const factor = 10 ** QUANTITY_PRECISION;

    return Math.round(value * factor) / factor;
}

/** Scale one bound, refusing anything that is not a real amount. Pure. */
function scaleBound(bound: number, ratio: number): number {
    if (!Number.isFinite(bound) || bound <= 0) {
        throw new RecipeScalingError('quantity', bound, 'Ingredient quantity must be a finite, positive amount');
    }

    return roundQuantity(bound * ratio);
}

/**
 * Scale one ingredient quantity, in whichever of its three forms the source stated. Pure.
 *
 * ⛔ An `absent` quantity is returned UNCHANGED (R40). There is no number to multiply, and every alternative
 * fabricates one — `0`, `1`, or the ratio itself — turning "the source stated no amount" into a claim the
 * source never made. A `range` scales BOTH bounds: moving only the lower one would quietly narrow the range
 * the instant a cook touched the serving control, which is the corruption U8 exists to end.
 *
 * The bound guard survives the value object deliberately. `statedQuantity` is the only door into a
 * well-formed quantity, but this function is exported and TypeScript cannot prove its argument came through
 * that door; without the guard a cast-in `NaN` would render as `NaN` on a cook's screen.
 *
 * @param quantity - The stored quantity.
 * @param scaling - The active scaling.
 * @returns The quantity to display, same member as the input.
 * @throws {RecipeScalingError} When a bound is not a finite, positive amount.
 */
export function scaleQuantity(quantity: IngredientQuantity, scaling: RecipeScaling): IngredientQuantity {
    if (quantity.kind === 'absent') {
        return ABSENT_QUANTITY;
    }

    // Unscaled is the DEFAULT view, and it must show the recipe exactly as stored. Falling through to the
    // rounding below would silently rewrite any stored quantity carrying more than QUANTITY_PRECISION
    // decimals — changing data nobody asked to change, on first paint. The bounds are still checked, so an
    // unrepresentable value is refused at 1x too.
    if (quantity.kind === 'exact') {
        const value = scaleBound(quantity.value, scaling.ratio);

        return scaling.isScaled ? { kind: 'exact', value } : quantity;
    }

    const low = scaleBound(quantity.low, scaling.ratio);
    const high = scaleBound(quantity.high, scaling.ratio);

    return scaling.isScaled ? { kind: 'range', low, high } : quantity;
}

/** Scale a whole number of minutes, staying whole. Pure. */
function scaleMinutes(minutes: number, ratio: number): number {
    return Math.round(minutes * ratio);
}

/**
 * Re-express a recipe for a chosen serving count — the ONE derivation both platforms' detail views read, so
 * they cannot disagree about what scales. Pure; the input recipe is never mutated.
 *
 * @param recipe - The stored recipe's scalable fields.
 * @param servings - The chosen serving count.
 * @returns The scaled projection (quantities + prep scaled, cook time carried through unchanged).
 * @throws {RecipeScalingError} When the serving counts or a quantity are unrepresentable.
 */
export function scaleRecipeForServings(recipe: ScalableRecipe, servings: number): ScaledRecipe {
    const scaling = makeRecipeScaling(recipe.servings, servings);
    const prepTimeMinutes = scaleMinutes(recipe.prepTimeMinutes, scaling.ratio);
    // The stored total may include inactive time (resting, marinating, chilling) beyond prep + cook, and
    // that time is neither hands-on nor thermal — it does not scale either. So the total moves by exactly
    // the prep delta. `Math.max(0, …)` guards a stored total that is already inconsistent with its parts.
    const totalTimeMinutes = Math.max(0, recipe.totalTimeMinutes + (prepTimeMinutes - recipe.prepTimeMinutes));

    return {
        scaling,
        ingredients: recipe.ingredients.map((line) => ({ ...line, quantity: scaleQuantity(line.quantity, scaling) })),
        prepTimeMinutes,
        // Deliberately IDENTICAL to the stored value — see this module's header. Do not "finish" this by
        // multiplying it by the ratio.
        cookTimeMinutes: recipe.cookTimeMinutes,
        totalTimeMinutes,
    };
}
