/**
 * The import REPORT — the tool's observability surface, and the deliverable of the whole exercise.
 *
 * This exists because the interesting output of a curated import is not "it worked". It is the pair of
 * measurements a reader cannot get any other way:
 *
 *  1. **Parser yield** — of the headings in a real 1900s cookbook, how many became a coherent recipe, and
 *     for each one that did not, WHICH RULE refused it.
 *  2. **The system's ingredient-resolution rate** — of the ingredient names a real recipe uses, how many
 *     the product's own catalog lookup matched to a food record, and what the failures look like.
 *
 * ⚠️ (2) is a measurement OF THE PRODUCT, not a score for this tool. It is deliberately reported per
 * RESOLUTION KIND rather than as a single percentage, because "the blended suggestion list offered a
 * catalog hit" and "nothing was offered, so we asked the food service to go and find the name" are
 * different facts about the system, and averaging them hides the one worth acting on.
 *
 * ⛔ Nothing here may be improved by improving the tool. If a future change raises the resolution rate by
 * rewriting ingredient names before lookup, the number stops describing the product and the report becomes
 * a lie told with real data — see `resolveIngredient.ts`.
 */
import type { IngredientResolutionKind } from './resolveIngredient.js';
import type { RecipeSkipReason } from './proseRecipe.js';

/** One imported recipe, kept so the report can show real examples rather than only counts. */
export interface ImportedExample {
    /** The recipe id the service assigned. */
    readonly recipeId: string;
    /** The display title. */
    readonly title: string;
    /** Each line: the name from the prose, how it resolved, and the food record it reached (if any). */
    readonly lines: readonly {
        readonly quantity: number;
        /** The range's upper bound, when the source stated a range. `undefined` for a single amount. */
        readonly quantityHigh: number | undefined;
        readonly unit: string;
        readonly name: string;
        readonly kind: IngredientResolutionKind;
        readonly foodId: string | undefined;
        readonly foodResolutionStatus: string | undefined;
    }[];
}

/** Everything the run measured. */
export interface ImportReportData {
    /** The book, as the registry names it. */
    readonly book: string;
    /** Headings the adapter found. */
    headingsFound: number;
    /** Headings the mapper turned into a candidate recipe. */
    candidates: number;
    /** Candidates already present in the ledger, so not re-created. */
    alreadyImported: number;
    /** Recipes actually created this run. */
    imported: number;
    /** Creates the API refused, with the reason it gave. */
    readonly failures: { title: string; reason: string }[];
    /** Headings refused by the mapper, counted by rule. */
    readonly skipped: Record<RecipeSkipReason, number>;
    /** Ingredient lines submitted across every created recipe. */
    ingredientLines: number;
    /** Ingredient lines by how the SYSTEM resolved the name. */
    readonly resolutionKinds: Record<IngredientResolutionKind, number>;
    /** Lines whose catalog row carries a real `foodId`. */
    foodBacked: number;
    /**
     * DISTINCT food-backed ingredients that reached `RESOLVED` by the end of the settle window.
     *
     * ⚠️ COUNTED IN INGREDIENTS, NOT LINES, and the distinction is not pedantry — it was a reporting defect
     * caught by cross-checking against the database. `foodBacked` above counts LINES, and one ingredient
     * backs many lines ("butter" appeared 138 times in a single run), so printing the two side by side as
     * though they shared a denominator understated resolution by roughly 4x. The two are now labelled with
     * their units and never presented as a ratio of each other.
     */
    foodResolvedIngredients: number;
    /** DISTINCT food-backed ingredients still non-terminal when the run ended. */
    foodPendingIngredients: number;
    /** DISTINCT food-backed ingredients seen at all — the denominator for the two counts above. */
    foodBackedIngredients: number;
    /** Lookups made while the food catalog was unreachable — NOT the same as "no match". */
    catalogUnavailable: number;
    /**
     * Lines whose source stated a RANGE that the wire could only carry as its lower bound.
     *
     * Counted because it is a known, temporary loss rather than a parse failure: the parser preserves both
     * bounds (R36) and `recipe_ingredients.quantity` is a single positive scalar until U8 widens it. A
     * non-zero figure here is the size of what U8 recovers; it must fall to zero when U8 lands.
     */
    rangeNarrowedAtWire: number;
    /** Source clauses that named something but carried no usable quantity, verbatim. */
    readonly droppedLines: string[];
    /** A handful of complete recipes, for a reader who wants to see the output rather than the totals. */
    readonly examples: ImportedExample[];
}

