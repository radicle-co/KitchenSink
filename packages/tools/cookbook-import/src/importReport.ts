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
import { quantityLowerBound, quantityUpperBound, type IngredientQuantity } from '@kitchensink/recipe-core';

import type { MeasureSystem, ParseAgreement } from '@kitchensink/recipe-import-core';

import type { IngredientResolutionKind } from './resolveIngredient.js';
import type { RecipeSkipReason } from './proseRecipe.js';
import type { EquivalenceSource, HistoricalUnitConversion } from './unitEquivalence.js';

/** One imported recipe, kept so the report can show real examples rather than only counts. */
export interface ImportedExample {
    /** The recipe id the service assigned. */
    readonly recipeId: string;
    /** The display title. */
    readonly title: string;
    /** Each line: the name from the prose, how it resolved, and the food record it reached (if any). */
    readonly lines: readonly {
        /**
         * What the source stated, in the SAME shape the service now persists (U8) — one value, two bounds,
         * or nothing. It was a `quantity` scalar plus a loose `quantityHigh` while the wire could only
         * carry the lower bound and the report had to show what was lost.
         */
        readonly quantity: IngredientQuantity;
        readonly unit: string;
        readonly name: string;
        readonly kind: IngredientResolutionKind;
        readonly foodId: string | undefined;
        readonly foodResolutionStatus: string | undefined;
    }[];
}

/** One equivalence the run leaned on, and how many lines it converted. */
export interface HistoricalEquivalenceUse {
    /** The historical unit, canonicalised. */
    readonly unit: string;
    /** Millilitres per unit, as this book's authority sizes it. */
    readonly millilitres: number;
    /** Which system the factor is read in — an imperial gill and a US customary gill are 20% apart. */
    readonly measureSystem: MeasureSystem;
    /** The book's own table, or the named external standard. */
    readonly source: EquivalenceSource;
    /** The authority, in words. */
    readonly citation: string;
    /** The authority's own printed statement, verbatim. */
    readonly statedAs: string;
    /** How many ingredient lines this equivalence converted. */
    lines: number;
}

/** What the two engines' answers to one line amounted to. */
type ParseAgreementKind = ParseAgreement['kind'];

/**
 * What the two-engine parse pipeline concluded about the lines this run imported (U22).
 *
 * ⛔ OBSERVATION, not authority. Nothing here decides what was sent — see `runImport.ts`'s header on why the
 * winner rule is observe-only until U23's oracle lands. These are the numbers that oracle is calibrated
 * against, which is precisely why they must not be inflated by anything they do not describe.
 */
export interface ParseObservationData {
    /** Ingredient lines the pipeline read. */
    lines: number;
    /**
     * Lines by what the two engines' answers amounted to.
     *
     * ⛔ `single-engine` is NOT `differ` (KTD-12). An engine that threw, or a call the spend ceiling denied,
     * is ABSENCE — folding it into disagreement would inflate that rate by however often an engine was down,
     * and no later reader could separate the two out of the corpus.
     */
    readonly agreement: Record<ParseAgreementKind, number>;
    /**
     * Lines a human correction answered.
     *
     * ⛔ Counted APART from {@link ParseObservationData.agreement}, and never inside it: a cook is neither
     * engine, so their answer is not an adjudication and must not enter a rate no engine contributed to.
     */
    corrected: number;
    /** Per-engine answers served from the cache rather than from an engine call. */
    cacheHits: number;
    /** Micro-dollars the model leg spent, as ITS OWN adapter counted them. */
    spentMicros: number;
    /** Tier failures reported, by tier — "we could not look", never "we looked and found nothing". */
    readonly tierFailures: Record<string, number>;
    /** Stored rows that could not be read, by store. A superseded generation, not an outage. */
    readonly unreadablePayloads: Record<string, number>;
    /** A handful of lines the two engines read differently, verbatim — the input U23's oracle adjudicates. */
    readonly disagreements: { line: string; fields: string[] }[];
}

