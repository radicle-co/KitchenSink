/**
 * @module clauseSegmentation — where an ingredient span ENDS inside a clause of prose.
 *
 * DESIGN PATTERN: **Lexicon behind a pure total function returning an explicit outcome** — the sibling of
 * `modifierLexicon.ts`, and the same discipline: a vocabulary is a piece of knowledge, filed apart from
 * the pipeline that consumes it. The outcome is a discriminated union rather than a nullable string, so
 * "this text is not an ingredient at all" cannot be read as "this ingredient has an empty tail".
 *
 * ## The knowledge this owns, and the half it does NOT
 *
 * `cookbook-import`'s `proseRecipe.ts` already owns where an ingredient span STARTS: `suffixStarts`
 * scans a clause for the leftmost suffix that reads as a quantity, and that scan is R29-measured. What
 * nothing owned is where the span ENDS. The end was implicitly "the clause's end", so a clause carrying
 * an ingredient AND an instruction — which is ordinary in this corpus — handed both parse engines the
 * instruction too.
 *
 * ## ⛔ THE DEFECT THIS CLOSES (KTD-11a, measured 2026-08-23 over 354 `differ` cases)
 *
 * Reading the sample: `one tablespoon of butter in a frying-pan`, `one pound of flour into a deep bowl`,
 * `one pint of milk for five minutes`, `two pints of water overnight`, `four tablespoons of flour to it`
 * — and `a large preserving kettle`, which is equipment. A vessel, a duration, a target. **Neither engine
 * is wrong**; both are handed prose that should never have reached a parser. The CRF folds it into the
 * name, the LLM files it as prep, and the comparator scores a disagreement that is not one.
 *
 * ## ⛔ THE DANGER, AND THE GUARD (the reason this module is not a regex)
 *
 * `one-half pound chocolate in one cup of water` looks identical to the cases above and is not: the tail
 * is a **SECOND FOOD**. Dropping it deletes an amount the source states — value corruption, on exactly
 * the line class KTD-11a was found on. So {@link statesASecondFood} REFUSES the cut whenever the tail
 * reads as a food with a measured amount, and the whole span survives for `ParsedLine.foods`, which holds
 * many, to carry.
 *
 * ⚠️ The guard cannot simply be "the tail contains a quantity phrase", which is the obvious reading and is
 * WRONG on the corpus: `five minutes` and `twenty minutes` are quantity phrases, and KTD-11a names both as
 * instruction residue to remove.
 *
 * ⛔ Nor can it be "the tail states a UNIT", which was the first attempt and **deleted real food twice**.
 * That test is not the question:
 *
 *  - `two eggs` parses to `{quantity: 2, unit: null, name: 'eggs'}` — the normal form of every count
 *    ingredient in a cookbook — so a unit test cannot see it, and `one cup of milk with two eggs` lost its
 *    eggs with `droppedLines` EMPTY. `five minutes` has no unit either, so the test did not even separate
 *    the cases it was justified by.
 *  - `a large frying-pan` parses to `1 large :: frying-pan`, because `parse-ingredient` reads `large` as a
 *    unit — so a unit test called a VESSEL a food, refused the cut, and `one tablespoon of butter in a
 *    large frying-pan` lost its butter.
 *
 * The question is whether the noun the tail is about **is a substance**, which `notAFoodLexicon.ts`
 * answers. A vessel, a duration, a dimension and a count of people are not; everything else is treated as
 * a food, which is the direction that loses nothing — a refused cut costs only the status quo, while a
 * wrong cut deletes an amount the source printed.
 *
 * ## ⛔ A VESSEL'S ROLE IS ITS POSITION, NOT THE WORD (owner ruling, 2026-08-26)
 *
 * U22a decided a vessel by the WORD alone, so every vessel meant "not an ingredient". That is too broad,
 * because a cook genuinely measures by vessel. The owner ruled the two apart by GRAMMAR:
 *
 *  - **object of a preposition** → an instruction (`butter IN A FRYING-PAN`, `flour INTO A DEEP BOWL`);
 *  - **heading the measure phrase** → a UNIT (`A BOWL of flour`, `A LARGE MIXING BOWL of batter`).
 *
 * The book's own case is `In a large mixing bowl whip to a cream two eggs` (PEACH PUDDING). Nothing here
 * could see the `In`, so the span survived and the extractor published an ingredient literally named
 * `mixing bowl whip`, quantity 1, unit `large`, in a public recipe. Owner: _"mixing bowl is wrong — that's
 * just obviously not a food"_; _"'large mixing bowl' is the whole measurement"_.
 *
 * Position needs the clause, which a span alone is not — hence {@link segmentClause}'s second parameter.
 * It is REQUIRED rather than defaulted: a default would be a position, silently asserted for every caller
 * that had not thought about it, and the wrong one would delete an amount the source printed.
 *
 * ⚠️ The ruling costs the module NO vocabulary. `notAFoodLexicon.ts` still answers only _which words are
 * vessels_; the three grammatical judgements — what a preposition governs, where a measure phrase ends,
 * and what a vessel in each of those places means — are all HERE, because they are policy.
 *
 * ⛔ The same ruling read in the other direction removed two FOOD LOSSES the word-only rule was causing,
 * both measured over the whole 1919 book: `one and one-half cups of canned tomatoes rubbed through a
 * strainer` and `one quart of fine cottage cheese through a coarse sieve or colander` were classified
 * head-final on the vessel and thrown away ENTIRELY. `through` is a preposition and was simply missing
 * from {@link PREPOSITIONS}, so no cut was ever proposed and the governed vessel condemned the food in
 * front of it. A vessel a preposition governs is a tail to CUT — never a verdict on the whole span.
 */