/** The empty report for a book. */
export function emptyReport(book: string): ImportReportData {
    return {
        book,
        headingsFound: 0,
        candidates: 0,
        alreadyImported: 0,
        imported: 0,
        failures: [],
        skipped: { no_body: 0, too_few_ingredients: 0, too_few_steps: 0, no_stated_duration: 0 },
        ingredientLines: 0,
        resolutionKinds: { local_suggestion: 0, catalog_suggestion: 0, added_by_name: 0, freeform: 0 },
        foodBacked: 0,
        foodResolvedIngredients: 0,
        foodPendingIngredients: 0,
        foodBackedIngredients: 0,
        catalogUnavailable: 0,
        rangeNarrowedAtWire: 0,
        droppedLines: [],
        examples: [],
    };
}

/** How many verbatim dropped lines to keep. Enough to see the SHAPE of the failures, not a second corpus. */
const MAX_DROPPED_SAMPLE = 60;

/** Keep a bounded sample of dropped source clauses. */
export function recordDropped(report: ImportReportData, lines: readonly string[]): void {
    for (const line of lines) {
        if (report.droppedLines.length >= MAX_DROPPED_SAMPLE) {
            return;
        }

        report.droppedLines.push(line);
    }
}

/**
 * Render the report for a human reading a terminal.
 *
 * @param report - The accumulated measurements.
 * @returns The rendered text. Pure.
 */
export function renderReport(report: ImportReportData): string {
    const lines: string[] = [];
    const pct = (part: number, whole: number): string =>
        whole === 0 ? 'n/a' : `${((part / whole) * 100).toFixed(1)}%`;

    lines.push(`\n══ cookbook-import — ${report.book} ══\n`);
    lines.push('RECIPES');
    lines.push(`  headings found in the book          ${report.headingsFound}`);
    lines.push(
        `  parsed into a coherent recipe       ${report.candidates}  (${pct(report.candidates, report.headingsFound)} of headings)`,
    );
    lines.push(`  created this run                    ${report.imported}`);
    lines.push(`  already in the ledger (skipped)     ${report.alreadyImported}`);
    lines.push(`  refused by the API                  ${report.failures.length}`);
    lines.push('\n  skipped by the parser, by rule:');

    for (const [reason, count] of Object.entries(report.skipped)) {
        lines.push(`    ${reason.padEnd(22)} ${count}`);
    }

    lines.push('\nINGREDIENT RESOLUTION  (a measurement of the PRODUCT, not of this tool)');
    lines.push(`  ingredient lines submitted          ${report.ingredientLines}`);

    for (const [kind, count] of Object.entries(report.resolutionKinds)) {
        lines.push(`    ${kind.padEnd(22)} ${String(count).padStart(5)}  ${pct(count, report.ingredientLines)}`);
    }

    lines.push(
        `  LINES carrying a real food_id       ${report.foodBacked}  (${pct(report.foodBacked, report.ingredientLines)} of lines)`,
    );
    // ⚠️ A different denominator, said out loud. One ingredient backs many lines, so these are counted in
    // DISTINCT INGREDIENTS and must never be read as a share of the line count above.
    lines.push(`  DISTINCT food-backed ingredients    ${report.foodBackedIngredients}`);
    lines.push(
        `    of those, RESOLVED                ${report.foodResolvedIngredients}  (${pct(report.foodResolvedIngredients, report.foodBackedIngredients)} of ingredients)`,
    );
    lines.push(`    of those, still non-terminal      ${report.foodPendingIngredients}`);
    lines.push(`  lookups during a catalog outage     ${report.catalogUnavailable}`);
    lines.push(`  stated RANGES narrowed at the wire  ${report.rangeNarrowedAtWire}  (recovered by U8)`);

    if (report.failures.length > 0) {
        lines.push('\nAPI REFUSALS');

        for (const failure of report.failures.slice(0, 20)) {
            lines.push(`  ${failure.title} — ${failure.reason}`);
        }
    }

    if (report.droppedLines.length > 0) {
        lines.push('\nSOURCE CLAUSES DROPPED (no usable quantity, or a stated value we refuse to trust)');

        for (const dropped of report.droppedLines.slice(0, 20)) {
            lines.push(`  "${dropped}"`);
        }
    }

    for (const example of report.examples) {
        lines.push(`\nEXAMPLE — ${example.title}  (${example.recipeId})`);

        for (const line of example.lines) {
            const food =
                line.foodId === undefined
                    ? 'freeform (no food record)'
                    : `food_id=${line.foodId} ${line.foodResolutionStatus ?? ''}`.trim();
            const amount =
                line.quantityHigh === undefined ? String(line.quantity) : `${line.quantity}-${line.quantityHigh}`;

            lines.push(
                `  ${amount.padStart(9)} ${line.unit.padEnd(12)} ${line.name.padEnd(28)} ${line.kind.padEnd(20)} ${food}`,
            );
        }
    }

    return `${lines.join('\n')}\n`;
}