/** The empty observation. */
export function emptyObservation(): ParseObservationData {
    return {
        lines: 0,
        // ⛔ A TOTAL record over the agreement union, so a member added to `ParseAgreement` is a compile
        // error here rather than a shape the census silently never counts.
        agreement: { agree: 0, differ: 0, 'single-engine': 0, neither: 0 },
        corrected: 0,
        cacheHits: 0,
        spentMicros: 0,
        tierFailures: {},
        unreadablePayloads: {},
        disagreements: [],
    };
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
    /*
     * ⛔ `rangeNarrowedAtWire` STOOD HERE AND WAS DELETED BY U8. Do not reintroduce it.
     *
     * It counted lines whose source stated a RANGE that the wire could only carry as its lower bound, and
     * its own docstring said it "must fall to zero when U8 lands". U8 landed: `recipe_ingredients` holds
     * `quantity` + `quantity_high` and the contract carries the value object, so nothing between the parser
     * and the column narrows anything. A counter that is structurally always zero is worse than no counter
     * — it reads as a measurement while measuring nothing. The property it protected is now enforced by
     * TYPE (`runImport` hands the parser's own `IngredientQuantity` to the contract's own
     * `ingredientQuantitySchema`) rather than counted after the fact.
     */
    /** Source clauses that named something but carried no usable quantity, verbatim. */
    readonly droppedLines: string[];
    /** Ingredient LINES whose stated unit was restated from a historical measure (R35). */
    historicalConversions: number;
    /**
     * Each distinct equivalence the run relied on, with the authority behind it (R34).
     *
     * ⛔ NOT a single conversion count, and not keyed on the unit. R34 says an equivalence that leaves its
     * citation or its measure system implicit does not satisfy the requirement, and a bare counter leaves
     * both implicit — it cannot tell a reader that the gills came from the book's own printed table while
     * the dessertspoons came from an external standard the book never mentions. Keyed on the equivalence
     * so the same word from two books, sized 20% apart, is two rows and not one.
     */
    readonly historicalEquivalences: HistoricalEquivalenceUse[];
    /** A handful of complete recipes, for a reader who wants to see the output rather than the totals. */
    readonly examples: ImportedExample[];
    /**
     * What the two-engine parse pipeline concluded, when this run observed it.
     *
     * ⚠️ `undefined` means the run did NOT observe — a different fact from an observation of zero lines, and
     * the reason this is absent rather than an empty section. `JSON.stringify` drops it, so an unobserved
     * run's report simply has no such section rather than a row of zeroes a reader could misread as a result.
     */
    parseObservation: ParseObservationData | undefined;
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
        droppedLines: [],
        historicalConversions: 0,
        historicalEquivalences: [],
        examples: [],
        parseObservation: undefined,
    };
}

/**
 * Record that one line was converted through a historical-unit equivalence (R35).
 *
 * @param report - The accumulating report.
 * @param conversion - The conversion the mapper made.
 * @sideEffect Mutates `report`, like {@link recordDropped}.
 */