import { parseIngredientLine } from '../ingredientLine.js';
import { findQuantityPhrases } from '../quantityPhrases.js';
import { lastWordOf, measuresNoSubstance, mentionsAVessel, namesEquipment, namesNoFood } from './notAFoodLexicon.js';

/**
 * What one accepted span of prose turned out to be.
 *
 * ⚠️ `instruction` raises no review reason anywhere, deliberately. A flag on a line nobody meant to parse
 * is the muted-signal failure KTD-11 rules against — "a flag that fires on half of everything is how a
 * real signal gets muted" — so the caller DROPS it exactly as it drops any clause that carries no
 * ingredient. Only a real loss (`ingredient` with a non-null tail) is worth a reason.
 */
export type ClauseSegment =
    | {
          readonly kind: 'ingredient';
          /** The ingredient, in the source's own words, bounded at its end. */
          readonly span: string;
          /**
           * The instruction text cut off the end, or `null` when there was nothing to cut.
           *
           * ⛔ Never `''`. The caller raises `instruction_text_dropped` on the ABSENCE of null, and an
           * empty string would make "nothing was lost" indistinguishable from "something was".
           */
          readonly trailingInstruction: string | null;
      }
    | { readonly kind: 'instruction' };

/**
 * The words that GOVERN a following noun phrase — the half of the boundary lexicon the position ruling
 * asks about.
 *
 * ⛔ Split out of {@link INSTRUCTION_BOUNDARY} rather than restated beside it, because "which words are
 * prepositions" is ONE piece of knowledge asked two ways: where may an instruction begin INSIDE a span,
 * and does the clause govern this span from OUTSIDE it. A second list would drift, and the drift would be
 * invisible — a preposition present in one and absent from the other changes which spans survive, and
 * nothing downstream can report that.
 *
 * ⚠️ `through` is here and was NOT in the pre-ruling boundary lexicon. Its absence deleted two real
 * ingredients from the 1919 book (module docstring). The list is completed by measured evidence rather
 * than by enumerating English: an unlisted preposition costs only the status quo, and the words this book
 * actually uses to place a vessel are the ones that earn a line.
 */
const PREPOSITIONS: readonly string[] = ['in', 'into', 'with', 'over', 'for', 'from', 'through', 'to', 'on', 'at'];

/**
 * The rest of the boundary lexicon — conjunctions, relatives and the auxiliaries these books attach to a
 * verb. None of them GOVERN a noun phrase, so none of them can make a vessel the object of anything.
 */
const CONNECTIVES: readonly string[] = [
    'and',
    'or',
    'that',
    'which',
    'until',
    'then',
    'when',
    'will',
    'has',
    'have',
    'had',
    'is',
    'are',
    'was',
    'were',
    'may',
    'should',
    'must',
    'can',
];

/**
 * Where an instruction may begin inside a span.
 *
 * ⚠️ This is GRAMMAR — prepositions, conjunctions and the auxiliaries these books attach to a verb — and
 * it is the lexicon `proseRecipe`'s `trimName` already carried, MOVED here so there is one authority
 * rather than one copy per view. Nothing that names or describes a food appears in it: cutting at `in`
 * removes a vessel, it never rewrites an ingredient toward a friendlier catalog match.
 *
 * The punctuation alternative has no surrounding whitespace requirement because a comma, semicolon, colon
 * or opening bracket ends a noun phrase wherever it sits.
 *
 * ⚠️ Composed from the two lists above rather than written out, so the preposition half has exactly one
 * home. Alternation ORDER is not load-bearing here: every alternative is fenced by `\s+` on both sides, so
 * no word can match inside another (` into ` cannot match the `in` branch, which needs whitespace straight
 * after `in`), and the corpus diff over the whole book confirms the composed pattern selects the same
 * boundaries the literal did.
 */
