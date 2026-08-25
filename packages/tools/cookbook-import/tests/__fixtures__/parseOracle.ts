/**
 * @module parseOracle — THE ORACLE (U23): what a corpus line's parse SHOULD say, and which written rule
 * said so.
 *
 * DESIGN PATTERN: **Specification carried as committed data.** The rubric is a total `Record` from a clause
 * id to a statement plus the source that statement is taken from; the census is a list of real corpus lines,
 * each carrying the clause that decided it. Nothing here computes a verdict — a verdict that could be
 * computed would be a parser, and a parser is what this exists to judge.
 *
 * ## ⛔⛔ WHY THE ORACLE IS A RUBRIC AND NOT A JUDGEMENT
 *
 * The plan's constraint is verbatim and it is the whole design of this file:
 *
 * > _"The oracle is not me, and not a model from either engine's family. The bake-off measured
 * > self-preference at −31.5 points; an LLM adjudicating an LLM's parse against a CRF's is the same failure
 * > with an extra step. Either the owner rules, or the oracle is a written rubric applied by diverse lenses
 * > with the rule recorded — never a single model's opinion presented as ground truth."_
 *
 * So every ruling below names the clause that produced it, every clause names where it was ruled, and a line
 * the rubric does not reach is `undecided` — a first-class outcome carrying three lenses, never a verdict
 * dressed as one. ⛔ **If you are about to add a case whose verdict you cannot attach a clause to, it is
 * `undecided`.** That is not a gap in the oracle; it is the oracle working.
 *
 * ## ⛔ IT IS NOT THE PREVIOUS PARSER, AND THE BOUNDARY IS WORTH STATING
 *
 * _"Chaining a rewrite to its immediate predecessor lets a drift introduced in step N be blessed forever by
 * step N+1."_ Every reading below is written out by hand from the rubric. `parseIngredientLine`'s output was
 * never copied into one, and where a shipped reader was consulted at all it was as CORROBORATION after the
 * fact and only about ARITHMETIC — that `one and a half` is 1.5 — never about identity, placement or which
 * words are a food. Those are exactly the judgements the pipeline is being replaced over.
 *
 * ## ⚠️ WHAT POPULATION THIS IS A CENSUS OF — read this before quoting any rate off it
 *
 * The plan expects the residual adjudication list to be _"~130 lines, not 354"_ after KTD-11b, U19 and U22a.
 * ⛔ **That list could not be reconstructed.** It is defined by where the two ENGINES disagree, and the
 * comparison report's §9.6 says the re-run is still owed: _"The engines were not re-run… No new agreement,
 * determinism or cost figure is claimed."_ The LLM leg needs billed Bedrock, no prior trial output is
 * committed anywhere in this repository, and a stale answer would in any case be an answer about text U22a
 * has since changed for 287 spans.
 *
 * What IS reproducible for free is the CRF leg and the post-U22a corpus. So this census is denominated in a
 * population that can be rebuilt on any machine with the pinned engine installed:
 *
 * > **every distinct RUBRIC SITUATION — a clause plus the contested word it fires on — in the 1,298 distinct
 * > ingredient lines the post-U22a extractor produces, judged against the CRF's own reading.**
 *
 * 331 lines fire at least one clause; they collapse to the situations enumerated here, and
 * {@link OracleCase.occurrences} carries how many lines each one stands for. ⚠️ **This is not the plan's
 * population and must not be reported as though it were.** It is the half that could be measured without
 * spending; the LLM half is unmeasured and stays unmeasured until the owner authorises the re-run.
 *
 * ⚠️ Deduplicating by situation is deliberate, and it is the same anti-vacuity concern read in the other
 * direction: adjudicating `cold water` twenty-six times would inflate every count here without adding one
 * decision. The count is preserved instead of the repetition.
 */

/** A clause of the written rubric. The ids are stable; a ruling cites one. */
export type RubricClause =
    | 'R1'
    | 'R2'
    | 'R3'
    | 'R4'
    | 'R5'
    | 'R6'
    | 'R7'
    | 'R8'
    | 'R9'
    | 'R10'
    | 'R11'
    | 'R12'
    | 'R13'
    | 'R14';

/** Every clause, in the order the rubric states them. */
export const RUBRIC_CLAUSES: readonly RubricClause[] = Object.freeze([
    'R1',
    'R2',
    'R3',
    'R4',
    'R5',
    'R6',
    'R7',
    'R8',
    'R9',
    'R10',
    'R11',
    'R12',
    'R13',
    'R14',
]);

/** One clause: what it says, and where it was ruled. */
export interface RubricClauseRecord {
    /** The rule, stated so that applying it needs no further judgement. */
    readonly statement: string;
    /**
     * Where the rule comes from — the document or module, and what it says there.
     *
     * ⛔ A clause with no source is a clause somebody invented. {@link RubricClauseRecord.invented} says so
     * out loud rather than leaving a reader to notice an empty string.
     */
    readonly source: string;
    /**
     * `true` when this clause was NOT found in a prior ruling and was written for this oracle.
     *
     * ⚠️ An invented clause is not forbidden — some are unavoidable — but it must announce itself, and its
     * statement must contain the word `INVENTED` so a reader skimming the rubric cannot miss it. The unit
     * suite asserts both halves.
     */
    readonly invented: boolean;
}

/**
 * THE RUBRIC.
 *
 * ⛔ Every clause here is taken from a ruling that already existed. None is invented — which is a fact
 * about this corpus, not a rule about future clauses: a line needing a rule nobody has written is exactly
 * what `undecided` is for, and inventing one to close it would be the failure the plan names.
 */
export const PARSE_RUBRIC: Readonly<Record<RubricClause, RubricClauseRecord>> = Object.freeze({
    R1: {
        statement: "The subject is the source's own words. Nothing is corrected toward a friendlier reading.",
        source: '`parseCorpus.ts`: the corpus is "the verbatim words of a public-domain 1919 cookbook… Nothing is authored, paraphrased or generated." `notAFoodLexicon.ts`: removing a word from a food would be "rewriting an ingredient to find a friendlier catalog match, which is the massaging that corrupts the resolution measurement."',
        invented: false,
    },
    R2: {
        statement: 'A past participle is PREPARATION.',
        source: 'KTD-11b (owner ruling 2026-08-23, `docs/plans/2026-08-20-001-fix-ingredient-resolution-quality-plan.md`): "A **past participle is preparation** (`chopped`, `grated`, `melted`, `sifted`, `minced`, `stoned`, `beaten`)." Implemented as `IRREGULAR_PARTICIPLES` plus the `-ed` suffix rule in `modifierLexicon.ts`.',
        invented: false,
    },
    R3: {
        statement: 'An adjective is IDENTITY, and belongs in the food name.',
        source: 'KTD-11b: "An **adjective is identity** (`sweet`, `brown`, `pastry`, `Russian`, `fresh`, `red`, `green`)." `parsedLine.ts` carries it into the contract: `ParsedFood.name` "carries every ADJECTIVE (KTD-11b)… An adjective says WHICH food this is."',
        invented: false,
    },
    R4: {
        statement: 'TEMPERATURE is preparation, even though every temperature word is an adjective.',
        source: 'KTD-11b: "**Temperature is preparation** (`hot`, `cold`, `boiling`, `lukewarm`, `warm`) — the middle case, committed deliberately." ADR-0026 §5 records the decisive evidence: NLTK\'s tagger contradicts the ruling on 7 of 25 words including `hot`/`cold`/`warm` → `JJ`, and "a tagger cannot implement a definition that isn\'t a claim about English."',
        invented: false,
    },
    R5: {
        statement:
            'The adjective list is consulted BEFORE the `-ed` suffix rule, so a word that is an adjective is identity however it ends.',
        source: '`modifierLexicon.ts`, `classifyModifier`: "⛔ THE ORDER OF THESE TESTS IS THE RULING. The adjective set is consulted before the `-ed` suffix rule, because that is what keeps `red` a colour." The suffix rule is therefore a HEURISTIC standing in for the ruling, not the ruling itself.',
        invented: false,
    },
    R6: {
        statement:
            'There is no `size` field. `large`, `small` and `medium` are adjectives and canonicalise into the name.',
        source: '`parsedLine.ts`: "⛔ `size` IS NOT A MEMBER — owner ruling 2026-08-24… it let a third-party parser\'s output shape our schema. `large` is an adjective, and KTD-11b already rules that an adjective is IDENTITY." KTD-11\'s shape table disposes of `crfSizeField` as "canonicalised into `name`".',
        invented: false,
    },
    R7: {
        statement:
            'A conjunction joins two measurements only when a DIGIT follows it. `one and a half` carries its "and" inside one amount and states 1.5, not 1.',
        source: '`splitMeasurement.ts`, `MEASUREMENT_JOIN_SOURCE`: "⛔ Requires a DIGIT after the conjunction. `one and a half cups` and `two and a half pounds` both carry \'and\' inside the amount, and a bare word match would cut them in half" — the shipped defect where "One and one-half cups" published as 0.5 cups with `needsReview: false`.',
        invented: false,
    },
    R8: {
        statement:
            'A parenthetical RESTATES an amount and never adds to it; only the summed parts are the stated measure.',
        source: '`splitMeasurement.ts`: additive vs equivalent vs container-and-net — "Only the first sums. Reading an equivalent as additive DOUBLES the ingredient, silently, and nothing downstream can detect it." `parseComparator.ts`: "THE STATED MEASURE IS COMPARED, NEVER THE RESTATED ONE."',
        invented: false,
    },
    R9: {
        statement: 'A span whose head noun is a VESSEL is not an ingredient at all.',
        source: '`notAFoodLexicon.ts`, `namesEquipment`: "⛔ Vessels only, deliberately." `clauseSegmentation.ts`: `a large preserving kettle` "parses to `1 large :: preserving kettle` and clears every structural gate the importer has" and is equipment, not a food.',
        invented: false,
    },
    R10: {
        statement:
            'A unit measuring time, distance, temperature or people is not a measure of an ingredient, and a tail about one is residue rather than a second food.',
        source: '`notAFoodLexicon.ts`, `measuresNoSubstance` / `NOT_A_MEASURE`: "a DIMENSION is not a measure of an ingredient", recorded with the live defect where "two inches square" parsed as `2 inche :: square` "and landed on a PUBLIC recipe carrying a real `food_id` — a nutrition claim derived from a measurement of a knife cut."',
        invented: false,
    },
    R11: {
        statement:
            'The CRF is blind to historical units and folds them into the food name. On that shape the LLM takes the measure phrase AND the unit — never the quantity.',
        source: 'KTD-11 shape table: `crfUnitInName` → "**LLM wins silently** — the CRF is demonstrably wrong (`\\"a little vinegar\\"`)". ADR-0026 Consequences: "the LLM taking the measure phrase **and** the unit when the CRF was blind to a historical unit, and never the quantity, because missing the unit does not stop the CRF reading the leading number."',
        invented: false,
    },
    R12: {
        statement: 'On a line naming several foods where the CRF named one, the LLM wins.',
        source: 'KTD-11 shape table: `modelSplitsFoods` → "**LLM wins silently** — this is the multi-food case the CRF cannot express." `ParsedFacts.foods` holds "every food the line named, in the order the line named them."',
        invented: false,
    },
    R13: {
        statement:
            "The amounts are the CRF's — stated measure, quantity and unit — and the losing reading is recorded beside the winner rather than discarded.",
        source: 'ADR-0026 Consequences: "A **field-level winner rule**, not a whole-line one: `statedMeasure`, `quantity` and `unit` from the CRF, `foods` from the LLM." KTD-11 shape table: `quantityDiffers` / `unitDiffers` / `amountCountDiffers` → "CRF wins, record both".',
        invented: false,
    },
    R14: {
        statement:
            'An engine that did not answer is ABSENCE, never dissent: the outcome is `single-engine`, and it is not a disagreement about the line.',
        source: 'ADR-0026 §3: "A CRF Lambda that threw, or an LLM call ADR-0024\'s ceiling denied, is **absence, not dissent**." `contractSkew.ts`, quoted there: "ABSENCE IS SILENCE, never a mismatch… Reporting those as skew would make every pre-publication deployment noisy, which is how a real warning gets muted."',
        invented: false,
    },
});

