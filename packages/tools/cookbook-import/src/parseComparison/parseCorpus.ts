/**
 * THE CORPUS — real ingredient lines, and the honest account of what makes them real.
 *
 * DESIGN PATTERN: **pure transformer over already-read content.** The reading of the book is the runner's;
 * this module turns the extractor's outcomes into the numbered lines a run is denominated in, so what the
 * corpus IS can be unit-tested without a 854 KB file.
 *
 * ## ⛔ WHAT THIS CORPUS IS
 *
 * The verbatim words of a public-domain 1919 cookbook, as our own importer extracts them. A line here is a
 * `sourceText` — "the clause EXACTLY as the book printed it" — from `toCandidateRecipe`, which is precisely
 * the text the ingredient pipeline feeds downstream. Nothing is authored, paraphrased or generated.
 *
 * ## ⛔ IT IS TWO POPULATIONS, AND THEY MUST NOT BE BLENDED
 *
 * {@link LineOrigin} is on every line because the two halves are not the same thing:
 *
 *  - `ingredient` — a clause the extractor ACCEPTED as an ingredient. These read like ingredient lines.
 *  - `dropped` — a clause it refused, "named something but carried no usable quantity". **Measured on this
 *    book, most of these are not ingredient lines at all** ("Serve on a heated platter", "See that you have
 *    a good fire"). They are kept because they are what the pipeline really submits, and dropping them would
 *    curate the corpus to flatter every parser — but a rate blended across both halves is a rate about a
 *    population nobody meant to ask about. The runner reports per origin.
 *
 * ## ⛔ WHAT IT IS NOT, AND THE READER MUST BE TOLD
 *
 *  - **It is not what a modern cook types.** It is 1900s prose: number words, no ingredient list, clauses
 *    carrying cooking instructions. A user-typed line carries brands, percentages, ampersands and typos.
 *  - **It is filtered by our own extractor's success**, which is a bias with a name and a DIRECTION.
 *    Harvesting `droppedLines` narrows the gap but does not close it: a block the extractor skipped whole
 *    contributes nothing, and the reasons are not equivalent — a block skipped for `no_stated_duration` had
 *    readable ingredient prose, while one skipped for `too_few_ingredients` is exactly the prose our quantity
 *    reader could not read. {@link harvestSourceTexts} therefore returns the reason histogram, not just a
 *    count, and the report publishes it. Read every agreement rate as an UPPER BOUND over the book's full
 *    ingredient prose, not as an estimate of it.
 *  - **It is one book.** Every rate is conditional on that.
 */
import type { RecipeCandidateOutcome } from '../proseRecipe.js';

/** Which half of the extractor's output a line came from. */
export type LineOrigin = 'ingredient' | 'dropped';

/** One clause as the extractor produced it, before numbering and de-duplication. */
export interface HarvestedClause {
    readonly text: string;
    readonly origin: LineOrigin;
}

/** One numbered corpus line. */
export interface ParseCorpusLine {
    /** Stable, position-derived. It is what pairs a first pass with its second. */
    readonly id: string;
    /** The book's own words. */
    readonly text: string;
    readonly origin: LineOrigin;
}

/** What the extractor produced, and the bias it leaves behind, so the report can publish both. */
export interface CorpusHarvest {
    readonly clauses: readonly HarvestedClause[];
    readonly acceptedBlocks: number;
    readonly skippedBlocks: number;
    /** How many blocks were lost to each skip reason. The DIRECTION of the residual bias. */
    readonly skipReasons: Readonly<Record<string, number>>;
}

/** A source line break is typesetting, not content: the book wrapped a phrase, the phrase did not change. */
const LINE_BREAK = /\s*\n\s*/g;

/**
 * Take every ingredient clause out of the extractor's outcomes.
 *
 * ⚠️ BOTH halves of an accepted candidate are harvested — see the module docstring. A skipped block
 * contributes nothing but is counted, by reason.
 *
 * @param outcomes - What `toCandidateRecipe` made of each segmented block, in book order.
 * @returns The clauses with their origin, plus the accept/skip tallies. Pure.
 */