const INSTRUCTION_BOUNDARY = new RegExp(`\\s+(?:${[...PREPOSITIONS, ...CONNECTIVES].join('|')})\\s+|[,;:(]`, 'g');

/** One whitespace character — the fence {@link partitiveOfAt} walks, a character at a time. */
const WHITESPACE = /\s/;

/**
 * The index where a partitive `of` begins — the start of the whitespace run in front of it — or `-1`.
 *
 * The partitive is what introduces the substance a measure phrase MEASURES — `a bowl OF flour`.
 *
 * ⚠️ Not a boundary and never cut at: it is the seam that ENDS a measure phrase, which is what makes the
 * word-anywhere scan {@link measurePhraseOf} feeds safe. Everything before it is the measure; everything
 * after it is the food. `one pound of pot roast` therefore offers the scan `one pound` and never `pot`.
 *
 * ⛔ NOT a regex, and not by preference. This shipped as `PARTITIVE_OF = /\s+of\s+/` and CodeQL flagged
 * it (`js/polynomial-redos`, 2026-08-26): two UNANCHORED `\s+` quantifiers around a literal, retried at
 * every start position, with the leading one consuming the whole run before backtracking to look for `o`.
 * MEASURED at 20k spaces: 68.4ms as a regex, 0.09ms as this scan.
 *
 * ⚠️ This is the SECOND instance of that shape in this package — `splitMeasurement.ts` carries the first
 * with its own measurement — and `INSTRUCTION_BOUNDARY` above is a THIRD, recorded as residual risk in
 * ADR-0026 §7a rather than fixed here. If a fourth arrives, the lesson is the shape, not the file: an
 * unanchored quantifier on either side of something that can FAIL to match.
 *
 * The scan is linear: each candidate is an `of` found by `indexOf`, and the walk back over its leading
 * whitespace cannot revisit a character a previous candidate already walked.
 *
 * @param span - The span to scan.
 * @returns The match start, or `-1`. Pure.
 */
function partitiveOfAt(span: string): number {
    for (let at = span.indexOf('of'); at >= 0; at = span.indexOf('of', at + 1)) {
        const before = at - 1;
        const after = at + 2;

        if (before < 0 || after >= span.length) {
            continue;
        }

        if (!WHITESPACE.test(span[before] as string) || !WHITESPACE.test(span[after] as string)) {
            continue;
        }

        let start = at;

        while (start > 0 && WHITESPACE.test(span[start - 1] as string)) {
            start -= 1;
        }

        return start;
    }

    return -1;
}

/**
 * Bound one accepted span at the end of its ingredient.
 *
 * @param span - The suffix of a clause that read as a quantified ingredient, in the source's own words.
 * @param precededBy - The clause text in FRONT of the span, in the source's own words — `''` when the span
 *   opens its clause. Only the last word of it is read, and only to answer whether a preposition governs
 *   the span. REQUIRED: see the module docstring on why a default would be a silent position claim.
 * @returns The bounded ingredient plus whatever was cut, or `instruction` when the span names no food at
 *   all. Pure and TOTAL — never throws, and answers for empty input.
 */