/**
 * The measure regimes the plan requires the census to cover.
 *
 * ⛔ This list is the anti-vacuity contract. `oracleRegimeCensus` counts every member, and the unit suite
 * fails — naming the regime — when any count is zero. The plan is explicit about why: "randomised suites
 * fail silently by generating uninteresting data."
 */
export type OracleRegime =
    | 'singleAmount'
    | 'composite'
    | 'range'
    | 'multiFood'
    | 'historicalUnit'
    | 'prep'
    | 'subjectiveMeasure';

/** Every regime, in the order the plan lists them. */
export const ORACLE_REGIMES: readonly OracleRegime[] = Object.freeze([
    'singleAmount',
    'composite',
    'range',
    'multiFood',
    'historicalUnit',
    'prep',
    'subjectiveMeasure',
]);

/**
 * How much a line calls for.
 *
 * ⚠️ Mirrors recipe-core's `IngredientQuantity` in shape rather than importing it, so the oracle stays a
 * hand-written statement of the requirement and cannot silently track a change to the model it judges.
 * `absent` is never a fabricated `1` — the same rule `ParsedFacts.quantity` states.
 */
export type OracleAmount =
    | { readonly kind: 'exact'; readonly value: number }
    | { readonly kind: 'range'; readonly low: number; readonly high: number }
    | { readonly kind: 'absent' };

/** One food the line names, and what the line says is done to it. */
export interface OracleFood {
    readonly name: string;
    /** `null` when the line says nothing. Never `''` — an empty string is a second spelling of nothing. */
    readonly prep: string | null;
}

/** What the rubric says the line's parse should be. */
export interface OracleReading {
    /** The measure phrase in the source's own words, or `null` when it states none. */
    readonly statedMeasure: string | null;
    readonly quantity: OracleAmount;
    /** The unit, or `null` when the line states none. */
    readonly unit: string | null;
    /** Every food the line names, in the order it names them. May be empty — a line can name none. */
    readonly foods: readonly OracleFood[];
}

/**
 * The three lenses an undecided case was looked at through.
 *
 * ⛔ Recorded rather than averaged. The plan: "If lenses disagree, the case is `undecided`. Do not average
 * them into a false verdict." A lens is a question with a stated answer, not a score.
 */
export interface OracleLenses {
    /** Does a cook reading the line aloud hear a food's NAME, or a thing done to a food? */
    readonly cookAloud: string;
    /** Which reading names something the ingredient catalog could hold as a row? */
    readonly catalog: string;
    /** Does the book's own sentence support either reading? */
    readonly sourceSentence: string;
}

/** What the rubric made of one line. */
export type OracleVerdict =
    | {
          readonly kind: 'ruled';
          /** ⛔ The clause that decided it. A ruling without one is an opinion wearing a rubric's clothes. */
          readonly clause: RubricClause;
          readonly reading: OracleReading;
          readonly note: string;
      }
    | {
          readonly kind: 'undecided';
          readonly lenses: OracleLenses;
          /** Why no clause reaches it — and, where there is one, the gap the owner would have to close. */
          readonly note: string;
      };

/** One adjudicated rubric situation. */
export interface OracleCase {
    /**
     * The corpus line id — the trial index — so a failure reports a seed rather than "it happened once".
     *
     * ⚠️ Positional and stable: `buildParseCorpus` numbers `L00001…` in book order over the de-duplicated
     * corpus. A change to the extractor renumbers it, which is exactly when this census is owed a re-run.
     */
    readonly seed: string;
    /** The book's own words for the line this situation was first found on. */
    readonly line: string;
    /**
     * How many of the 1,298 distinct ingredient lines this one situation stands for.
     *
     * ⚠️ Never 0. The situation was found BY reading the corpus, so a zero would mean the census had drifted
     * off the population it claims to describe.
     */
    readonly occurrences: number;
    readonly regimes: readonly OracleRegime[];
    readonly verdict: OracleVerdict;
}

/** A case the rubric decided. */
export type RuledOracleCase = OracleCase & { readonly verdict: Extract<OracleVerdict, { kind: 'ruled' }> };

/** A case no clause reached. */
export type UndecidedOracleCase = OracleCase & { readonly verdict: Extract<OracleVerdict, { kind: 'undecided' }> };

/**
 * Whether the rubric decided this case.
 *
 * ⚠️ A type guard rather than an inline `kind` check, so a caller reading `verdict.clause` gets it from
 * narrowing rather than from a cast. A cast would let a future member of {@link OracleVerdict} through
 * silently, which is the one thing a discriminated union exists to prevent.
 *
 * @param entry - Any case.
 * @returns `true` when a clause decided it. Pure.
 */
export function isRuledOracleCase(entry: OracleCase): entry is RuledOracleCase {
    return entry.verdict.kind === 'ruled';
}

/**
 * Whether this case reached no clause.
 *
 * @param entry - Any case.
 * @returns `true` when it is in the undecided bucket. Pure.
 */
export function isUndecidedOracleCase(entry: OracleCase): entry is UndecidedOracleCase {
    return entry.verdict.kind === 'undecided';
}

const exact = (value: number): OracleAmount => ({ kind: 'exact', value });
const range = (low: number, high: number): OracleAmount => ({ kind: 'range', low, high });
const absent: OracleAmount = { kind: 'absent' };

/**
 * THE CENSUS — every distinct rubric situation in the post-U22a corpus, read end to end.
 *
 * Ordered by seed, which is book order. ⚠️ Read the `note` on each entry: several rulings are correct AND
 * uncomfortable (KTD-11b's own accepted edge, `dried figs`), and several `undecided` entries are not the
 * rubric failing to have an opinion but the rubric's HEURISTIC half producing one its own trap note
 * disowns.
 */
