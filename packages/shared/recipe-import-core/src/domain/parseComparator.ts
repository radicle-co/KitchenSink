/**
 * @module parseComparator — what the merged parse IS, and what the disagreement WAS (U19, KTD-11…KTD-12).
 *
 * DESIGN PATTERN: **Specification / Policy module**, deliberately the sibling of `evaluateProvenance`
 * (`recipes/domain/provenancePolicy.ts`) and `evaluateMappingScope` (`ingredients/domain/`), and shaped
 * like them on purpose: it answers from its inputs alone — no DB, no clock, no network, no engine handle —
 * so the whole decision can be exhausted as a truth table, which is what makes it defensible. The output
 * is a **discriminated union** whose `neither` member structurally carries no merged line, so "resolves
 * nothing" is a property of the type rather than a `null` check every caller has to remember.
 *
 * ## The two questions, computed INDEPENDENTLY
 *
 * A comparator that fused them would be subtly wrong in both directions. So:
 *
 *  1. **What is stored** is a field-level winner rule (KTD-11): amounts from the CRF, food identity and
 *     preparation from the LLM, and the WHOLE measure — phrase, unit and amount — from the LLM whenever the
 *     CRF named no unit at all (U36/U36a — see {@link llmRescuedTheMeasure}, limited to the HISTORICAL units
 *     until 2026-08-26, and {@link rescuedWinners}, which took the amount later the same day). Where the CRF
 *     DID name a unit but read no NUMBER, the amount alone comes from the LLM (U38 — see
 *     {@link llmRescuedTheAmount}). The merged line's {@link ParsedLine.provenance} IS that rule, evaluated
 *     — the merge reads the winner out of the provenance it is about to record, so the two cannot disagree.
 *  2. **What the disagreement was** is a shape, computed over a NORMALIZED view of both parses. Removing a
 *     disagreement never changes which engine's words are stored, and changing a winner never silently
 *     changes the reported shape.
 *
 * ## ⛔ CANONICALIZE BEFORE COMPARING — three steps, in order
 *
 * Measured over the corpus, 168 of the 354 `differ` cases are not disagreements at all:
 *
 *  1. **`size` → `name` (24 lines).** The CRF emits a `size` field; `ParsedLine` deliberately has no slot
 *     for it (U16), so the adapter has nowhere but `prep` to put it — and `large` is an ADJECTIVE, which
 *     KTD-11b files as identity. This is therefore not a step of its own: the size vocabulary sits in
 *     {@link classifyModifier}'s adjective set and is moved by the ordinary placement rule, "exactly as
 *     misplaced modifiers are". A special case for `large` would reopen `sweet`, `brown` and `Italian`.
 *  2. **Placement, through KTD-11b (128 lines).** A past participle and a temperature go to `prep`, an
 *     adjective to `name`, on BOTH engines' answers, and only then are they compared. The vocabulary and
 *     the library-first finding behind it live in `modifierLexicon.ts`.
 *  3. **Stopwords and duplicates (40 lines).** The CRF keeps the relative-clause scaffolding the LLM drops
 *     (`that have been boiled soft` vs `boiled soft`), and the LLM sometimes emits one modifier into BOTH
 *     `name` and `prep` — a defect in one answer, not a disagreement between two.
 *
 * ## ⚠️ NORMALIZING FOR COMPARISON MUST NOT NORMALIZE WHAT IS STORED
 *
 * The line between steps 2 and 3 is exactly this, and it is the line this module must not cross:
 *
 *  - **Placement KEEPS every word** and only decides which field holds it. KTD-11b is "the definition
 *    `prep` carries system-wide, including the write-path field in U26", so a stored parse filing
 *    `chopped` under identity would contradict the schema it is stored against. Placement therefore
 *    applies to the merged line too — and when it moves nothing, the food is returned byte-identical.
 *  - **Stopword removal and de-duplication DELETE words**, so they exist only in the comparator's view.
 *    Storing them would quietly rewrite the corpus, which no later reader could detect or undo.
 *
 * ## ⛔ THE STATED MEASURE IS COMPARED, NEVER THE RESTATED ONE
 *
 * `statedMeasure.ts` records the defect this closes: U11's gate was shown `0.5 cup` beside a source
 * reading `one gill of milk` and asked whether they agreed. They do not — and the model was right to say
 * so, about a line parsed correctly. A restatement is one amount stated twice, so only
 * `splitMeasurement`'s `summed` parts enter the comparison and its `restated` parts are dropped.
 *
 * ## ⛔ AN UNAVAILABLE ENGINE IS NOT A DISAGREEMENT (KTD-12)
 *
 * `contractSkew.ts` states the rule this borrows: _"ABSENCE IS SILENCE, never a mismatch… Reporting those
 * as skew would make every pre-publication deployment noisy, which is how a real warning gets muted."_ A
 * CRF Lambda that threw, or an LLM denied by ADR-0024's ceiling, yields `single-engine` naming the engine
 * that ANSWERED — never `differ`. Collapsing the two turns a transient degradation into a permanent fact
 * about an ingredient, the error `resolutionCascade.ts` names for `unavailable` vs `consulted`.
 *
 * ⚠️ {@link EngineUnavailable} carries no reason, deliberately. The caller constructing it holds the error
 * and is the layer that reports it (U22: "a tier that throws is contained and reported"); relaying a
 * string through a pure policy that never reads it would be a second place for it to be wrong.
 *
 * ## ⚠️ Preconditions, stated rather than defended
 *
 * The two answers are parses of the SAME line — U20 keys the cache by `lineDigest`, so a pairing across
 * two different lines cannot arise — which is why {@link ParsedLine.raw} is carried through rather than
 * compared, and why `raw` is not a member of {@link ComparedFact} (it is not a member of `ParsedFacts`
 * either, which is what makes that a type-level fact rather than a convention).
 */
