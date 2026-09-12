/**
 * THE COMPARISON FOLD — the ONE definition of "these two readings say the same thing".
 *
 * DESIGN PATTERN: **value-object smart constructor.** Every comparison in this measurement — model against
 * the CRF parser, and a model against ITSELF on a second pass — folds through this module and no other.
 * Two folds would let the determinism figure and the agreement figure disagree about what "the same" is,
 * and the report would be internally inconsistent with nothing to point at.
 *
 * ## ⚠️ THE FOLD IS PART OF THE MEASUREMENT, AND IT IS DECLARED HERE SO THE READER CAN DISCOUNT IT
 *
 * A comparison on raw text would score `"1/2 cups"` against `"one-half cup"` as a disagreement, and the
 * report would be a census of spelling. So both sides are folded first, and exactly this much is folded:
 *
 * | fold                        | why it is not a real difference                                      |
 * | --------------------------- | ---------------------------------------------------------------------- |
 * | case                        | `Brown Sugar` and `brown sugar` name one food                        |
 * | whitespace                  | line breaks are an artefact of the book's typesetting                |
 * | diacritics                  | `purée` and `puree` name one food                                     |
 * | plural                      | the two parsers differ in whether they print the singular            |
 * | punctuation (names only)    | a trailing comma is a boundary marker, not part of the name          |
 * | number WORDS → rationals    | the 1919 corpus writes every quantity in words; the CRF prints numerals |
 * | measure function words      | `of`, `a`, `the` are grammar; no parser calls them a unit             |
 *
 * ⛔ **Nothing culinary is folded.** `sweet butter` does not fold to `butter` and `brown sugar` does not
 * fold to `sugar`. A fold that reached into food identity would manufacture the agreement it is supposed
 * to measure, and it would do so silently.
 *
 * ## ⛔ WHY NOT `normalizedIngredientKey`
 *
 * That function is the PERSISTED match grain, and its own docstring calls its derivation a one-way door
 * recoverable only by a backfill. This fold is a measurement convenience expected to move whenever the
 * harness learns something. They are two knowledges with different reasons to change (DRY governs
 * knowledge, not keystrokes), and binding them would let a harness tweak re-partition production data.
 *
 * What IS reused, because the repository already owns it and a local copy would be reinvention:
 * `foldForRanking` + `singularizeRankingText` + `rankingTokens` for names, and `normalizeUnit` for the
 * unit token — the latter matters, because a unit alias table run over a FOOD name is a category error
 * (`cloves` is a unit; `carrots` is not).
 */
import { normalizeUnit, unitSpellingDependsOnCase } from '@kitchensink/recipe-core';
import { rankingTokens } from '@kitchensink/recipe-core/resolution/ranking-terms';
import { normalizeQuantity } from '@kitchensink/recipe-import-core';

/**
 * Words a measure phrase strands that are grammar, never a unit.
 *
 * ⚠️ Grammar, deliberately, and not a culinary list — the same discipline `proseRecipe.ts`'s `LEADING_NOISE`
 * keeps. It is a separate set from that one because it answers a different question (what is left of a
 * measure once the quantity is taken off) and would move for a different reason, so merging them would be
 * the wrong abstraction rather than DRY.
 */
const MEASURE_FUNCTION_WORDS: ReadonlySet<string> = new Set(['of', 'a', 'an', 'the']);

/** Anything that is not a letter, a digit or a percent sign separates words in a measure remainder. */
const MEASURE_WORD_SEPARATOR = /[^\p{L}\p{N}%]+/u;

/**
 * Fold a food name to the form the comparison treats as its identity.
 *
 * @param raw - A food name from either parser.
 * @returns The folded name; the empty string when the input names nothing. Pure.
 */
export function normalizeName(raw: string): string {
    return rankingTokens(raw).join(' ');
}