export function harvestSourceTexts(outcomes: readonly RecipeCandidateOutcome[]): CorpusHarvest {
    const clauses: HarvestedClause[] = [];
    const skipReasons: Record<string, number> = {};
    let acceptedBlocks = 0;
    let skippedBlocks = 0;

    for (const outcome of outcomes) {
        if (outcome.kind !== 'candidate') {
            skippedBlocks += 1;
            skipReasons[outcome.reason] = (skipReasons[outcome.reason] ?? 0) + 1;
            continue;
        }

        acceptedBlocks += 1;

        for (const ingredient of outcome.recipe.ingredients) {
            clauses.push({ text: ingredient.sourceText, origin: 'ingredient' });
        }

        for (const dropped of outcome.droppedLines) {
            clauses.push({ text: dropped, origin: 'dropped' });
        }
    }

    return { clauses, acceptedBlocks, skippedBlocks, skipReasons };
}

/**
 * Number and de-duplicate harvested clauses.
 *
 * ⚠️ De-duplication is on the TRIMMED text and is EXACT. `Two eggs` and `two eggs` stay two lines, because
 * the corpus is text: they are different inputs and a model may well answer them differently. Folding them
 * together would make the corpus a set of meanings, and every rate would then be denominated in a population
 * the models were never shown. The FIRST occurrence keeps its origin, so a clause that is both an accepted
 * ingredient somewhere and a dropped clause elsewhere is counted once, as an ingredient.
 *
 * @param clauses - Harvested clauses, in the order the book prints them.
 * @returns The numbered corpus, in source order, with exact duplicates and blanks removed. Pure.
 */
export function buildParseCorpus(clauses: readonly HarvestedClause[]): readonly ParseCorpusLine[] {
    const seen = new Set<string>();
    const corpus: ParseCorpusLine[] = [];

    for (const clause of clauses) {
        const text = clause.text.replace(LINE_BREAK, ' ').trim();

        if (text.length === 0 || seen.has(text)) {
            continue;
        }

        seen.add(text);
        corpus.push({ id: `L${String(corpus.length + 1).padStart(5, '0')}`, text, origin: clause.origin });
    }

    return corpus;
}

/**
 * Draw the lines that get a second pass.
 *
 * ⚠️ Evenly spaced across the whole corpus, never a prefix. The corpus is in book order, so a prefix is one
 * chapter — soups — and a determinism rate measured on soups is a rate about soups. Deterministic by
 * construction so a re-run is comparable without carrying a seed.
 *
 * @param corpus - The whole corpus.
 * @param size - How many lines to draw.
 * @returns The drawn lines, in corpus order. The whole corpus when `size` meets or exceeds it. Pure.
 */
export function determinismSample(corpus: readonly ParseCorpusLine[], size: number): readonly ParseCorpusLine[] {
    if (size <= 0 || corpus.length === 0) {
        return [];
    }

    if (size >= corpus.length) {
        return corpus;
    }

    const stride = corpus.length / size;

    return Array.from({ length: size }, (_, index) => corpus[Math.floor(index * stride)]).filter(
        (line): line is ParseCorpusLine => line !== undefined,
    );
}

/**
 * How many billed calls one model's run will make.
 *
 * ⛔ BOTH passes. The repeat pass is billed exactly like the first, and an estimate that counted only the
 * first would understate the run — which is the same defect, in the other direction, as a total that omits
 * the repeat pass's cost.
 *
 * @param lines - Corpus size.
 * @param sampleSize - How many lines get a second pass.
 * @returns Calls per model. Pure.
 */
export function plannedCalls(lines: number, sampleSize: number): number {
    return lines + Math.min(Math.max(sampleSize, 0), lines);
}