export function recordHistoricalConversion(report: ImportReportData, conversion: HistoricalUnitConversion): void {
    const { equivalence } = conversion;

    report.historicalConversions += 1;

    // ⛔ Matched on the MEASURE SYSTEM as well as the unit and the citation. Keying on unit alone would fold
    // Montefiore's 142 mL gill into #12350's 118 mL one and report a single row for two different claims.
    //
    // ⚠️ The citation used to carry that distinction for free, because each book cited its own printed
    // table. It no longer does: both books now size a gill from UCUM, so both rows say "UCUM (gill)" and
    // only the system tells them apart. Dropping the per-book table quietly made the old key insufficient —
    // caught by the test that asserts two books produce two rows, which is exactly what it is for.
    const existing = report.historicalEquivalences.find(
        (entry) =>
            entry.unit === equivalence.unit &&
            entry.citation === equivalence.citation &&
            entry.measureSystem === equivalence.measureSystem,
    );

    if (existing !== undefined) {
        existing.lines += 1;

        return;
    }

    report.historicalEquivalences.push({
        unit: equivalence.unit,
        millilitres: equivalence.millilitres,
        measureSystem: equivalence.measureSystem,
        source: equivalence.source,
        citation: equivalence.citation,
        statedAs: equivalence.statedAs,
        lines: 1,
    });
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

    const parse = report.parseObservation;

    if (parse !== undefined) {
        // ⚠️ Headed OBSERVATION, not a result. Nothing here decided what was sent — the field-level winner
        // rule is observe-only until U23's oracle lands — and a section labelled otherwise would read as a
        // claim about the recipes above it.
        // ⚠️ The label said "OBSERVATION — nothing here decided what was sent" while that was true. The
        // pipeline is now the AUTHORITY for what an accepted line says, so a report calling it an observation
        // would be telling an operator the opposite of what the run did.
        lines.push('\nTWO-ENGINE PARSE  (the reading these figures describe is what was SENT)');
        lines.push(`  lines read                          ${parse.lines}`);

        for (const [kind, count] of Object.entries(parse.agreement)) {
            lines.push(`    ${kind.padEnd(22)} ${String(count).padStart(5)}  ${pct(count, parse.lines)}`);
        }

        // ⛔ Printed APART from the census above, and never inside it: a cook is neither engine, so their
        // answer is not an adjudication and must not share a denominator with one.
        lines.push(`  answered by a correction            ${parse.corrected}`);
        lines.push(`  engine answers served from cache    ${parse.cacheHits}`);
        lines.push(`  model spend                         $${(parse.spentMicros / 1_000_000).toFixed(4)}`);

        for (const [tier, count] of Object.entries(parse.tierFailures)) {
            lines.push(
                `  ⚠️ ${tier} UNAVAILABLE                  ${count} time(s) — "could not look", not "found nothing"`,
            );
        }

        for (const [store, count] of Object.entries(parse.unreadablePayloads)) {
            lines.push(`  ⚠️ unreadable ${store} rows: ${count} — a superseded generation, not an outage`);
        }

        if (parse.disagreements.length > 0) {
            lines.push('\n  lines the two engines read differently:');

            for (const entry of parse.disagreements) {
                lines.push(`    [${entry.fields.join(', ')}] ${entry.line}`);
            }
        }
    }

    if (report.failures.length > 0) {
        lines.push('\nAPI REFUSALS');

        for (const failure of report.failures.slice(0, 20)) {
            lines.push(`  ${failure.title} — ${failure.reason}`);
        }
    }

    if (report.historicalEquivalences.length > 0) {
        // Printed with its authority beside every row, never as a lone total: "47 conversions" is a number
        // a reader cannot check, while "gill = 118.294 mL, us-customary, #12350's own table" is a claim.
        lines.push(
            `\nHISTORICAL UNIT CONVERSIONS  (${report.historicalConversions} line(s), by the authority that sized each unit)`,
        );

        for (const used of report.historicalEquivalences) {
            lines.push(
                `  ${used.unit.padEnd(14)} ${used.millilitres.toFixed(3).padStart(9)} mL  ${used.measureSystem.padEnd(17)} ${String(used.lines).padStart(4)} line(s)`,
            );
            lines.push(`      "${used.statedAs}" — ${used.citation}`);
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
            // A dash for a range, an empty cell for an amount the source did not state (R40) — never a `0`,
            // which in this column would read as "the recipe calls for none of it".
            const low = quantityLowerBound(line.quantity);
            const high = quantityUpperBound(line.quantity);
            const amount = low === null ? '' : line.quantity.kind === 'range' ? `${low}-${String(high)}` : String(low);

            lines.push(
                `  ${amount.padStart(9)} ${line.unit.padEnd(12)} ${line.name.padEnd(28)} ${line.kind.padEnd(20)} ${food}`,
            );
        }
    }

    return `${lines.join('\n')}\n`;
}