/**
 * The words of a name, each ALSO put through the unit canonicaliser.
 *
 * ⛔ THIS EXISTS BECAUSE THE TWO FOLDS SPEAK DIFFERENT VOCABULARIES, AND THE HEADLINE FINDING DEPENDS ON IT.
 * `normalizeUnit` carries an alias table (`teaspoonful` -> `teaspoon`, `wineglassful` -> `wineglass`);
 * `rankingTokens` carries none. So asking "does the model's unit word appear inside the CRF's food name?"
 * — the test that detects the CRF swallowing a historical unit — compared `teaspoon` against `teaspoonful`
 * and answered NO. Measured before this function existed: `gill` was detected and `teaspoonful`,
 * `saltspoonful` and `wineglassful` were not, which is exactly the spelling a 1900s cookbook uses (it is
 * why `recipe-import-core`'s R31 teaches the `*ful` family to the tokenizer in the first place). The
 * detector therefore missed its own subject and dumped those lines into the unexplained residue.
 *
 * ⛔ A CASE-DEPENDENT SPELLING IS LEFT ALONE (U35, owner ruling 2026-08-25), and this is NOT the fix its
 * sibling `foldMeasureWords` got. That one still HAS the case and simply discarded it, so it stopped. This
 * one receives `rankingTokens` output, and `foldForRanking` lower-cased it on the way to a rule the
 * PERSISTED match grain mirrors in SQL — that fold cannot be undone, and reaching for an un-folded name
 * here would bind a measurement convenience to a one-way door. So for `t`, whose meaning depends on a case
 * this token no longer carries, the unit is genuinely UNDETERMINED and is reported as the letter it is.
 * Measured before this: `unitComparableWords('vitamin t supplement')` yielded `teaspoon` — a real unit word
 * manufactured out of a stray letter, in the set that answers "did the CRF swallow the model's unit into
 * the food name?", so a manufactured unit is a manufactured YES.
 *
 * @param raw - A food name from either parser.
 * @returns Its words, unit-canonicalised except where case decides the unit, as a set. Pure.
 */
export function unitComparableWords(raw: string): ReadonlySet<string> {
    return new Set(rankingTokens(raw).map((word) => (unitSpellingDependsOnCase(word) ? word : normalizeUnit(word))));
}

/**
 * Fold a preparation clause. `null` and blank are the SAME absence — one parser writes `null` where the
 * other writes nothing, and that is not a disagreement about the line.
 *
 * @param raw - A preparation clause, or its absence.
 * @returns The folded clause; the empty string for an absent one. Pure.
 */
export function normalizePrep(raw: string | null): string {
    return raw === null ? '' : normalizeName(raw);
}

/**
 * Words that stand in FRONT of a quantity without changing it.
 *
 * ⚠️ `normalizeQuantity` reads a LEADING phrase only, so `"about 2 cups"` reported no quantity at all —
 * which made a hedge word turn a quantity disagreement into a unit disagreement, and `judgeMeasure` never
 * reaches the quantity comparison once the units differ. Stripping them is what keeps the two sides
 * symmetric when one parser echoes the hedge and the other drops it.
 */
const MEASURE_HEDGE_WORDS: ReadonlySet<string> = new Set([
    'about',
    'approximately',
    'around',
    'nearly',
    'roughly',
    'scant',
    'generous',
    'heaping',
    'heaped',
    'rounded',
    'level',
]);

/** A measure split into the two things the two parsers can be compared on. */
export interface NormalizedMeasure {
    /**
     * The exact rational the phrase states, rendered as a fraction string, or `null` when it states none.
     *
     * ⛔ An exact rational, never a rounded decimal: `one-third` is `1/3`, and `0.333` would make two
     * readings of the same phrase compare unequal depending on how each was rounded.
     */
    readonly quantity: string | null;
    /** The canonical unit, or the empty string when the phrase states none. */
    readonly unit: string;
    /**
     * Measure words left over after the quantity and the unit were taken — a SECOND amount the CRF joined
     * into one string ("2 cups 3 tablespoons"), the tail of a range, or an unrecognised qualifier.
     *
     * ⛔ Its own field rather than part of {@link unit}. Folded into the unit, a joined amount made the two
     * sides disagree about the UNIT when what actually differed was how many amounts each parser read — and
     * `judgeMeasure` never reaches the quantity comparison once units differ, so the real disagreement
     * became invisible. Reported so a residue can be named instead of hidden.
     */
    readonly residue: string;
}