import { normalizeUnit, type IngredientQuantity } from '@kitchensink/recipe-core';

import type { IngredientReviewReason } from '../ingredientLine.js';
import type { ParsedFacts, ParsedFood, ParsedLine, ParseEngine, ParseProvenance } from '../parsedLine.js';
import { splitMeasurement } from '../splitMeasurement.js';

import { classifyModifier } from './modifierLexicon.js';

/**
 * An engine that produced no answer at all — a Lambda that threw, or a call the spend ceiling denied.
 *
 * A marker, not an error: see the module header on why no reason travels with it.
 */
export interface EngineUnavailable {
    /** The discriminant. `true` is its only inhabitant, so the shape cannot spell "available". */
    readonly unavailable: true;
}

/** What one engine handed the comparator: a parse, or nothing. */
export type EngineAnswer = ParsedLine | EngineUnavailable;

/**
 * A fact two engines can disagree about.
 *
 * ⛔ DERIVED from {@link ParsedFacts}, never enumerated — the same discipline `ParseProvenance` uses. A
 * fact added to the contract without a comparison rule is a compile error at {@link FACT_COMPARATORS}
 * rather than a field the comparator silently never looks at.
 */
export type ComparedFact = keyof ParsedFacts;

/** An outcome in which at least one engine answered, so there is a merged parse. */
export type ResolvedAgreement =
    | { readonly kind: 'agree' }
    | { readonly kind: 'differ'; readonly fields: readonly ComparedFact[] }
    | { readonly kind: 'single-engine'; readonly engine: ParseEngine };

/** What the two engines' answers amounted to. */
export type ParseAgreement = ResolvedAgreement | { readonly kind: 'neither' };

/**
 * The comparator's whole output.
 *
 * ⛔ A union rather than `{ merged: ParsedLine | null; agreement }`: "both unavailable resolves nothing"
 * is then a fact the TYPE carries, and a caller cannot read a merged line out of a `neither`.
 */
export type ParseComparison =
    | { readonly agreement: ResolvedAgreement; readonly merged: ParsedLine }
    | { readonly agreement: { readonly kind: 'neither' }; readonly merged: null };

/** Both engines' answers to one line, NAMED — so "which engine" is never "which argument position". */
export interface EngineAnswers {
    /** The conditional-random-field parser's answer (`ingredient-parser-nlp`). */
    readonly crf: EngineAnswer;
    /** The Bedrock parse leg's answer. */
    readonly llm: EngineAnswer;
}

/** Which field a token belongs in. */
type Field = 'name' | 'prep';

/**
 * Relative-clause scaffolding and articles one engine keeps and the other drops.
 *
 * ⛔ COMPARISON ONLY — see the module header. `and` is deliberately absent: within a single food's name it
 * is rare, and dropping it would let `salt and pepper` compare equal to `salt pepper`, erasing the one
 * signal that the line named more than one food.
 */