export const PARSE_ORACLE: readonly OracleCase[] = Object.freeze([
    {
        seed: 'L00025',
        line: 'a saltspoon of salt',
        occurrences: 3,
        regimes: ['historicalUnit', 'singleAmount'],
        verdict: {
            kind: 'ruled',
            clause: 'R11',
            reading: {
                statedMeasure: 'a saltspoon',
                quantity: exact(1),
                unit: 'saltspoon',
                foods: [{ name: 'salt', prep: null }],
            },
            note: 'The CRF read no measure at all and returned the WHOLE line as one food name, `a saltspoon of salt`. A name carrying its own measure matches no catalog row. `a` states one — corroborated against `readStatedMeasure`, which is the reader both promotions use.',
        },
    },
    {
        seed: 'L00026',
        line: 'two tablespoons of grated American cheese with sufficient melted butter to form a paste',
        occurrences: 9,
        regimes: ['multiFood', 'prep', 'singleAmount'],
        verdict: {
            kind: 'ruled',
            clause: 'R2',
            reading: {
                statedMeasure: 'two tablespoons',
                quantity: exact(2),
                unit: 'tablespoon',
                foods: [
                    { name: 'American cheese', prep: 'grated' },
                    { name: 'butter', prep: 'melted' },
                ],
            },
            note: "`melted` is one of KTD-11b's own named participles and the CRF left it inside the food name. The line also names a SECOND food the CRF folded into the first — R12 is why the second food is stated here rather than dropped.",
        },
    },
    {
        seed: 'L00033',
        line: 'One quart of cold water',
        occurrences: 26,
        regimes: ['prep', 'singleAmount'],
        verdict: {
            kind: 'ruled',
            clause: 'R4',
            reading: {
                statedMeasure: 'One quart',
                quantity: exact(1),
                unit: 'quart',
                foods: [{ name: 'water', prep: 'cold' }],
            },
            note: 'The largest single situation in the census. `cold` is a temperature, so KTD-11b files it as preparation DELIBERATELY against every tagger — ADR-0026 §5 records exactly this word. The CRF names `cold water`, which is the reading a grammar would give and the ruling overrules.',
        },
    },
    {
        seed: 'L00035',
        line: 'A small quantity',
        occurrences: 22,
        regimes: ['subjectiveMeasure'],
        verdict: {
            kind: 'ruled',
            clause: 'R6',
            reading: { statedMeasure: 'A small quantity', quantity: absent, unit: null, foods: [] },
            note: '`small` goes to the CRF\'s size field, which our contract has no slot for. But this line names NO FOOD — `quantity` is not one — so the reading states no food rather than inventing one. `ParsedFacts.foods` "may be empty: a line that named no food… is a fact about the line, not a failure."',
        },
    },
    {
        seed: 'L00036',
        line: 'a large quantity of soup',
        occurrences: 47,
        regimes: ['subjectiveMeasure'],
        verdict: {
            kind: 'ruled',
            clause: 'R6',
            reading: {
                statedMeasure: 'a large quantity',
                quantity: absent,
                unit: null,
                foods: [{ name: 'soup', prep: null }],
            },
            note: 'The single most frequent situation. `large` is an adjective under KTD-11b and there is no size field to hold it; here it qualifies the QUANTITY rather than the food, so it stays in the stated measure and the amount is honestly absent — `a large quantity` is not a number.',
        },
    },
    {
        seed: 'L00075',
        line: 'one tablespoon of flour mixed together',
        occurrences: 5,
        regimes: ['prep', 'singleAmount'],
        verdict: {
            kind: 'ruled',
            clause: 'R2',
            reading: {
                statedMeasure: 'one tablespoon',
                quantity: exact(1),
                unit: 'tablespoon',
                foods: [{ name: 'flour', prep: 'mixed together' }],
            },
            note: 'The CRF returned `flour mixed together` as the food name. `mixed` is a participle and `together` rides with it; the food the catalog must resolve is `flour`.',
        },
    },
    {
        seed: 'L00114',
        line: 'one small onion cut fine',
        occurrences: 4,
        regimes: ['prep', 'singleAmount'],
        verdict: {
            kind: 'undecided',
            lenses: {
                cookAloud: '`cut fine` is one instruction — a cook hears "finely cut", not "fine onion, cut".',
                catalog:
                    'The catalog row is `small onion`. Neither reading of `fine` changes that, so the catalog cannot break the tie.',
                sourceSentence:
                    'The book writes `cut fine` where a modern book writes `finely cut`; the sentence supports the adverbial reading and says nothing about identity.',
            },
            note: "⛔ RUBRIC GAP B. `cut` is an irregular participle (R2 → preparation) but `fine` is in `modifierLexicon`'s ADJECTIVE set, so R5 files it as IDENTITY — yielding `fine onion` with prep `cut`. Every lens says `fine` is here a bare adverb qualifying `cut`, which is what `QUALIFIERS` exists for; that set holds only `well` plus an `-ly` suffix rule, and the period spellings `fine`/`thin`/`thick` after a participle are not in it. The rubric therefore produces a reading its own trap note disowns. Owner decision owed: extend `QUALIFIERS`, or rule that the adjective set wins here too.",
        },
    },
    {
        seed: 'L00119',
        line: 'two quarts of warm water',
        occurrences: 1,
        regimes: ['prep', 'singleAmount'],
        verdict: {
            kind: 'ruled',
            clause: 'R4',
            reading: {
                statedMeasure: 'two quarts',
                quantity: exact(2),
                unit: 'quart',
                foods: [{ name: 'water', prep: 'warm' }],
            },
            note: '`warm` is the third of the three words ADR-0026 §5 names as NLTK-contradicted (`hot`/`cold`/`warm` → `JJ`). The ruling wins.',
        },
    },
    {
        seed: 'L00120',
        line: 'One cup of strained tomatoes',
        occurrences: 5,
        regimes: ['prep', 'singleAmount'],
        verdict: {
            kind: 'ruled',
            clause: 'R2',
            reading: {
                statedMeasure: 'One cup',
                quantity: exact(1),
                unit: 'cup',
                foods: [{ name: 'tomatoes', prep: 'strained' }],
            },
            note: 'Regular `-ed` participle; the CRF kept it in the name.',
        },
    },
    {
        seed: 'L00177',
        line: 'one and a half quarts of boiling water',
        occurrences: 9,
        regimes: ['composite', 'prep'],
        verdict: {
            kind: 'ruled',
            clause: 'R7',
            reading: {
                statedMeasure: 'one and a half quarts',
                quantity: exact(1.5),
                unit: 'quart',
                foods: [{ name: 'water', prep: 'boiling' }],
            },
            note: '⛔ THE FINDING THAT CHALLENGED KTD-11 — and the ruling it produced. The CRF read `1`: it dropped the half AND the unit. R7 says the "and" sits INSIDE one amount, so the line states 1.5 quarts, and R13 ("amounts from the CRF, CRF wins") would have published two thirds of what the source printed with no unit at all. This is the same shape as the shipped defect `MEASUREMENT_JOIN_SOURCE` was written for. 9 lines in this corpus. ⚠️ SETTLED 2026-08-25, and this case did not move: the verdict and the clause are unchanged, because R7 was always what decided the READING. What changed is what the comparison harness does about the pair — `parseAgreement.ts` now names the empty CRF unit `crfUnitAbsent` and disposes of it `llmWins`, which is R14 ("an engine that did not answer is ABSENCE, never dissent") applied one field down. KTD-11 stands: `unitDiffers` and `quantityDiffers` still go to the CRF.',
        },
    },
    {
        seed: 'L00178',
        line: 'two cups of shredded cabbage one-half cup of chopped carrot',
        occurrences: 9,
        regimes: ['multiFood', 'prep', 'composite'],
        verdict: {
            kind: 'undecided',
            lenses: {
                cookAloud:
                    'A cook hears TWO ingredient lines that the typesetter ran together, each with its own amount.',
                catalog:
                    'Both `cabbage` and `carrot` are catalog rows; the placement of `shredded`/`chopped` is settled by R2 and is not what is in doubt.',
                sourceSentence:
                    'The book prints two measures and two foods in one clause with no conjunction between them.',
            },
            note: 'The placement half IS decided — `shredded` and `chopped` are participles (R2) and belong in prep. What no clause reaches is the SHAPE: `ParsedFacts` carries ONE `statedMeasure`/`quantity`/`unit` and many foods, so a line stating two different amounts for two different foods has no representation. R12 gives the foods to the LLM but says nothing about a second amount. Owner decision owed.',
        },
    },
    {
        seed: 'L00196',
        line: 'a small carrot cut up',
        occurrences: 2,
        regimes: ['prep', 'subjectiveMeasure'],
        verdict: {
            kind: 'ruled',
            clause: 'R3',
            reading: {
                statedMeasure: 'a',
                quantity: exact(1),
                unit: null,
                foods: [{ name: 'small carrot', prep: 'cut up' }],
            },
            note: 'The mirror of the usual defect: here the CRF put an ADJECTIVE (`small`) into its preparation field, returning prep `a small, cut up`. R3 sends it back to the name. `cut` is an irregular participle and stays in prep.',
        },
    },
    {
        seed: 'L00201',
        line: 'one can of tomatoes or a quart of medium sized tomatoes cut in small pieces',
        occurrences: 2,
        regimes: ['multiFood', 'prep', 'singleAmount'],
        verdict: {
            kind: 'undecided',
            lenses: {
                cookAloud:
                    '`medium sized` is one size phrase — a cook hears "medium-sized tomatoes", never "sized tomatoes, medium".',
                catalog: 'The catalog row is `tomatoes`; `medium sized` is a grade, which R3/R6 file as identity.',
                sourceSentence: 'The book hyphenates nothing, so the two words stand adjacent and unlinked.',
            },
            note: "⛔ RUBRIC GAP A. `sized` ends in `-ed` so the suffix rule files it as PREPARATION, splitting `medium` (identity, R6) from `sized` (preparation) and leaving `medium tomatoes` with prep `sized`. Every lens reads `medium sized` as one adjectival phrase. R5 states that the adjective list is consulted first precisely because the suffix rule is wrong about adjectives — and `sized` is not in that list. The clause that would decide this is a missing ADJECTIVES entry, which is the owner's to add.",
        },
    },
    {
        seed: 'L00204',
        line: 'one cup of boiled rice',
        occurrences: 4,
        regimes: ['prep', 'singleAmount'],
        verdict: {
            kind: 'ruled',
            clause: 'R2',
            reading: {
                statedMeasure: 'one cup',
                quantity: exact(1),
                unit: 'cup',
                foods: [{ name: 'rice', prep: 'boiled' }],
            },
            note: 'Decided, and uncomfortable in the way KTD-11b says it accepts: `boiled rice` is arguably a different food from `rice` to a cook. The ruling is a definition and this is the edge it buys clarity with.',
        },
    },
    {
        seed: 'L00224',
        line: 'one tablespoon of broken cinnamon',
        occurrences: 2,
        regimes: ['prep', 'singleAmount'],
        verdict: {
            kind: 'ruled',
            clause: 'R2',
            reading: {
                statedMeasure: 'one tablespoon',
                quantity: exact(1),
                unit: 'tablespoon',
                foods: [{ name: 'cinnamon', prep: 'broken' }],
            },
            note: '`broken` is in `IRREGULAR_PARTICIPLES` — the list KTD-11b asked for because "`-ed` alone is not a participle test".',
        },
    },
    {
        seed: 'L00243',
        line: 'one cup of sifted flour',
        occurrences: 13,
        regimes: ['prep', 'singleAmount'],
        verdict: {
            kind: 'ruled',
            clause: 'R2',
            reading: {
                statedMeasure: 'one cup',
                quantity: exact(1),
                unit: 'cup',
                foods: [{ name: 'flour', prep: 'sifted' }],
            },
            note: "`sifted` is named in KTD-11b's own list. ⚠️ `notAFoodLexicon.ts` uses this exact pair as its example of what must NOT be done in the other direction: the word moves fields, it is never deleted.",
        },
    },
    {
        seed: 'L00245',
        line: 'a small liver chopped fine',
        occurrences: 11,
        regimes: ['prep', 'subjectiveMeasure'],
        verdict: {
            kind: 'undecided',
            lenses: {
                cookAloud: '"Chopped fine" is one instruction; `fine` is doing the work of `finely`.',
                catalog: '`liver` resolves either way — the catalog cannot break the tie.',
                sourceSentence:
                    'The book uses the bare adverb throughout (`cut fine`, `chopped fine`, `chopped very fine`).',
            },
            note: '⛔ RUBRIC GAP B again, and this is its largest occurrence — 11 lines. Same shape as L00114: R5 files `fine` as identity, giving `fine liver`. The `QUALIFIERS` set is `{well}` plus `-ly`, and the bare adverb is neither.',
        },
    },
    {
        seed: 'L00246',
        line: 'five pounds thirty minutes',
        occurrences: 4,
        regimes: ['singleAmount'],
        verdict: {
            kind: 'ruled',
            clause: 'R10',
            reading: { statedMeasure: 'five pounds', quantity: exact(5), unit: 'pound', foods: [] },
            note: 'The CRF named `thirty minutes` as the food. A duration measures no substance, so it is residue and the line names no food at all. ⚠️ U22a did not cut this one — `segmentClause` finds no boundary word between `pounds` and `thirty` — so it is a live extractor residual, not a closed case.',
        },
    },
    {
        seed: 'L00259',
        line: 'one gill of tepid water',
        occurrences: 2,
        regimes: ['historicalUnit', 'prep'],
        verdict: {
            kind: 'ruled',
            clause: 'R11',
            reading: {
                statedMeasure: 'one gill',
                quantity: exact(1),
                unit: 'gill',
                foods: [{ name: 'water', prep: 'tepid' }],
            },
            note: "Two clauses fire and agree: the CRF folded the gill into the name (R11 → the LLM takes measure and unit, never the quantity, and the CRF's leading `1` is right), and `tepid` is a temperature (R4). Cited under R11 because that is the clause that decides which ENGINE is right.",
        },
    },
    {
        seed: 'L00277',
        line: 'a small sliced carrot',
        occurrences: 1,
        regimes: ['prep', 'subjectiveMeasure'],
        verdict: {
            kind: 'ruled',
            clause: 'R2',
            reading: {
                statedMeasure: 'a',
                quantity: exact(1),
                unit: null,
                foods: [{ name: 'small carrot', prep: 'sliced' }],
            },
            note: 'Both halves in one line: `sliced` is a participle (R2 → prep), `small` is an adjective (R3/R6 → name). The CRF put `sliced` in the name and `small` in its size field — wrong in both directions at once.',
        },
    },
    {
        seed: 'L00290',
        line: 'three or four large spoonfuls)',
        occurrences: 1,
        regimes: ['range', 'historicalUnit'],
        verdict: {
            kind: 'undecided',
            lenses: {
                cookAloud: 'A cook hears an amount with no ingredient — this is the tail of a sentence, not a line.',
                catalog: 'There is nothing to resolve: no food is named.',
                sourceSentence: 'The stray `)` shows the clause was cut out of a parenthesis the extractor split.',
            },
            note: 'No clause decides this because there is nothing to decide: the line names no food and should not have reached a parse engine. It is an EXTRACTOR finding rather than an adjudication — a clause the accept gate admitted on `spoonfuls` reading as a unit with a leading range. Recorded so it is not mistaken for an engine disagreement.',
        },
    },
    {
        seed: 'L00307',
        line: 'a large spoonful with each portion of fish: Peel one-half pound of horseradish root',
        occurrences: 1,
        regimes: ['historicalUnit', 'multiFood'],
        verdict: {
            kind: 'undecided',
            lenses: {
                cookAloud: 'Two sentences: a serving instruction, then a preparation step.',
                catalog: '`horseradish root` is a catalog row; `spoonful with each portion of fish` is not anything.',
                sourceSentence: 'The colon in the middle is a sentence boundary the segmenter crossed.',
            },
            note: 'Two clauses run together. `INSTRUCTION_BOUNDARY` includes `:` so the segmenter should have cut here; it did not, because `statesASecondFood` sees `one-half pound of horseradish root` in the tail and correctly REFUSES the cut. That refusal is right by R9/R10 and still leaves a two-sentence span. No clause reaches it; owner decision owed on whether a refused cut should also refuse the ACCEPT.',
        },
    },
    {
        seed: 'L00308',
        line: 'one pint of cream beaten stiff',
        occurrences: 1,
        regimes: ['prep', 'singleAmount'],
        verdict: {
            kind: 'ruled',
            clause: 'R2',
            reading: {
                statedMeasure: 'one pint',
                quantity: exact(1),
                unit: 'pint',
                foods: [{ name: 'cream', prep: 'beaten stiff' }],
            },
            note: '`beaten` is in `IRREGULAR_PARTICIPLES` and is one of the seven words ADR-0026 §5 records NLTK tagging `JJ`.',
        },
    },
    {
        seed: 'L00354',
        line: 'A pinch of cayenne or a saltspoon of paprika is relished by many',
        occurrences: 1,
        regimes: ['multiFood', 'historicalUnit', 'subjectiveMeasure'],
        verdict: {
            kind: 'undecided',
            lenses: {
                cookAloud: 'A cook hears a suggestion of two alternatives, then an aside about taste.',
                catalog: '`cayenne` and `paprika` are both rows; `is relished by many` is not a preparation of either.',
                sourceSentence: 'The trailing clause is commentary the book addresses to the reader, not to the pan.',
            },
            note: '⚠️ The residue here survived U22a CORRECTLY. `is` is an instruction boundary, but `statesASecondFood` sees `a saltspoon of paprika` in the tail and refuses the cut — which is the guard doing exactly what ADR-0026 §7 requires, since cutting would delete a food. The consequence is that `is relished by many` reaches both engines. `relished` then classifies as a participle. No clause covers commentary; owner decision owed.',
        },
    },
    {
        seed: 'L00407',
        line: 'one tablespoon of canned tomatoes',
        occurrences: 3,
        regimes: ['prep', 'singleAmount'],
        verdict: {
            kind: 'undecided',
            lenses: {
                cookAloud: '"Canned tomatoes" is what the tin is called — a cook hears a product, not an instruction.',
                catalog: '`Tomatoes, canned` is a distinct catalog row from `Tomatoes, raw`, with different nutrition.',
                sourceSentence: 'The book contrasts it elsewhere with `fresh` tomatoes, which R3 files as identity.',
            },
            note: "⛔ RUBRIC GAP A. `canned` is a denominal adjective the `-ed` suffix rule files as preparation. All three lenses read it as identity, and the third is decisive on the rubric's own terms: the book pairs it with `fresh`, and `fresh` IS in the adjective list. Filing one of a contrasting pair as prep and the other as identity is the split R5 exists to prevent.",
        },
    },
    {
        seed: 'L00499',
        line: 'four tablespoons of brown sugar in which you have put one-half teaspoon of ground cinnamon',
        occurrences: 12,
        regimes: ['multiFood', 'prep', 'singleAmount'],
        verdict: {
            kind: 'ruled',
            clause: 'R2',
            reading: {
                statedMeasure: 'four tablespoons',
                quantity: exact(4),
                unit: 'tablespoon',
                foods: [
                    { name: 'brown sugar', prep: null },
                    { name: 'cinnamon', prep: 'ground' },
                ],
            },
            note: '`ground` is irregular (R2) and `brown` is a colour (R3) — the two halves of KTD-11b on one line, and the CRF gets `brown` right and `ground` wrong.',
        },
    },
    {
        seed: 'L00515',
        line: 'half a cup of hot water',
        occurrences: 14,
        regimes: ['prep', 'singleAmount'],
        verdict: {
            kind: 'ruled',
            clause: 'R4',
            reading: {
                statedMeasure: 'half a cup',
                quantity: exact(0.5),
                unit: 'cup',
                foods: [{ name: 'water', prep: 'hot' }],
            },
            note: '`hot` is the word ADR-0026 §5 says settles the whole tagger question: "`hot` IS an adjective, to every tagger and every grammar, and KTD-11b files it as preparation deliberately."',
        },
    },
    {
        seed: 'L00549',
        line: 'two cups of cooked spaghetti',
        occurrences: 2,
        regimes: ['prep', 'singleAmount'],
        verdict: {
            kind: 'ruled',
            clause: 'R2',
            reading: {
                statedMeasure: 'two cups',
                quantity: exact(2),
                unit: 'cup',
                foods: [{ name: 'spaghetti', prep: 'cooked' }],
            },
            note: 'KTD-11b names this exact case as its accepted consequence: "`cooked green peas` files `cooked` as preparation and `green` as identity… arguably identity to a cook." Decided, and decided knowingly.',
        },
    },
    {
        seed: 'L00561',
        line: 'one cup of cold mashed potatoes',
        occurrences: 1,
        regimes: ['prep', 'singleAmount'],
        verdict: {
            kind: 'ruled',
            clause: 'R2',
            reading: {
                statedMeasure: 'one cup',
                quantity: exact(1),
                unit: 'cup',
                foods: [{ name: 'potatoes', prep: 'cold mashed' }],
            },
            note: 'Both modifiers are preparation — `cold` by R4, `mashed` by R2 — so the whole phrase moves and the name is the bare food.',
        },
    },
    {
        seed: 'L00587',
        line: 'two tablespoons of flour moistened in enough cold water to form a smooth paste',
        occurrences: 1,
        regimes: ['multiFood', 'prep', 'singleAmount'],
        verdict: {
            kind: 'ruled',
            clause: 'R2',
            reading: {
                statedMeasure: 'two tablespoons',
                quantity: exact(2),
                unit: 'tablespoon',
                foods: [{ name: 'flour', prep: 'moistened' }],
            },
            note: 'The CRF returned the entire clause as one food name. ⚠️ The trailing `in enough cold water to form a smooth paste` names a second food with NO stated amount, so R12 does not reach it and the reading does not claim one — `enough` is not a quantity.',
        },
    },
    {
        seed: 'L00588',
        line: 'one can of concentrated tomato sauce with one quart of water',
        occurrences: 1,
        regimes: ['multiFood', 'singleAmount'],
        verdict: {
            kind: 'undecided',
            lenses: {
                cookAloud: '"Concentrated tomato sauce" is what is on the label.',
                catalog:
                    'A concentrate is a distinct row with distinct nutrition — resolving it to `tomato sauce` would understate it.',
                sourceSentence:
                    'The line pairs it with a quart of water to dilute, which only makes sense if the concentrate is the identity.',
            },
            note: '⛔ RUBRIC GAP A. `concentrated` is filed preparation by the suffix rule. The catalog lens is decisive here in a way it is not for most of gap A: reading it as prep asks the cascade to resolve `tomato sauce` and then attaches a nutrition figure that is wrong by the dilution factor.',
        },
    },
    {
        seed: 'L00598',
        line: 'one tablespoon of minced parsley',
        occurrences: 1,
        regimes: ['prep', 'singleAmount'],
        verdict: {
            kind: 'ruled',
            clause: 'R2',
            reading: {
                statedMeasure: 'one tablespoon',
                quantity: exact(1),
                unit: 'tablespoon',
                foods: [{ name: 'parsley', prep: 'minced' }],
            },
            note: '`minced` is named in KTD-11b.',
        },
    },
    {
        seed: 'L00691',
        line: 'one tablespoon of caraway seed in a bag',
        occurrences: 2,
        regimes: ['prep', 'singleAmount'],
        verdict: {
            kind: 'undecided',
            lenses: {
                cookAloud: '`caraway seed` is the name of the spice; nobody hears "caraway, seeded".',
                catalog: '`Spices, caraway seed` is the catalog row. `caraway` alone is not one.',
                sourceSentence: 'The book writes `caraway seed` as a fixed compound throughout.',
            },
            note: "⛔ RUBRIC GAP C, and the sharpest one. `seed` is a NOUN of four letters ending in `-ed`, so `classifyModifier('seed')` returns `preparation` — verified 2026-08-25. It is TRAP 1's exact shape (`red`, `green`) for a word the adjective exception list does not carry, and the consequence is the one that note names: the catalog is asked to resolve the wrong string. ⚠️ It only bites when `seed` is not the final word, which the trailing `in a bag` makes true here.",
        },
    },
    {
        seed: 'L00792',
        line: 'quarter cup of granulated sugar',
        occurrences: 16,
        regimes: ['prep', 'singleAmount'],
        verdict: {
            kind: 'undecided',
            lenses: {
                cookAloud: '"Granulated sugar" is a grade of sugar sold under that name, like `brown sugar`.',
                catalog: '`Sugars, granulated` is a row distinct from `Sugars, powdered`; the grade IS the identity.',
                sourceSentence:
                    'The book contrasts `granulated`, `powdered` and `pulverized` sugar as different things to buy.',
            },
            note: '⛔ RUBRIC GAP A, and its largest occurrence — 16 lines here, 16 more under `powdered` and 7 under `pulverized`. The rubric already files `brown sugar` as identity (R3, `brown` is a colour) while filing `granulated sugar` as preparation, which splits one contrast across two fields.',
        },
    },
    {
        seed: 'L00804',
        line: 'two saltspoons of white pepper',
        occurrences: 1,
        regimes: ['historicalUnit', 'singleAmount'],
        verdict: {
            kind: 'ruled',
            clause: 'R11',
            reading: {
                statedMeasure: 'two saltspoons',
                quantity: exact(2),
                unit: 'saltspoon',
                foods: [{ name: 'white pepper', prep: null }],
            },
            note: 'The CRF read the quantity `2` correctly and lost the unit into the name — precisely the split ADR-0026 records: the LLM takes the measure and the unit, "and never the quantity, because missing the unit does not stop the CRF reading the leading number."',
        },
    },
    {
        seed: 'L00839',
        line: 'one pound of dried Lima beans',
        occurrences: 1,
        regimes: ['prep', 'singleAmount'],
        verdict: {
            kind: 'ruled',
            clause: 'R2',
            reading: {
                statedMeasure: 'one pound',
                quantity: exact(1),
                unit: 'pound',
                foods: [{ name: 'Lima beans', prep: 'dried' }],
            },
            note: 'KTD-11b names `dried figs` as its own accepted edge: "`dried` … arguably identity to a cook. The ruling is a definition, not a claim about English." Decided, deliberately, against the cook\'s reading.',
        },
    },
    {
        seed: 'L00852',
        line: 'three tablespoons of uncooked rice',
        occurrences: 2,
        regimes: ['prep', 'singleAmount'],
        verdict: {
            kind: 'ruled',
            clause: 'R2',
            reading: {
                statedMeasure: 'three tablespoons',
                quantity: exact(3),
                unit: 'tablespoon',
                foods: [{ name: 'rice', prep: 'uncooked' }],
            },
            note: 'The mirror of L00549 and settled the same way. ⚠️ Recorded because it is the case where the ruling reads oddest: `uncooked` describes a state nothing was done to produce.',
        },
    },
    {
        seed: 'L00885',
        line: 'one-half cup shelled roasted peanuts',
        occurrences: 1,
        regimes: ['prep', 'singleAmount'],
        verdict: {
            kind: 'ruled',
            clause: 'R2',
            reading: {
                statedMeasure: 'one-half cup',
                quantity: exact(0.5),
                unit: 'cup',
                foods: [{ name: 'peanuts', prep: 'shelled roasted' }],
            },
            note: 'Two participles, one food. The CRF split them — `shelled` into prep, `roasted` into the name — which is the same word class landing in two fields on one line.',
        },
    },
    {
        seed: 'L00886',
        line: 'one-half cup of toasted bread crumby one-half teaspoon of salt',
        occurrences: 1,
        regimes: ['multiFood', 'prep', 'composite'],
        verdict: {
            kind: 'undecided',
            lenses: {
                cookAloud: 'Two lines run together, and `crumby` is an OCR misreading of `crumbs`.',
                catalog: '`bread crumbs` is a row; `bread crumby` is not.',
                sourceSentence:
                    "The book prints `crumbs`; the corpus carries the scan's error verbatim, as R1 requires.",
            },
            note: "R1 forbids correcting the source, so the oracle may not silently read `crumbs`. The placement of `toasted` is decided (R2), but the identity is a corrupted string and the line also carries two amounts — L00178's unrepresentable shape. Two independent reasons no clause reaches it.",
        },
    },
    {
        seed: 'L00912',
        line: 'a half teaspoon of powdered cinnamon',
        occurrences: 16,
        regimes: ['prep', 'singleAmount'],
        verdict: {
            kind: 'undecided',
            lenses: {
                cookAloud: '"Powdered" names the form the spice is sold in.',
                catalog: '`Spices, cinnamon, ground` is a distinct row from a stick of cinnamon.',
                sourceSentence:
                    'The book distinguishes `broken cinnamon` (L00224) from `powdered cinnamon`, which are bought differently.',
            },
            note: '⛔ RUBRIC GAP A. ⚠️ Note the tension with L00224, which the rubric DOES decide: `broken` is an explicit irregular participle, so the same contrast is split — one side ruled, the other a gap. That asymmetry is the argument for closing gap A rather than treating each word on its own.',
        },
    },
    {
        seed: 'L00934',
        line: 'a drop at a time',
        occurrences: 1,
        regimes: ['subjectiveMeasure'],
        verdict: {
            kind: 'ruled',
            clause: 'R10',
            reading: { statedMeasure: 'a drop', quantity: exact(1), unit: 'drop', foods: [] },
            note: 'The CRF named `time` as the food. `time` is in `NOT_A_MEASURE`, so it measures no substance and names none. The line is a rate, not an ingredient — an extractor residual the accept gate admitted because `drop` reads as a unit.',
        },
    },
    {
        seed: 'L00936',
        line: 'one teaspoon of prepared mustard',
        occurrences: 3,
        regimes: ['prep', 'singleAmount'],
        verdict: {
            kind: 'undecided',
            lenses: {
                cookAloud: '"Prepared mustard" is the jar; dry mustard is the other thing.',
                catalog: '`Mustard, prepared, yellow` is a row distinct from `Spices, mustard seed, ground`.',
                sourceSentence: 'The book uses `prepared mustard` to mean specifically not the powder.',
            },
            note: '⛔ RUBRIC GAP A. Filing `prepared` as preparation resolves this line to plain `mustard`, which in this catalog is the powder — the wrong ingredient, not merely a coarser one.',
        },
    },
    {
        seed: 'L00976',
        line: 'a large cup of stewed prunes',
        occurrences: 3,
        regimes: ['prep', 'subjectiveMeasure'],
        verdict: {
            kind: 'ruled',
            clause: 'R2',
            reading: {
                statedMeasure: 'a large cup',
                quantity: exact(1),
                unit: 'cup',
                foods: [{ name: 'prunes', prep: 'stewed' }],
            },
            note: '`large` qualifies the CUP, not the prunes, so R6 leaves it in the stated measure rather than moving it into a food name. ⚠️ `notAFoodLexicon.ts` uses `a dish of stewed prunes` as its worked example of the head-final rule.',
        },
    },
    {
        seed: 'L01013',
        line: 'one cup of buttered bread crumbs',
        occurrences: 1,
        regimes: ['prep', 'singleAmount'],
        verdict: {
            kind: 'ruled',
            clause: 'R2',
            reading: {
                statedMeasure: 'one cup',
                quantity: exact(1),
                unit: 'cup',
                foods: [{ name: 'bread crumbs', prep: 'buttered' }],
            },
            note: 'A participle describing something genuinely DONE to the crumbs, so the ruling and the cook agree here.',
        },
    },
    {
        seed: 'L01077',
        line: 'a piece of compressed yeast',
        occurrences: 1,
        regimes: ['subjectiveMeasure'],
        verdict: {
            kind: 'undecided',
            lenses: {
                cookAloud: '"Compressed yeast" is the cake of fresh yeast, as opposed to dry.',
                catalog: "`Leavening agents, yeast, baker's, compressed` is its own row.",
                sourceSentence: 'The book means a specific product a grocer sold, not yeast that has been compressed.',
            },
            note: '⛔ RUBRIC GAP A. ⚠️ Also note the measure: `a piece` is a subjective measure the source really states, so `statedMeasure` carries it while a number cannot — which is the class `statedMeasure` was introduced for.',
        },
    },
    {
        seed: 'L01096',
        line: 'One-half cup of pounded almonds mixed',
        occurrences: 5,
        regimes: ['prep', 'singleAmount'],
        verdict: {
            kind: 'ruled',
            clause: 'R2',
            reading: {
                statedMeasure: 'One-half cup',
                quantity: exact(0.5),
                unit: 'cup',
                foods: [{ name: 'almonds', prep: 'pounded mixed' }],
            },
            note: 'Two participles bracketing the food; the CRF kept both in the name.',
        },
    },
    {
        seed: 'L01164',
        line: 'one and one-half cups of grated cheese',
        occurrences: 3,
        regimes: ['composite', 'prep'],
        verdict: {
            kind: 'ruled',
            clause: 'R2',
            reading: {
                statedMeasure: 'one and one-half cups',
                quantity: exact(1.5),
                unit: 'cup',
                foods: [{ name: 'cheese', prep: 'grated' }],
            },
            note: '⚠️ Contrast with L00177: here the CRF DID read the composite correctly (`1 1/2 cups`), so R7 does not fire and only the placement is contested. The two spellings — `one and one-half` and `one and a half` — behave differently in the CRF, which is itself worth knowing.',
        },
    },
    {
        seed: 'L01178',
        line: 'one cup of washed rice in frying-pan with four or five tablespoons of poultry fat',
        occurrences: 1,
        regimes: ['multiFood', 'range', 'prep'],
        verdict: {
            kind: 'ruled',
            clause: 'R9',
            reading: {
                statedMeasure: 'one cup',
                quantity: exact(1),
                unit: 'cup',
                foods: [
                    { name: 'rice', prep: 'washed' },
                    { name: 'poultry fat', prep: null },
                ],
            },
            note: "⚠️ ADR-0026 §7's hazard, live in the corpus: the tail names a VESSEL (`frying-pan`) AND a second food with its own range. The cut is correctly refused because cutting would delete the fat, so `frying-pan` reaches both engines — and the CRF filed it as preparation. The reading keeps both foods and drops the vessel by R9.",
        },
    },
    {
        seed: 'L01200',
        line: 'a tablespoon of butter rubbed very hard',
        occurrences: 3,
        regimes: ['prep', 'singleAmount'],
        verdict: {
            kind: 'ruled',
            clause: 'R2',
            reading: {
                statedMeasure: 'a tablespoon',
                quantity: exact(1),
                unit: 'tablespoon',
                foods: [{ name: 'butter', prep: 'rubbed very hard' }],
            },
            note: 'The whole trailing phrase is preparation; `hard` is not in the adjective list, so nothing pulls it back into the name.',
        },
    },
    {
        seed: 'L01249',
        line: 'one-quarter pound imported Swiss cheese grated',
        occurrences: 1,
        regimes: ['prep', 'singleAmount'],
        verdict: {
            kind: 'undecided',
            lenses: {
                cookAloud: '"Imported Swiss cheese" is what it is; `grated` is what you do to it.',
                catalog:
                    '`Cheese, swiss` is the row. `imported` narrows provenance, which R3 files as identity for `Russian`, `Italian` and `French`.',
                sourceSentence:
                    'The book already carries `Swiss` — a nationality R3 rules as identity — beside `imported`.',
            },
            note: '⛔ RUBRIC GAP A, and the clearest case that it IS a gap rather than a ruling: `ADJECTIVES` carries seventeen nationalities including `swiss` precisely because provenance is identity, and `imported` says the same kind of thing while ending in `-ed`. The CRF got the whole line right here; the rubric is what disagrees.',
        },
    },
    {
        seed: 'L01264',
        line: 'one tablespoon of flour blended together',
        occurrences: 1,
        regimes: ['prep', 'singleAmount'],
        verdict: {
            kind: 'ruled',
            clause: 'R2',
            reading: {
                statedMeasure: 'one tablespoon',
                quantity: exact(1),
                unit: 'tablespoon',
                foods: [{ name: 'flour', prep: 'blended together' }],
            },
            note: 'The sibling of L00075, same shape and same ruling.',
        },
    },
    {
        seed: 'L01291',
        line: 'two cups of boiling water over two cups of rolled oats',
        occurrences: 3,
        regimes: ['multiFood', 'prep', 'singleAmount'],
        verdict: {
            kind: 'undecided',
            lenses: {
                cookAloud: '"Rolled oats" is the name on the box.',
                catalog: '`Cereals, oats, regular and quick, rolled` is the row; `oats` alone is a grain.',
                sourceSentence: 'The book distinguishes rolled oats from oatmeal as different purchases.',
            },
            note: "⛔ RUBRIC GAP A for `rolled`. ⚠️ The line also carries L00178's two-amounts shape and a `boiling` that R4 DOES decide, so it is undecided for the identity half only — recorded here rather than split, because splitting one line across two verdicts would double-count it in every census.",
        },
    },
    {
        seed: 'L01362',
        line: 'one-half cup of seeded raisins',
        occurrences: 7,
        regimes: ['prep', 'singleAmount'],
        verdict: {
            kind: 'ruled',
            clause: 'R2',
            reading: {
                statedMeasure: 'one-half cup',
                quantity: exact(0.5),
                unit: 'cup',
                foods: [{ name: 'raisins', prep: 'seeded' }],
            },
            note: "A genuine participle — the seeds were removed — so it is preparation on every reading. ⚠️ Do not confuse it with L00691's `seed`, which is a noun the same suffix rule mis-files.",
        },
    },
    {
        seed: 'L01381',
        line: 'two pounds of rendered butter',
        occurrences: 4,
        regimes: ['prep', 'singleAmount'],
        verdict: {
            kind: 'ruled',
            clause: 'R2',
            reading: {
                statedMeasure: 'two pounds',
                quantity: exact(2),
                unit: 'pound',
                foods: [{ name: 'butter', prep: 'rendered' }],
            },
            note: 'Something done to the butter, so the ruling and the cook agree.',
        },
    },
    {
        seed: 'L01399',
        line: 'two cups of scalded milk',
        occurrences: 2,
        regimes: ['prep', 'singleAmount'],
        verdict: {
            kind: 'ruled',
            clause: 'R2',
            reading: {
                statedMeasure: 'two cups',
                quantity: exact(2),
                unit: 'cup',
                foods: [{ name: 'milk', prep: 'scalded' }],
            },
            note: 'Reachable by two clauses that agree — a participle (R2) and, through `scalding`, a temperature (R4).',
        },
    },
    {
        seed: 'L01401',
        line: 'one-half cup of light colored raisins',
        occurrences: 1,
        regimes: ['prep', 'singleAmount'],
        verdict: {
            kind: 'undecided',
            lenses: {
                cookAloud: '"Light coloured raisins" is one colour phrase — sultanas rather than dark raisins.',
                catalog: 'Golden and dark raisins are different rows; the colour IS the identity.',
                sourceSentence: 'The book means a variety, and prints the same thing hyphenated at L01739.',
            },
            note: '⛔ RUBRIC GAP A, and it is TRAP 1 by another route. `ADJECTIVES` carries eleven colours exactly so a colour stays identity; `colored` — the word that says the phrase IS a colour — ends in `-ed` and is filed preparation, splitting `light` (identity) from `colored` (prep). The trap note names `red` and `green`; this is the same failure one word out.',
        },
    },
    {
        seed: 'L01446',
        line: 'one cup of cleaned currants',
        occurrences: 2,
        regimes: ['prep', 'singleAmount'],
        verdict: {
            kind: 'ruled',
            clause: 'R2',
            reading: {
                statedMeasure: 'one cup',
                quantity: exact(1),
                unit: 'cup',
                foods: [{ name: 'currants', prep: 'cleaned' }],
            },
            note: 'A genuine participle.',
        },
    },
    {
        seed: 'L01453',
        line: 'one-half pound of creamed butter',
        occurrences: 1,
        regimes: ['prep', 'singleAmount'],
        verdict: {
            kind: 'ruled',
            clause: 'R2',
            reading: {
                statedMeasure: 'one-half pound',
                quantity: exact(0.5),
                unit: 'pound',
                foods: [{ name: 'butter', prep: 'creamed' }],
            },
            note: 'A genuine participle: creaming is the step.',
        },
    },
    {
        seed: 'L01547',
        line: 'one to one and one-half boxes of strawberries to taste',
        occurrences: 1,
        regimes: ['range', 'composite'],
        verdict: {
            kind: 'ruled',
            clause: 'R7',
            reading: {
                statedMeasure: 'one to one and one-half boxes',
                quantity: range(1, 1.5),
                unit: 'box',
                foods: [{ name: 'strawberries', prep: null }],
            },
            note: 'A range whose UPPER bound is itself a composite. R7 keeps `one and one-half` whole as 1.5, and the range is 1–1.5. ⚠️ Included deliberately: it is the only place in the census where the composite and range regimes meet, and it is where a bare `and` split would produce an inverted range.',
        },
    },
    {
        seed: 'L01587',
        line: 'one-half cup of butter with one and one-half cups of pulverized sugar',
        occurrences: 7,
        regimes: ['multiFood', 'composite', 'prep'],
        verdict: {
            kind: 'undecided',
            lenses: {
                cookAloud: '"Pulverized sugar" is confectioner\'s sugar — a thing you buy.',
                catalog: '`Sugars, powdered` is a row distinct from granulated.',
                sourceSentence: 'The book lists it beside `granulated` and `powdered` as alternatives at the shop.',
            },
            note: "⛔ RUBRIC GAP A, third spelling of the same contrast (L00792 `granulated`, L00912 `powdered`). ⚠️ The line also states two amounts for two foods — L00178's unrepresentable shape — and the CRF here named only `butter` and `pulverized sugar` with ONE measure.",
        },
    },
    {
        seed: 'L01598',
        line: 'one cup of water alternately with two and one-half cups of flour in which has been sifted two teaspoons of baking-powder',
        occurrences: 1,
        regimes: ['multiFood', 'composite', 'prep'],
        verdict: {
            kind: 'ruled',
            clause: 'R7',
            reading: {
                statedMeasure: 'one cup',
                quantity: exact(1),
                unit: 'cup',
                foods: [
                    { name: 'water', prep: null },
                    { name: 'flour', prep: null },
                    { name: 'baking-powder', prep: 'sifted' },
                ],
            },
            note: 'Three foods and three amounts in one clause. The stated measure is the LEADING one, which is all `ParsedFacts` can hold. ⚠️ The CRF read `1 cup` and named only `flour` — so the water it took the measure from is not in its answer at all. Cited under R7 because the two composites the line carries (`two and one-half`) are what make the amount unreadable as a single number.',
        },
    },
    {
        seed: 'L01625',
        line: 'one cup of unsweetened apple sauce',
        occurrences: 2,
        regimes: ['prep', 'singleAmount'],
        verdict: {
            kind: 'undecided',
            lenses: {
                cookAloud: '"Unsweetened apple sauce" is the can you pick off the shelf.',
                catalog: '`Applesauce, canned, unsweetened` is a row; sweetened is another, with different sugar.',
                sourceSentence: 'The book specifies it to distinguish from the sweetened kind.',
            },
            note: '⛔ RUBRIC GAP A. Nothing was done to the sauce to make it unsweetened — the word describes an absence, which no participle reading survives.',
        },
    },
    {
        seed: 'L01654',
        line: 'one cup of flour three times',
        occurrences: 1,
        regimes: ['singleAmount'],
        verdict: {
            kind: 'ruled',
            clause: 'R10',
            reading: {
                statedMeasure: 'one cup',
                quantity: exact(1),
                unit: 'cup',
                foods: [{ name: 'flour', prep: null }],
            },
            note: '⛔ ADR-0026 §7\'s third disproved guard, in the corpus: `Sift one cup of flour three times`. `times` is in `NOT_A_MEASURE`, so `three times` names no food — but classifying the WHOLE SPAN by that head "dropped a real cup of flour; two recipes fell below the minimum ingredient count as a result." The cup of flour is real and the duration is residue. The CRF named both `flour` AND `times` as foods.',
        },
    },
    {
        seed: 'L01702',
        line: 'one-half ounce of candied orange peel cut',
        occurrences: 1,
        regimes: ['prep', 'singleAmount'],
        verdict: {
            kind: 'undecided',
            lenses: {
                cookAloud: '"Candied orange peel" is a confection sold by that name; `cut` is the instruction.',
                catalog:
                    'Candied peel is its own row and is mostly sugar — resolving to `orange peel` would be badly wrong.',
                sourceSentence: 'The book treats it as an ingredient to buy, not a step to perform.',
            },
            note: '⛔ RUBRIC GAP A, with the largest nutritional consequence in the census: candied peel and raw peel differ by an order of magnitude in sugar. ⚠️ The trailing `cut` IS preparation (R2) and is not what is in doubt.',
        },
    },
    {
        seed: 'L01739',
        line: 'one-half cup of light-colored raisins',
        occurrences: 1,
        regimes: ['prep', 'singleAmount'],
        verdict: {
            kind: 'undecided',
            lenses: {
                cookAloud: 'Identical to L01401, and the book hyphenates it here.',
                catalog: 'Same row question as L01401.',
                sourceSentence: 'The hyphen makes the single-phrase reading explicit in the source itself.',
            },
            note: "⛔ RUBRIC GAP A. Kept as its own case because the HYPHEN changes which rule fires: `modifierLexicon`'s `head()` reads a compound by its last segment, so `light-colored` classifies on `colored` and the `light` that would have been identity is not even consulted. The unhyphenated L01401 at least filed half the phrase correctly.",
        },
    },
    {
        seed: 'L01782',
        line: 'one wineglass of brandy',
        occurrences: 4,
        regimes: ['historicalUnit', 'singleAmount'],
        verdict: {
            kind: 'ruled',
            clause: 'R11',
            reading: {
                statedMeasure: 'one wineglass',
                quantity: exact(1),
                unit: 'wineglass',
                foods: [{ name: 'brandy', prep: null }],
            },
            note: 'The CRF read `1` and named `wineglass of brandy`. R11 gives the LLM the measure and the unit and leaves the quantity with the CRF, which read it correctly.',
        },
    },
    {
        seed: 'L01785',
        line: 'five large pans greased ready',
        occurrences: 1,
        regimes: ['singleAmount'],
        verdict: {
            kind: 'ruled',
            clause: 'R9',
            reading: { statedMeasure: 'five', quantity: exact(5), unit: null, foods: [] },
            note: 'A vessel with a count and a participle. R9 is unambiguous: only a vessel answers "this span is not an ingredient", and `pans` is in `VESSELS`. ⚠️ It reached the engines because `segmentClause` found no boundary word inside it — a live extractor residual of exactly ADR-0026 §7\'s class.',
        },
    },
    {
        seed: 'L01800',
        line: 'a teaspoon on well-buttered pans',
        occurrences: 1,
        regimes: ['singleAmount'],
        verdict: {
            kind: 'ruled',
            clause: 'R9',
            reading: { statedMeasure: 'a teaspoon', quantity: exact(1), unit: 'teaspoon', foods: [] },
            note: 'U22a DID cut this one — `segmentClause` returns span `a teaspoon`, tail `on well-buttered pans` — so the corpus line is the whole clause only because the corpus was harvested before the cut is applied to `sourceText`. The food is genuinely absent: a teaspoon OF nothing was named.',
        },
    },
    {
        seed: 'L01801',
        line: 'Two pounds of soup fat rendered a day or two before using',
        occurrences: 1,
        regimes: ['singleAmount', 'range'],
        verdict: {
            kind: 'ruled',
            clause: 'R10',
            reading: {
                statedMeasure: 'Two pounds',
                quantity: exact(2),
                unit: 'pound',
                foods: [{ name: 'soup fat', prep: 'rendered' }],
            },
            note: '`a day or two before using` is a duration, so by R10 it is residue and not a second food — which is also why cutting it would be safe. The CRF named `soup fat rendered a day`, taking half the duration into the food.',
        },
    },
    {
        seed: 'L01837',
        line: 'one cup of finely-pounded nut meats',
        occurrences: 1,
        regimes: ['prep', 'singleAmount'],
        verdict: {
            kind: 'ruled',
            clause: 'R2',
            reading: {
                statedMeasure: 'one cup',
                quantity: exact(1),
                unit: 'cup',
                foods: [{ name: 'nut meats', prep: 'finely-pounded' }],
            },
            note: 'The compound head rule working as designed: `head()` reads `pounded`, which is a participle, and `finely` is the qualifier that moves with it. Contrast L01739, where the same rule reaches the wrong half.',
        },
    },
    {
        seed: 'L01852',
        line: 'one cup of blanched almonds chopped finely',
        occurrences: 2,
        regimes: ['prep', 'singleAmount'],
        verdict: {
            kind: 'ruled',
            clause: 'R2',
            reading: {
                statedMeasure: 'one cup',
                quantity: exact(1),
                unit: 'cup',
                foods: [{ name: 'almonds', prep: 'blanched chopped finely' }],
            },
            note: 'The CRF got half of it — `chopped finely` into prep, `blanched` left in the name. Both are participles and both belong in prep; `finely` is a qualifier by the `-ly` rule.',
        },
    },
    {
        seed: 'L01925',
        line: 'one cup of stale rye bread crumbs added gradually',
        occurrences: 1,
        regimes: ['prep', 'singleAmount'],
        verdict: {
            kind: 'ruled',
            clause: 'R2',
            reading: {
                statedMeasure: 'one cup',
                quantity: exact(1),
                unit: 'cup',
                foods: [{ name: 'stale rye bread crumbs', prep: 'added gradually' }],
            },
            note: 'Three clauses in agreement: `stale` is in `ADJECTIVES` so it stays identity (R3), `added` is a participle (R2), `gradually` is a qualifier by the `-ly` rule. ⚠️ `added gradually` is really an instruction rather than a preparation, but the ruling does not distinguish the two and the field it lands in is the same.',
        },
    },
    {
        seed: 'L01949',
        line: 'four tablespoons of flour over one and one-half pints huckleberries',
        occurrences: 1,
        regimes: ['multiFood', 'composite'],
        verdict: {
            kind: 'ruled',
            clause: 'R7',
            reading: {
                statedMeasure: 'four tablespoons',
                quantity: exact(4),
                unit: 'tablespoon',
                foods: [
                    { name: 'flour', prep: null },
                    { name: 'huckleberries', prep: null },
                ],
            },
            note: 'The CRF named only `flour`, dropping the second food and its composite amount entirely. The leading measure is the one `ParsedFacts` can hold; the huckleberries survive as a food with their amount unrepresented.',
        },
    },
    {
        seed: 'L01950',
        line: 'one pint crumbed bread in one quart milk',
        occurrences: 1,
        regimes: ['multiFood', 'prep'],
        verdict: {
            kind: 'ruled',
            clause: 'R12',
            reading: {
                statedMeasure: 'one pint',
                quantity: exact(1),
                unit: 'pint',
                foods: [
                    { name: 'bread', prep: 'crumbed' },
                    { name: 'milk', prep: null },
                ],
            },
            note: "ADR-0026 §7's value-corruption case exactly — `one-half pound chocolate in one cup of water` in another spelling. The tail after `in` is a SECOND FOOD, the cut is correctly refused, and the CRF filed `in one quart milk` as PREPARATION, which loses the milk. R12 is why both foods are named.",
        },
    },
    {
        seed: 'L02008',
        line: 'one cup of suet shaved very fine',
        occurrences: 1,
        regimes: ['prep', 'singleAmount'],
        verdict: {
            kind: 'undecided',
            lenses: {
                cookAloud: '"Shaved very fine" is one instruction.',
                catalog: '`suet` resolves either way.',
                sourceSentence: 'The bare adverb again, intensified by `very`.',
            },
            note: '⛔ RUBRIC GAP B. `shaved` is a participle (R2) but `fine` is in `ADJECTIVES`, so R5 pulls it back into the name as `fine suet`. Same gap as L00114 and L00245; recorded separately because `very` shows the phrase is unmistakably adverbial and the rubric still cannot see it.',
        },
    },
    {
        seed: 'L02038',
        line: 'one cup of scalding milk',
        occurrences: 1,
        regimes: ['prep', 'singleAmount'],
        verdict: {
            kind: 'ruled',
            clause: 'R4',
            reading: {
                statedMeasure: 'one cup',
                quantity: exact(1),
                unit: 'cup',
                foods: [{ name: 'milk', prep: 'scalding' }],
            },
            note: '`scalding` is in the TEMPERATURES set — a present participle, so the `-ed` rule would never have reached it, which is why the temperature vocabulary is explicit.',
        },
    },
    {
        seed: 'L02083',
        line: 'one-fourth pound of crystallized cherries',
        occurrences: 2,
        regimes: ['prep', 'singleAmount'],
        verdict: {
            kind: 'undecided',
            lenses: {
                cookAloud: '"Crystallized cherries" is glacé cherries — a confection.',
                catalog: 'A distinct row from fresh cherries, and mostly sugar.',
                sourceSentence: 'Bought, not made, in this book.',
            },
            note: '⛔ RUBRIC GAP A, the sibling of L01702 and with the same nutritional consequence.',
        },
    },
    {
        seed: 'L02086',
        line: 'one-fourth cup of stoned raisins',
        occurrences: 1,
        regimes: ['prep', 'singleAmount'],
        verdict: {
            kind: 'ruled',
            clause: 'R2',
            reading: {
                statedMeasure: 'one-fourth cup',
                quantity: exact(0.25),
                unit: 'cup',
                foods: [{ name: 'raisins', prep: 'stoned' }],
            },
            note: "`stoned` is named in KTD-11b's own list of participles.",
        },
    },
    {
        seed: 'L02116',
        line: 'a tablespoon of whipped cream',
        occurrences: 1,
        regimes: ['prep', 'singleAmount'],
        verdict: {
            kind: 'ruled',
            clause: 'R2',
            reading: {
                statedMeasure: 'a tablespoon',
                quantity: exact(1),
                unit: 'tablespoon',
                foods: [{ name: 'cream', prep: 'whipped' }],
            },
            note: "Decided, and on the uncomfortable side of KTD-11b's edge: whipped cream is arguably its own thing. The ruling files it as preparation and the reading says so plainly.",
        },
    },
    {
        seed: 'L02256',
        line: 'one quart small silver-skinned onions',
        occurrences: 1,
        regimes: ['prep', 'singleAmount'],
        verdict: {
            kind: 'undecided',
            lenses: {
                cookAloud: '"Silver-skinned onions" is a variety, like a shallot.',
                catalog: 'The variety is the identity; nothing was done to the onion to give it that skin.',
                sourceSentence: 'The book names the variety to distinguish it from a cooking onion.',
            },
            note: '⛔ RUBRIC GAP A via the compound head rule: `head()` reads `skinned`, the `-ed` rule files it as preparation, and the reading becomes `small onions` with prep `silver-skinned` — asking the catalog for a different onion. `small` is correctly identity by R3.',
        },
    },
    {
        seed: 'L02494',
        line: 'one-quarter pound of finely-grated vanilla chocolate',
        occurrences: 1,
        regimes: ['prep', 'singleAmount'],
        verdict: {
            kind: 'ruled',
            clause: 'R2',
            reading: {
                statedMeasure: 'one-quarter pound',
                quantity: exact(0.25),
                unit: 'pound',
                foods: [{ name: 'vanilla chocolate', prep: 'finely-grated' }],
            },
            note: 'The compound head rule reaching the right half, and `vanilla` staying in the name because nothing classifies it — the accepted limit `modifierLexicon` states: an unclassified word is left where the engine put it.',
        },
    },
]);