export function segmentClause(span: string, precededBy: string): ClauseSegment {
    const trimmed = span.trim();

    if (trimmed === '') {
        return { kind: 'instruction' };
    }

    const boundary = instructionBoundaryIn(trimmed);
    const measurePhrase = measurePhraseOf(trimmed, boundary);

    // ⛔ POSITION, AND IT RUNS BEFORE THE SECOND-FOOD GUARD. A vessel the clause governs with a preposition
    // names a PLACE, so the amount in front of it is an amount of equipment — `In a large mixing bowl
    // whip …`, which published an ingredient called `mixing bowl whip`.
    //
    // ⛔ The ordering does NOT reopen F3. F3's hazard was head-finality applied to a span whose cut had
    // been REFUSED, which reads the TAIL's noun; this test cannot see the tail at all, because
    // `measurePhraseOf` ends at or before `boundary` and is therefore a PREFIX of the head. That is a
    // property of the code, not a claim in a comment.
    //
    // ⚠️ The accepted cost, recorded in ADR-0026 §7a: a governed vessel span that ALSO carries a second
    // food is dropped whole. On this corpus that is `two eggs` in PEACH PUDDING — which the extractor's
    // own unit gate could never have kept anyway — traded against a fabricated ingredient it WAS
    // publishing. Under U22's `parsePipeline` the LLM leg could in principle have recovered it, and this
    // removes that possibility.
    if (measurePhrase !== null && isGovernedByAPreposition(precededBy) && mentionsAVessel(measurePhrase)) {
        return { kind: 'instruction' };
    }

    if (boundary === null) {
        // Nothing to cut. The span is an ingredient unless the whole of it names something that is not a
        // food — `a large preserving kettle`, which parses to `1 large :: preserving kettle` and clears
        // every structural gate the importer has.
        //
        // ⚠️ Head-final, and the ruling does NOT weaken it. A vessel that is the noun the span is ABOUT
        // measures nothing, so it is not a measure phrase in any position — which is why
        // `Line a large salad bowl with lettuce leaves` stays an instruction with no preposition in sight.
        return namesEquipment(trimmed)
            ? { kind: 'instruction' }
            : { kind: 'ingredient', span: trimmed, trailingInstruction: null };
    }

    const head = trimmed.slice(0, boundary).trim();
    const tail = trimmed.slice(boundary).trim();

    // ⛔ THE GUARD, AND IT RUNS FIRST. A tail naming a food of its own is not an instruction, and cutting
    // it would delete an amount the source printed. The whole span survives instead, for
    // `ParsedLine.foods` — which holds many — to carry.
    //
    // ⛔ Ordering is load-bearing. Judging equipment before this ran the head-final test on a span whose
    // cut was about to be REFUSED, so `a large kettle with two cups of sugar` came back `instruction` and
    // the sugar went with it. A refused cut yields the whole span and is never judged equipment at all;
    // equipment is only ever decided about a head the boundary actually takes.
    if (tail === '' || statesASecondFood(tail)) {
        return { kind: 'ingredient', span: trimmed, trailingInstruction: null };
    }

    // ⛔ `namesEquipment`, NOT `namesNoFood`. Asking the wider question here dropped
    // `Sift one cup of flour three times` — a stated amount of a real food — because the span ends on a
    // duration word. Only a VESSEL means "this span is not an ingredient".
    if (head === '' || namesEquipment(head)) {
        return { kind: 'instruction' };
    }

    return { kind: 'ingredient', span: head, trailingInstruction: tail };
}

/**
 * Cut a NAME down at the first instruction boundary, without the second-food guard.
 *
 * ⚠️ NOT {@link segmentClause} with the tail thrown away, and the difference is exactly that guard. A span
 * has somewhere to keep a second food — `ParsedLine.foods` holds many — so its cut is refused rather than
 * risked. A NAME has one field and no such place, and a name carrying a measurement
 * (`chocolate in one cup of water`) matches no catalog row at all, so nothing is gained by keeping it.
 * Two views of one lexicon, for two different consequences.
 *
 * ⚠️ "Without the guard" is not "unconditional", and the earlier wording overstated it: this still
 * refuses a boundary at offset 0 and one inside a quantity phrase, because both are properties of the
 * BOUNDARY rather than of the consequence. The offset-0 refusal is a deliberate behaviour change from the
 * `split(…)[0]` this replaced — that returned `''` for `', sifted'`, and `''` is what `proseRecipe`'s
 * empty-name check drops a line on. A name that is nothing but a boundary is now returned intact and the
 * caller's own `NOT_AN_INGREDIENT` gate judges it, which is the layer that owns that decision.
 *
 * ⚠️ It takes NO position, and that is the third difference. A name has already been lifted out of its
 * clause by a parse engine, so there is no clause left to be governed by — and a name has nowhere to keep
 * a vessel either way. Position is a question only a SPAN can be asked.
 *
 * @param name - The description a parse engine returned.
 * @returns The name up to the first instruction boundary that is really one. Pure and TOTAL.
 */
export function dropTrailingInstruction(name: string): string {
    const boundary = instructionBoundaryIn(name);

    return boundary === null ? name : name.slice(0, boundary).trim();
}

/**
 * The first instruction boundary that is really one.
 *
 * ⛔ A boundary INSIDE a quantity phrase is not a boundary (R29). `and` is in the lexicon and is also the
 * middle of `"One and one-half"`, which is verbatim in the committed corpus slice; cutting there hands
 * the engines `One` — the same third-of-the-stated-amount loss `splitClauses` already guards against one
 * layer up, and by the same mechanism.
 *
 * A boundary at offset 0 is refused too: there is no ingredient before it to keep.
 *
 * @param text - Any span or name.
 * @returns The offset of the boundary, or `null` when there is none. Pure.
 */