const COMPARISON_STOPWORDS: ReadonlySet<string> = new Set([
    'a',
    'an',
    'be',
    'been',
    'being',
    'had',
    'has',
    'have',
    'is',
    'it',
    'of',
    'that',
    'the',
    'them',
    'they',
    'was',
    'were',
    'which',
]);

/** Everything that is not a letter, a digit or an internal hyphen. */
const NON_WORD_EDGE = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;

/**
 * Split a phrase into words.
 *
 * @param text - A name or preparation, as an engine wrote it.
 * @returns Its whitespace-separated words, with empties dropped. Pure.
 */
function tokenise(text: string): readonly string[] {
    return text.split(/\s+/u).filter((token) => token !== '');
}

/**
 * Reduce a word to its comparable form.
 *
 * @param token - One word.
 * @returns Lower-cased and stripped of edge punctuation. Pure.
 */
function fold(token: string): string {
    return token.toLowerCase().replace(NON_WORD_EDGE, '');
}

/**
 * Decide where each word of one field belongs under KTD-11b.
 *
 * Resolved RIGHT TO LEFT so a qualifier can follow the word it qualifies (`finely chopped` travels
 * together, and a chain of them still resolves in one pass).
 *
 * @param tokens - One field's words, in order.
 * @param field - The field they are currently in, which is where an unknown word stays.
 * @returns One destination per token, positionally. Pure.
 */
function destinations(tokens: readonly string[], field: Field): readonly Field[] {
    const resolved: Field[] = new Array<Field>(tokens.length).fill(field);

    for (let index = tokens.length - 1; index >= 0; index -= 1) {
        switch (classifyModifier(tokens[index] ?? '')) {
            case 'preparation':
                resolved[index] = 'prep';
                break;
            case 'identity':
                resolved[index] = 'name';
                break;
            case 'qualifier':
                // It has no home of its own: it goes wherever the word to its right went.
                resolved[index] = resolved[index + 1] ?? field;
                break;
            case 'unclassified':
                resolved[index] = field;
                break;
        }
    }

    return resolved;
}

/**
 * Put every word of one food where KTD-11b says it belongs.
 *
 * ⛔ This is the ONE normalisation that also applies to what is STORED, because it deletes nothing — it
 * only decides which field holds a word the line already wrote. Two consequences are deliberate:
 *
 *  - **A name is never emptied.** If every word of the name wants to leave and nothing arrives to replace
 *    it, nothing moves. Identity is what the food catalog resolves; a food with an empty name is not a
 *    tidier record, it is a lost ingredient.
 *  - **A moved word is never doubled.** An engine that emitted `chopped` into both fields wrote it once in
 *    the source; placement can only put it in one field, and putting it in one field twice would be a word
 *    the line never wrote twice.
 *
 * @param food - One food, as an engine read it.
 * @returns The same food with its words re-placed — the SAME OBJECT when nothing moved, so a parse that
 *   was already canonical is returned byte-identical. Pure.
 */
function canonicaliseFood(food: ParsedFood): ParsedFood {
    const nameTokens = tokenise(food.name);
    const prepTokens = tokenise(food.prep ?? '');
    const nameDestinations = destinations(nameTokens, 'name');
    const prepDestinations = destinations(prepTokens, 'prep');

    const nameStays = nameTokens.filter((_, index) => nameDestinations[index] === 'name');
    const prepStays = prepTokens.filter((_, index) => prepDestinations[index] === 'prep');
    const toName = prepTokens.filter((_, index) => prepDestinations[index] === 'name');
    const toPrep = nameTokens.filter((_, index) => nameDestinations[index] === 'prep');

    if (toName.length === 0 && toPrep.length === 0) {
        return food;
    }

    // ⛔ The name is never emptied — see this function's docstring.
    const emptiesTheName = nameStays.length === 0 && toName.length === 0;
    const keptName = emptiesTheName ? nameTokens : nameStays;
    const movedToPrep = emptiesTheName ? [] : toPrep;

    const alreadyNamed = new Set(keptName.map(fold));
    const alreadyPrepared = new Set(prepStays.map(fold));

    const name = [...toName.filter((token) => !alreadyNamed.has(fold(token))), ...keptName].join(' ');
    const prep = [...prepStays, ...movedToPrep.filter((token) => !alreadyPrepared.has(fold(token)))].join(' ');

    return { name, prep: prep === '' ? null : prep };
}