/**
 * How many cases carry each regime.
 *
 * ⛔ Every regime appears in the result, including the ones with no case, because a key that vanished when
 * its count hit zero would make an empty regime invisible to the very assertion that exists to catch it.
 *
 * @param cases - The census to count.
 * @returns A count per regime, over every member of {@link ORACLE_REGIMES}. Pure.
 */
export function oracleRegimeCensus(cases: readonly OracleCase[]): Readonly<Record<OracleRegime, number>> {
    const census = Object.fromEntries(ORACLE_REGIMES.map((regime) => [regime, 0])) as Record<OracleRegime, number>;

    for (const entry of cases) {
        for (const regime of entry.regimes) {
            census[regime] += 1;
        }
    }

    return census;
}

/**
 * How many cases each rubric clause decided.
 *
 * ⚠️ Counts RULED cases only. An undecided case was reached by no clause, which is the fact the undecided
 * bucket carries; crediting it to the clause that came closest would report the rubric as deciding more
 * than it did.
 *
 * @param cases - The census to count.
 * @returns A count per clause, over every member of {@link RUBRIC_CLAUSES}. Pure.
 */
export function oracleClauseCensus(cases: readonly OracleCase[]): Readonly<Record<RubricClause, number>> {
    const census = Object.fromEntries(RUBRIC_CLAUSES.map((clause) => [clause, 0])) as Record<RubricClause, number>;

    for (const entry of cases) {
        if (entry.verdict.kind === 'ruled') {
            census[entry.verdict.clause] += 1;
        }
    }

    return census;
}

/**
 * Recover one case from its seed.
 *
 * ⛔ The reason a seed exists: a failing assertion reports `L00177` rather than "it happened once", and the
 * line, the clause and the reasoning are all reachable from that alone.
 *
 * @param seed - The corpus line id.
 * @returns The case, or `undefined` when no case carries that seed. Pure.
 */
export function findOracleCase(seed: string): OracleCase | undefined {
    return PARSE_ORACLE.find((entry) => entry.seed === seed);
}

/**
 * How many distinct corpus lines the census stands for.
 *
 * @param cases - The census.
 * @returns The summed occurrences. Pure.
 */
export function oracleLineCoverage(cases: readonly OracleCase[]): number {
    return cases.reduce((sum, entry) => sum + entry.occurrences, 0);
}