/**
 * Fold a measure phrase into its quantity and its unit.
 *
 * ⚠️ Both sides of every measure comparison go through this, including the CRF's, whose amount text is
 * already rewritten into numerals. Running the CRF's own output through the number-word reader is a no-op
 * for it and is what keeps the two sides symmetric.
 *
 * ## ⛔ A NUMBER IS NEVER A UNIT — U37, and it repairs the divergence §14.6 of the report PINNED
 *
 * The unit used to be read PURELY POSITIONALLY: whatever word came first after the leading quantity. That
 * is right for `2 cups 3 tablespoons` and wrong for `2 3 tablespoons`, which the fold answered as
 * `{ '2', '3', 'tablespoon' }` — a unit of `3`.
 *
 * The input is not a typo. `crfProcess.ts` JOINS the amount tuples the engine returns, so
 * `[('2', ''), ('3', 'tablespoons')]` arrives as one string: the shape means **the CRF read more than one
 * amount**, and the FIRST of them — the one {@link NormalizedMeasure.quantity} reports — stated no unit at
 * all. So the unit is the empty string, and the second amount goes where {@link NormalizedMeasure.residue}
 * already says a joined amount goes.
 *
 * ⛔ THE OTHER READING WAS CONSIDERED AND IS WRONG: "skip forward to the next non-numeric word" would
 * answer `unit: 'tablespoon'`, asserting that `2` is two tablespoons when the engine's own tuples attach
 * that unit to the `3`. It manufactures a unit for an amount that stated none — the category error
 * `unitComparableWords` documents one function up — and, fatally, it leaves `crf.unit !== ''`, so
 * `judgeMeasure`'s empty-unit branch still never fires and the census still disposes `crfWins` where the
 * merge rescues. It would fix the symptom and preserve the bug.
 *
 * ⚠️ It is NARROW, to a numeric token, and that narrowness is measured rather than timid. The connective in
 * `two or three tablespoons` sits in the same position and is no more a unit than `3` was — but dropping it
 * would fold that phrase and `2 3 tablespoons` to the SAME empty-unit reading, the census would answer
 * `agree` where the merge rescues, and the divergence would re-open one verdict over. Left alone, and
 * pinned by a test that says so.
 *
 * @param raw - A measure phrase from either parser.
 * @returns Its quantity and unit. Pure.
 */
export function normalizeMeasure(raw: string): NormalizedMeasure {
    const { quantity, rest } = normalizeQuantity(stripHedges(raw));

    // The FIRST remaining word is the unit UNLESS it is itself an amount; anything after it is a second
    // amount, a range tail or a qualifier. Canonicalising the joined string instead would de-pluralise only
    // its last word, which made the fold depend on how many words happened to follow.
    const words = foldMeasureWords(rest);
    const [first] = words;
    const unitWord = first !== undefined && !first.isAmount ? first : null;

    return {
        quantity: quantity === null ? null : quantity.toFraction(),
        unit: unitWord === null ? '' : normalizeUnit(unitWord.text),
        // An amount in the unit position is not consumed as the unit, so it stays in the residue.
        residue: (unitWord === null ? words : words.slice(1)).map((word) => word.text).join(' '),
    };
}

/**
 * Replace a folded measure's unit with one the ANSWER stated, leaving the quantity and the residue alone.
 *
 * ⛔ FOR AN ARM THAT HAS A UNIT SLOT, AND FOR NOTHING ELSE. The bake-off's v3 prompt asks the model to name
 * the unit directly instead of leaving it to be read out of a measure phrase, so on that arm the unit is the
 * model's claim and this is where it is taken at face value. v1 and v2 never reach here: their unit is
 * DERIVED by {@link normalizeMeasure}, which is the ONE derivation used on both sides of every CRF
 * comparison. A report that presents the two as one column is wrong even when both numbers are right.
 *
 * ⚠️ The stated unit REPLACES the phrase's own first word rather than being appended to the residue. A model
 * given both slots frequently fills them consistently — `measurements: "2 cups"`, `units: "cups"` — and
 * appending would leave a residue of `cup`, which `judgeMeasure` reads as a SECOND amount and reports as
 * `amountCountDiffers`: a disagreement about nothing, manufactured by the fold. What survives in the residue
 * is what survived {@link normalizeMeasure} after the unit was taken, which is exactly the second amount, the
 * range tail or the qualifier the residue field exists to carry.
 *
 * @param folded - The measure phrase, already folded.
 * @param statedUnit - The unit the answer named. The empty string means it named none.
 * @returns The same quantity and residue with the stated, canonicalised unit. Pure.
 */