/**
 * One food as the COMPARISON sees it: canonically placed, then stripped of what carries no reading.
 *
 * @param food - One food, as an engine read it.
 * @returns The folded words of its identity and its preparation. Pure.
 */
function foodComparisonView(food: ParsedFood): { readonly name: readonly string[]; readonly prep: readonly string[] } {
    const placed = canonicaliseFood(food);
    const name = tokenise(placed.name)
        .map(fold)
        .filter((token) => token !== '' && !COMPARISON_STOPWORDS.has(token));
    const named = new Set(name);
    const prep = tokenise(placed.prep ?? '')
        .map(fold)
        // ⛔ A word left in BOTH fields after placement is one engine's duplication defect. It is dropped
        // from the PREPARATION, never from the identity: a name eroded by de-duplication could compare
        // equal to a different food, which is the failure direction that cannot be recovered from.
        .filter((token) => token !== '' && !COMPARISON_STOPWORDS.has(token) && !named.has(token));

    return { name, prep };
}

/**
 * Whether two word lists say the same thing.
 *
 * @param left - One list.
 * @param right - The other.
 * @returns `true` when they hold the same words in the same order. Pure.
 */
function sameWords(left: readonly string[], right: readonly string[]): boolean {
    return left.length === right.length && left.every((word, index) => word === right[index]);
}

/**
 * Whether two engines read the same foods, in the same order.
 *
 * @param left - One engine's foods.
 * @param right - The other's.
 * @returns `true` when both lists agree food for food. Pure.
 */
function foodsAgree(left: readonly ParsedFood[], right: readonly ParsedFood[]): boolean {
    if (left.length !== right.length) {
        return false;
    }

    return left.every((food, index) => {
        const a = foodComparisonView(food);
        const b = foodComparisonView(right[index] as ParsedFood);

        return sameWords(a.name, b.name) && sameWords(a.prep, b.prep);
    });
}

/**
 * The measure phrase as the COMPARISON sees it.
 *
 * ⛔ Only the parts that ADD. A parenthesised equivalent (`one gill (½ cup)`) states one amount twice, and
 * comparing it whole manufactures the false disagreement `statedMeasure.ts` records.
 *
 * @param stated - The measure exactly as the source stated it, or `null`.
 * @returns Its summed words, folded and joined, or `null` when the phrase states nothing. Pure.
 */
function measureView(stated: string | null): string | null {
    if (stated === null || stated.trim() === '') {
        return null;
    }

    const words = splitMeasurement(stated)
        .summed.flatMap(tokenise)
        .map(fold)
        .filter((token) => token !== '');

    return words.length === 0 ? null : words.join(' ');
}

/**
 * A unit as the COMPARISON sees it.
 *
 * ⛔ IT DOES NOT LOWER-CASE (U35, owner ruling 2026-08-25). `normalizeUnit` already folds case for every
 * unit whose case is meaningless, and it is the only thing that knows the two spellings whose case is NOT:
 * `T` is a tablespoon and `t` is a teaspoon. A `.toLowerCase()` here was harmless while the normalizer
 * lower-cased unconditionally and became a MUTED SIGNAL the moment it stopped — both spellings would fold
 * to one canonical form, so one engine reading `T` while the other read `t` would be reported as
 * AGREEMENT, a threefold error the census could no longer see. Folding a unit before handing it to
 * `normalizeUnit` is never right; it cleans its own input.
 *
 * @param unit - The unit an engine read, or `null`.
 * @returns Its canonical spelling, or `null` when the line states none. `''` folds to `null` because the
 *   contract admits exactly one representation of "no unit". Pure.
 */
function unitView(unit: string | null): string | null {
    if (unit === null || unit.trim() === '') {
        return null;
    }

    return normalizeUnit(unit);
}

/**
 * Whether this engine stated a unit AT ALL.
 *
 * ⛔ TWO spellings of "it stated none", and both must answer `false`. {@link unitView} returns `null` for
 * an empty field and `''` for a field holding only what `normalizeUnit` strips — a bare `.` trims to
 * nothing — which is the same distinction `classifyUnit` guards when it calls that case `unknown`. A
 * caller testing `unitView(unit) !== null` reads the second as an ANSWER, and {@link llmRescuedTheMeasure}
 * would then publish punctuation as the measure of a line that stated none.
 *
 * @param unit - The unit an engine read, or `null`.
 * @returns `true` when the engine named a unit that survives canonicalisation. Pure.
 */