function instructionBoundaryIn(text: string): number | null {
    const phrases = findQuantityPhrases(text);

    for (const match of text.matchAll(INSTRUCTION_BOUNDARY)) {
        const at = match.index;

        if (at === 0 || phrases.some((phrase) => at >= phrase.start && at < phrase.end)) {
            continue;
        }

        return at;
    }

    return null;
}

/**
 * Whether the clause governs this span with a preposition — the POSITION half of the 2026-08-26 ruling.
 *
 * ⛔ The LAST word only, never "a preposition appears somewhere in front of this span". `Have a large
 * stew-pan half full of boiling water` is a real measurement of real water and the book prints it; reading
 * its `of` — or any preposition further back in the sentence — as the governor would delete it.
 *
 * ⚠️ A CONNECTIVE does not govern, so `Pour into jelly-glasses or one large mould` is not caught here.
 * It does not need to be: `one large mould` is head-final a vessel and the whole-span test already refuses
 * it. Teaching this function to see through a coordination would be a parse, for a case nothing needs.
 *
 * @param precededBy - The clause text in front of the span, or `''`.
 * @returns `true` when the span is the object of a preposition. Pure and TOTAL.
 */
function isGovernedByAPreposition(precededBy: string): boolean {
    return PREPOSITIONS.includes(lastWordOf(precededBy));
}

/**
 * The MEASURE PHRASE a span opens with — the text a preposition in front of it would govern.
 *
 * ⛔ A DELIMITER IS REQUIRED, and "or else the whole span" is the arm that must not exist. Without one
 * there is nothing separating the measure from the food, and the word-anywhere scan this feeds would then
 * run over a whole span — the exact test `notAFoodLexicon.ts`'s head-final discipline forbids, deleting
 * `with two pot roasts` and `in a pot roast`. Refusing to answer costs nothing: a bare governed vessel
 * phrase (`into a large preserving kettle`) is head-final a vessel and the whole-span test already refuses
 * it, so the delimiter requirement removes risk and no capability.
 *
 * ⛔ It is a PREFIX OF THE HEAD by construction, because it ends at or before the same `boundary` the
 * caller cut at. That is what makes the position test structurally unable to see the tail — which is the
 * whole reason it may run before the second-food guard without reopening F3.
 *
 * @param trimmed - The trimmed span.
 * @param boundary - The first real instruction boundary in it, or `null`.
 * @returns The measure phrase, or `null` when the span carries no delimiter at all. Pure.
 */
function measurePhraseOf(trimmed: string, boundary: number | null): string | null {
    const ends = [partitiveOfAt(trimmed), boundary ?? -1].filter((at) => at >= 0);

    return ends.length === 0 ? null : trimmed.slice(0, Math.min(...ends));
}

/**
 * Whether a tail names a food with a stated amount of its own.
 *
 * ⛔ Scanned from EVERY quantity phrase in the tail, not once from its start. `a pan with one cup of
 * water` reads from its start as `1 :: pan with one cup of water` — a quantity, no unit — and would clear
 * a single-parse guard while hiding a real second food one phrase further in. The phrase scan is the same
 * one `suffixStarts` uses, for the same reason.
 *
 * ⛔ The test is `namesNoFood`, NOT `unit !== null`. See the module docstring: the unit test deleted
 * `two eggs` (a food with no unit) and preserved `a large frying-pan` (a vessel with one), which is both
 * failure directions from a single wrong question.
 *
 * ⚠️ The name is BOUNDED before it is classified. A tail's own name carries the same residue a span does
 * — `one cup of water in a kettle` parses to the name `water in a kettle` — and asking the head-final
 * test about that reads `kettle` and throws away a real second food.
 *
 * @param tail - The text that would be cut off.
 * @returns `true` when cutting would delete a stated amount of a food. Pure.
 */
function statesASecondFood(tail: string): boolean {
    return findQuantityPhrases(tail).some((phrase) => {
        const parsed = parseIngredientLine(tail.slice(phrase.start));
        const food = dropTrailingInstruction(parsed.name).trim();

        return (
            parsed.quantity.kind !== 'absent' &&
            food !== '' &&
            !namesNoFood(food) &&
            // A unit that measures time, distance or temperature says the amount is not an amount of food,
            // however food-like the noun beside it reads.
            !(parsed.unit !== null && measuresNoSubstance(parsed.unit))
        );
    });
}