export function withStatedUnit(folded: NormalizedMeasure, statedUnit: string): NormalizedMeasure {
    const trimmed = statedUnit.trim();

    return {
        quantity: folded.quantity,
        // ⚠️ Through `normalizeUnit` like every other unit in this module, so `teaspoonful` and `teaspoon`
        // are one unit on both sides. A raw comparison answered NO for exactly the historical spellings this
        // corpus is made of — see `unitComparableWords` above.
        unit: trimmed === '' ? '' : normalizeUnit(trimmed),
        residue: folded.residue,
    };
}

/**
 * One folded word of a measure remainder, and whether it is an AMOUNT or anything else.
 *
 * ⛔ THE FLAG IS CARRIED, NEVER RE-DERIVED FROM THE SPELLING (U37). {@link foldMeasureWords} is the only
 * code that knows which branch produced a word, and it used to throw that away — leaving the caller to
 * decide "is this a unit?" from a string. The obvious reconstruction, a digit-shaped regex, is already
 * wrong on this corpus: an amount folds through `toFraction()`, so `1 1 1/2 boxes` (L01547/L01548) offers
 * `3/2` in the unit position and a `/^\d+$/` test would call it a unit. Making the fact travel with the
 * word makes that class of mistake unrepresentable rather than merely tested for.
 */
interface FoldedMeasureWord {
    /** The canonical word — a rendered rational for an amount, a canonicalised unit token otherwise. */
    readonly text: string;
    /** Whether the quantity reader produced this word. */
    readonly isAmount: boolean;
}

/**
 * Fold what follows the leading quantity into canonical words.
 *
 * ⛔ NUMBER WORDS ARE REWRITTEN THROUGHOUT, not only at the head. `normalizeQuantity` reads a LEADING phrase
 * only, so `"2 to 3 cups"` and `"two to three cups"` folded to residues of `3 cup` and `three cup` — the two
 * notations the two parsers actually use, scored as a disagreement about nothing. Walking the remainder with
 * the same reader is what makes the two sides symmetric, which is the whole premise of this module.
 */
function foldMeasureWords(rest: string): readonly FoldedMeasureWord[] {
    const words: FoldedMeasureWord[] = [];
    let remaining = rest;

    while (remaining.trim().length > 0) {
        const trimmed = remaining.trimStart();
        const [word = ''] = trimmed.split(/\s/u);
        const bare = word.toLowerCase().replace(MEASURE_WORD_SEPARATOR, '');

        // ⚠️ Function and hedge words are dropped BEFORE the quantity read, not after. `a` is a count of one
        // at the head of a measure ("a pinch") and a bare article inside it ("three-fourths OF A cup") — and
        // the quantity reader, which cannot see that distinction, turned the article into a `1` sitting
        // where the unit belongs.
        if (MEASURE_FUNCTION_WORDS.has(bare) || MEASURE_HEDGE_WORDS.has(bare)) {
            remaining = trimmed.slice(word.length);
            continue;
        }

        const read = normalizeQuantity(trimmed);

        if (read.quantity !== null && read.phrase.length > 0) {
            words.push({ text: read.quantity.toFraction(), isAmount: true });
            remaining = read.rest;
            continue;
        }

        remaining = trimmed.slice(word.length);

        // ⛔ SPLIT WITH THE CASE INTACT (U35, owner ruling 2026-08-25). `normalizeUnit` folds case itself,
        // once, AFTER reading the two spellings whose meaning depends on it — `T` is a tablespoon and `t` a
        // teaspoon. Lower-casing here threw that away one line before the lookup, which was harmless only
        // while the normalizer folded unconditionally: the moment it stopped, `2 T sugar` reported a
        // CONFIDENT `teaspoon`, a threefold understatement in the one fold every agreement and determinism
        // figure in this census is computed through. It costs no other spelling anything, because
        // `normalizeUnit`'s fallback returns the FOLDED form and never the raw one.
        for (const part of word.split(MEASURE_WORD_SEPARATOR)) {
            if (part.length > 0) {
                words.push({ text: normalizeUnit(part), isAmount: false });
            }
        }
    }

    return words;
}

/** Drop leading hedge words so the quantity behind them is read. */
function stripHedges(raw: string): string {
    const words = raw.trim().split(/\s+/u);
    let start = 0;

    while (start < words.length && MEASURE_HEDGE_WORDS.has((words[start] ?? '').toLowerCase())) {
        start += 1;
    }

    return words.slice(start).join(' ');
}