function statesAUnit(unit: string | null): boolean {
    const view = unitView(unit);

    return view !== null && view !== '';
}

/**
 * Whether this engine stated an AMOUNT at all.
 *
 * ⛔ The amount's sibling of {@link statesAUnit}, and it exists for the same reason: `absent` is the ONE
 * representation of "the phrase stated no number" — `readStatedMeasure` returns it for a phrase that states
 * nothing, for a number the column cannot hold, and for inverted bounds alike — so a caller asking "did this
 * engine read an amount?" must ask the KIND, never compare values.
 *
 * @param quantity - The amount an engine read.
 * @returns `true` when the engine read a number out of the phrase. Pure.
 */
function statesAnAmount(quantity: IngredientQuantity): boolean {
    return quantity.kind !== 'absent';
}

/**
 * Whether the two engines read the SAME unit — including both reading none.
 *
 * ⛔ ONE definition, used twice on purpose: it is the comparator's unit comparison AND the conjunct that
 * makes {@link llmRescuedTheAmount} safe. Two copies could drift, and the day they did, the merge would
 * join a number to a unit the comparison had already called a disagreement.
 *
 * @param crf - The CRF's parse.
 * @param llm - The LLM's parse.
 * @returns `true` when both engines' units canonicalise to the same thing. Pure.
 */
function unitsAgree(crf: ParsedLine, llm: ParsedLine): boolean {
    return unitView(crf.unit) === unitView(llm.unit);
}

/**
 * Whether two stated amounts are the same amount.
 *
 * @param left - One quantity.
 * @param right - The other.
 * @returns `true` when both state the same thing, `absent` included. Pure.
 */
function quantitiesAgree(left: IngredientQuantity, right: IngredientQuantity): boolean {
    if (left.kind !== right.kind) {
        return false;
    }

    switch (left.kind) {
        case 'exact':
            return right.kind === 'exact' && left.value === right.value;
        case 'range':
            return right.kind === 'range' && left.low === right.low && left.high === right.high;
        case 'absent':
            return true;
    }
}

/**
 * How each comparable fact is compared.
 *
 * ⛔ A total `Record` over {@link ComparedFact}, and the iteration order of its keys is the order
 * `differ.fields` reports — so the report is deterministic without a second list to keep in step. Adding a
 * fact to `ParsedFacts` fails to compile HERE, which is the property a hand-written list cannot have.
 */
const FACT_COMPARATORS: Readonly<Record<ComparedFact, (crf: ParsedLine, llm: ParsedLine) => boolean>> = {
    statedMeasure: (crf, llm) => measureView(crf.statedMeasure) === measureView(llm.statedMeasure),
    quantity: (crf, llm) => quantitiesAgree(crf.quantity, llm.quantity),
    unit: unitsAgree,
    foods: (crf, llm) => foodsAgree(crf.foods, llm.foods),
};

/** Every comparable fact, in the order a disagreement reports them. */
const COMPARED_FACTS = Object.keys(FACT_COMPARATORS) as readonly ComparedFact[];

/**
 * The winner of each fact when both engines answered and neither was blind (KTD-11).
 *
 * ⚠️ `foods: 'llm'` is the LLM's MEASURED strength on multi-food lines and on pulling a unit out of a food
 * name — NOT on placement. KTD-11 records the correction: scored against KTD-11b over the contested
 * modifier words the **CRF's filing matched 125 times to the LLM's 58**. Placement is settled by
 * canonicalisation above, which is strictly better than picking a side, and this entry must not be read as
 * evidence the LLM files modifiers better.
 */
const DEFAULT_WINNERS: ParseProvenance = {
    statedMeasure: 'crf',
    quantity: 'crf',
    unit: 'crf',
    foods: 'llm',
};

/**
 * Whether the CRF stated NO unit where the LLM stated one.
 *
 * The CRF folds a unit it has no vocabulary for into the food name, or drops it outright, and reads a bare
 * number. That is a KNOWN blindness, not a disagreement — §3's "absence is silence" one field down — so the
 * LLM takes the measure PHRASE and the UNIT, the two facts the blindness corrupts.
 *
 * ## ⛔ IT IS NOT LIMITED TO THE HISTORICAL UNITS (U36, owner ruling 2026-08-26)
 *
 * This predicate required `isHistoricalUnit(llm.unit)` on the second conjunct, because a `gill` was the
 * blindness that had been measured. Measured again over the 2,502-line 1919 corpus, the CRF's measure is a
 * bare number on **53** lines, of which **13** are a plain unit the LLM read — and only **4** of those 13
 * are historical. On the other nine `unit: 'crf'` won and the merged line carried **no unit at all**, which
 * is not the better of two readings but the publication of silence. The historical rescue is now a strict
 * SUBSET of this rule rather than the whole of it.
 *
 * ⛔ A SIZE WORD IS A VALID UNIT, and rejecting one as "fabricated" was proposed and DISPROVED. `four large`
 * (onions) is 7 of the 53, and the merged foods come from the LLM, which reads `onions` with `large` in the
 * unit — so refusing the unit does not merely blur the measure, it DELETES the word from both fields.
 * `unitToGrams` resolves a unit against the catalog's own portion LABELS, and USDA publishes those verbatim
 * from `modifier`/`portion_description`, which for eggs are literally `small`/`medium`/`large`. See ADR-0026
 * §8 for the full chain and for the two limitations this rule pins rather than closes.
 *
 * ⛔ IT REACHES ONLY THE ABSENT CASE. Two engines that each STATE a unit and state different ones is
 * `unitDiffers`, which KTD-11 sends to the CRF and this ruling explicitly leaves alone.
 *
 * @param crf - The CRF's parse.
 * @param llm - The LLM's parse.
 * @returns `true` when the LLM named a unit the CRF named none at all for. Pure.
 */
function llmRescuedTheMeasure(crf: ParsedLine, llm: ParsedLine): boolean {
    return !statesAUnit(crf.unit) && statesAUnit(llm.unit);
}

/**
 * The winners when {@link llmRescuedTheMeasure} fired — the WHOLE measure, amount included.
 *
 * ## ⛔ THE RESCUE CARRIES THE NUMBER (U36a, owner ruling 2026-08-26)
 *
 * U36 rescued the phrase and the unit and left the amount on the CRF, so `one and a half quarts of boiling
 * water` stored **`1 quart`** — the unit recovered and the amount still a third short. The owner's bar is
 * that we must not be _"blatantly incorrectly parsing measurement values"_, and that is one. The rescue's
 * own licence settles it: a CRF that named NO unit mis-segmented the whole measure phrase, so the number it
 * read out of that same phrase is the RESIDUE of one failure rather than independent evidence.
 *
 * Re-derived over the 2,502-line 1919 corpus (Nova Micro, 2026-08-26, through the real adapters) the rescue
 * fires on **115** lines, and taking the LLM's amount on them moves **69**: **57** where the CRF read no
 * amount at all and the merged line carried a unit with `ABSENT_QUANTITY`, **4** where it dropped a
 * fraction, and **8** where it collapsed a range to its low end. On 42 the two amounts already agree.
 *
 * ## ⛔ EXCEPT WHERE THE LLM'S PHRASE STATES NO AMOUNT — absence is silence, one field over
 *
 * Taken as "the whole measure, unconditionally" the ruling REGRESSES two measured lines: on `a large mixing
 * bowl whip to a cream two eggs` the LLM reads `large` as the entire measure and names no amount, so the
 * CRF's `2` would be replaced by nothing — DELETING an amount the source plainly states, which is the same
 * failure the ruling exists to stop. So this narrows it, and not by special case: §3's "ABSENCE IS SILENCE,
 * never dissent" is the rule the whole rescue rests on, and an `absent` amount is no more a competing
 * reading of the number than an absent unit was of the unit.
 *
 * ⛔ IT STILL REACHES ONLY THE RESCUED BRANCH. {@link DEFAULT_WINNERS} keeps `quantity: 'crf'`, so KTD-11's
 * `quantityDiffers → crfWins` governs every line on which both engines named a unit — untouched.
 *
 * ⚠️ It changes only what is STORED. A number the CRF DID state and read differently is dissent, not the
 * silence `statedMeasure` and `unit` are silenced for, so `differ: ['quantity']` is still reported on every
 * one of those 69 lines — including `a cup the whites of three eggs`, the one garbled line where neither
 * reading is clearly right and a human is the only adjudicator.
 *
 * @param llm - The LLM's parse, the only engine whose reading decides anything here.
 * @returns The winner of each fact on a rescued line. Pure.
 */
function rescuedWinners(llm: ParsedLine): ParseProvenance {
    return {
        ...DEFAULT_WINNERS,
        statedMeasure: 'llm',
        unit: 'llm',
        quantity: statesAnAmount(llm.quantity) ? 'llm' : 'crf',
    };
}

/**
 * Whether the LLM read an AMOUNT the CRF read none for, on a measure they read the same unit in.
 *
 * ## ⛔ §3's PRINCIPLE, ONE FIELD OVER AGAIN (U38, owner ruling 2026-08-28)
 *
 * `quantityDiffers → crfWins` counted the CRF's SILENCE as a vote. Measured on the first import the
 * pipeline decided — 349 recipes — **206 of 1,808 stored lines (11.4%) carried no quantity at all**, where
 * the library parser it replaced always produced one; re-running both engines over a 40-line sample found
 * the LLM stating an amount the CRF did not on **31 of 40 (78%)**. `a cup of water` is the shape: the CRF
 * returns the measure text `cup` — the unit, and no number — while the LLM reads one cup.
 *
 * ⛔ IT REACHES ONLY THE ABSENT CASE. Two engines that each READ a number and read different ones is
 * `quantityDiffers`, which KTD-11 sends to the CRF and this ruling explicitly leaves alone — as is the
 * mirror, an LLM that read no number against a CRF that did (§8a's own guard, one rule over).
 *
 * ## ⛔ AND ONLY WHERE THE UNITS AGREE — otherwise the merge MANUFACTURES a measure
 *
 * The conjunct is not decoration. Measured on `a dozen small cantaloupes`: the CRF reads the measure text
 * `dozen` (a unit, of an amount it never found) while the LLM folds that same word into the number `12`.
 * Taking the number from one engine and the unit from the other stores **`12 dozen`** — one word counted
 * twice, in a reading neither engine gave, and exactly the _"blatantly incorrect measurement value"_ §8's
 * acceptance bar rules out. Where both engines read the same unit — including where neither read one — there
 * is no second reading of the word to double-count.
 *
 * ⚠️ So the declined band keeps `crfWins` and is REPORTED: two engines that decompose the phrase
 * differently disagree about the whole measure, which is U23's oracle to adjudicate rather than this rule's.
 * ADR-0026 §8c records it open.
 *
 * ⚠️ IT CANNOT COLLIDE WITH {@link llmRescuedTheMeasure}, and not because of the order they are asked in:
 * that rescue REQUIRES the CRF to have named no unit against an LLM that named one, which is a unit
 * DISAGREEMENT, while this one requires the units to agree. No pair satisfies both — asserted over the whole
 * unit × amount matrix in `parseComparator.test.ts`, because a reordering mutant otherwise survives silently.
 *
 * @param crf - The CRF's parse.
 * @param llm - The LLM's parse.
 * @returns `true` when the LLM read an amount the CRF read none for, and neither engine's unit is in
 *   dispute. Pure.
 */
function llmRescuedTheAmount(crf: ParsedLine, llm: ParsedLine): boolean {
    return !statesAnAmount(crf.quantity) && statesAnAmount(llm.quantity) && unitsAgree(crf, llm);
}

/**
 * The winners when the measure rescue did NOT fire — KTD-11's rule, with U38's amount carve-out.
 *
 * ⛔ ONLY the amount moves. The CRF stated the phrase and the unit here, so neither is silence, and taking
 * either would reach `unitDiffers` — the column §8 kept with the CRF.
 *
 * @param crf - The CRF's parse.
 * @param llm - The LLM's parse.
 * @returns The winner of each fact. Pure.
 */
function winnersWithoutAMeasureRescue(crf: ParsedLine, llm: ParsedLine): ParseProvenance {
    return llmRescuedTheAmount(crf, llm) ? { ...DEFAULT_WINNERS, quantity: 'llm' } : DEFAULT_WINNERS;
}

/**
 * Every review reason either engine raised, once each.
 *
 * ⛔ A UNION, not the winner's list. A reason means the same thing whichever reader raised it, and
 * dropping the loser's would discard a signal about the very line the two engines could not agree on.
 *
 * @param crf - The CRF's reasons.
 * @param llm - The LLM's reasons.
 * @returns The CRF's reasons in order, then any of the LLM's that are new. Pure.
 */
function unionReasons(
    crf: readonly IngredientReviewReason[],
    llm: readonly IngredientReviewReason[],
): readonly IngredientReviewReason[] {
    return [...new Set([...crf, ...llm])];
}

/**
 * Type guard for the absent half of {@link EngineAnswer}.
 *
 * @param answer - What an engine handed back.
 * @returns `true` when the engine produced no answer. Pure.
 */
function isUnavailable(answer: EngineAnswer): answer is EngineUnavailable {
    return 'unavailable' in answer;
}

/**
 * The merged line when exactly one engine answered.
 *
 * @param parse - The answering engine's parse.
 * @param engine - Which engine that was.
 * @returns Its parse, placed canonically, attributed wholly to it. Pure.
 */
function fromOneEngine(parse: ParsedLine, engine: ParseEngine): ParsedLine {
    return {
        raw: parse.raw,
        statedMeasure: parse.statedMeasure,
        quantity: parse.quantity,
        unit: parse.unit,
        foods: parse.foods.map(canonicaliseFood),
        reviewReasons: [...parse.reviewReasons],
        provenance: { statedMeasure: engine, quantity: engine, unit: engine, foods: engine },
    };
}

/**
 * Decide what the merged parse is, and what the disagreement was.
 *
 * @param answers - Both engines' answers to the SAME line (see the module header on that precondition).
 * @returns The merged parse and the agreement — or `neither` with no merged line when both engines were
 *   unavailable. Pure and TOTAL: every combination of two answers has an outcome, and neither input is
 *   read for anything but its facts, so the result does not depend on which key was written first.
 */
export function compareParses(answers: EngineAnswers): ParseComparison {
    const crf = isUnavailable(answers.crf) ? null : answers.crf;
    const llm = isUnavailable(answers.llm) ? null : answers.llm;

    // ⛔ KTD-12. One engine silent is `single-engine`, never `differ` — there is nothing to differ WITH,
    // and no shape of the answering engine's parse can change that.
    if (crf === null) {
        return llm === null
            ? { agreement: { kind: 'neither' }, merged: null }
            : { agreement: { kind: 'single-engine', engine: 'llm' }, merged: fromOneEngine(llm, 'llm') };
    }

    if (llm === null) {
        return { agreement: { kind: 'single-engine', engine: 'crf' }, merged: fromOneEngine(crf, 'crf') };
    }

    // The measure rescue is the WIDER rule — it takes the phrase and the unit as well, and §8a has it decide
    // the amount on its own terms — so it is asked first. ⚠️ That order is documentation, NOT logic: the two
    // rescues are disjoint (see `llmRescuedTheAmount`), and asking them the other way round changes no
    // answer. The invariant the order would otherwise protect is asserted directly in the suite.
    const rescued = llmRescuedTheMeasure(crf, llm);
    const provenance: ParseProvenance = rescued ? rescuedWinners(llm) : winnersWithoutAMeasureRescue(crf, llm);

    // The merge reads its winner out of the provenance it is about to record, so a value and its
    // attribution cannot disagree.
    const winnerOf = (fact: ComparedFact): ParsedLine => (provenance[fact] === 'crf' ? crf : llm);

    const merged: ParsedLine = {
        raw: crf.raw,
        statedMeasure: winnerOf('statedMeasure').statedMeasure,
        quantity: winnerOf('quantity').quantity,
        unit: winnerOf('unit').unit,
        foods: winnerOf('foods').foods.map(canonicaliseFood),
        reviewReasons: unionReasons(crf.reviewReasons, llm.reviewReasons),
        provenance,
    };

    // A fact the LLM rescued is not a fact the engines disagreed about: it is one the CRF is known to be
    // blind to, and reporting it would flag every historical measure in the corpus.
    const silenced: ReadonlySet<ComparedFact> = rescued ? new Set<ComparedFact>(['statedMeasure', 'unit']) : new Set();
    const fields = COMPARED_FACTS.filter((fact) => !silenced.has(fact) && !FACT_COMPARATORS[fact](crf, llm));

    return fields.length === 0
        ? { agreement: { kind: 'agree' }, merged }
        : { agreement: { kind: 'differ', fields }, merged };
}
