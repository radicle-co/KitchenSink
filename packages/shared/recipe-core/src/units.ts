/**
 * Measurement-unit normalization, gram conversion, and the unit VOCABULARY the editor binds to — shared by
 * nutrition aggregation (recipes), portion extraction (ingredients) and both apps' ingredient editors.
 * Pure — no I/O.
 *
 * DESIGN PATTERN: **Registry behind a pure Specification.** Two lookup tables hold two different kinds of
 * knowledge — {@link UNIT_ALIASES}, the spellings of a word that NAMES AN AMOUNT, and
 * {@link SUBJECTIVE_UNIT_ALIASES}, the spellings of a word a cook writes in the unit field that names NO
 * amount. {@link classifyUnit} is the total, three-way verdict over both. This is the sibling of
 * `recipe-import-core`'s `modifierLexicon.ts`, and it is a vocabulary for the same reason that one is: the
 * boundary is a DEFINITION we made (R31/R40), not a claim about English that a library could settle.
 *
 * A recipe line's `unit` and a food's portion label are free text ("cup", "cups", "Tbsp.", "tablespoon"),
 * so both are reduced to a small canonical vocabulary by {@link normalizeUnit} before any comparison. Grams
 * come from one of two places: an EXACT mass unit ({@link MASS_UNIT_TO_GRAMS}, ingredient-independent), or —
 * for a volumetric/count unit (cup/tbsp/clove) whose weight depends on the food — a matching household
 * portion the food service supplied (grams-per-unit).
 *
 * ## ⛔ U25 — the vocabulary is DERIVED, and the classification is NOT ON THE WIRE
 *
 * {@link UNIT_VOCABULARY} is the deduplicated IMAGE of the alias table, computed here rather than written
 * out: _"a copy of a list cannot detect that the list is incomplete"_ (plan U25). Deriving it is what
 * exposed that the table carried no metric volume at all — see the volume block below.
 *
 * And {@link classifyUnit} is a DERIVATION, never a persisted flag or a second wire field. The plan asks
 * that "the wire can tell `cup` from `handful`", and it can: the wire carries `handful` faithfully, and
 * both ends compute the same verdict from this one table, because `recipe-core` is bundled by both apps and
 * imported by the recipe service. A stored `unitClass` beside the unit string would be a SECOND
 * representation of one fact — the server would have to re-derive it to check it, at which point it can
 * only ever be wrong. The Figma Make mockup rules the same way: its `unitIsRecognized` is computed at render
 * and never stored.
 *
 * ⛔ Consequence, stated so it is not "fixed": `units.ts` is deliberately NOT in the contract's composed-
 * source corpus (`@kitchensink/contract-gen`'s `composedSources.ts` names it among the modules that "churn
 * for reasons that cannot reach the wire"). Composing the vocabulary INTO a request schema — a `z.enum` over
 * it, say — would drag this file into `CONTRACT_HASH` and reverse that decision, for a rule the wire must
 * not have anyway: **an unknown unit is accepted, never rejected.**
 *
 * ## ⛔ 2026-08-25 — CAPITALISATION CARRIES MEANING IN EXACTLY ONE PLACE
 *
 * `T` is a tablespoon and `t` is a teaspoon — the standard American recipe convention, ruled by the owner.
 * Every other unit here is case-INSENSITIVE and stays that way. The distinction lives in
 * {@link CASE_SENSITIVE_UNIT_ALIASES}, read by {@link normalizeUnit} BEFORE the lower-casing fold, and the
 * accepted risk it takes is written down beside it. There is now exactly ONE fold in this module, inside
 * {@link normalizeUnit} and after that read; {@link classifyUnit} delegates rather than cleaning. Do not
 * hoist the fold back above the case-sensitive read, and do not give either function a pre-clean of its
 * own — that step IS the defect.
 */
import type { IngredientPortion } from './recipe.types.js';

/** Canonical unit → grams for the units whose conversion is exact and ingredient-independent (mass). */
export const MASS_UNIT_TO_GRAMS: Readonly<Record<string, number>> = {
    g: 1,
    kg: 1000,
    mg: 0.001,
    oz: 28.3495,
    lb: 453.592,
};

/** Aliases → canonical unit. Everything else normalizes to its lower-cased, de-pluralized self. */
const UNIT_ALIASES: Readonly<Record<string, string>> = {
    gram: 'g',
    grams: 'g',
    g: 'g',
    kilogram: 'kg',
    kilograms: 'kg',
    kg: 'kg',
    milligram: 'mg',
    milligrams: 'mg',
    mg: 'mg',
    ounce: 'oz',
    ounces: 'oz',
    oz: 'oz',
    pound: 'lb',
    pounds: 'lb',
    lb: 'lb',
    lbs: 'lb',
    cup: 'cup',
    cups: 'cup',
    tablespoon: 'tablespoon',
    tablespoons: 'tablespoon',
    tbsp: 'tablespoon',
    tbs: 'tablespoon',
    tbl: 'tablespoon',
    teaspoon: 'teaspoon',
    teaspoons: 'teaspoon',
    tsp: 'teaspoon',
    // R31 sibling of the `T`/`t` pair below, and DELIBERATELY here in the case-INSENSITIVE table rather
    // than in `CASE_SENSITIVE_UNIT_ALIASES`. `parse-ingredient` carries `C` and `c` as cup alternates and
    // this table carried neither, so `2 C flour` normalized to itself, classified `unknown`, and lost its
    // gram conversion — the same defect `T`/`t` had. ⛔ But it is NOT the same RULING: `T` vs `t` needed a
    // convention asserted (capital means tablespoon) and pays for it with a silent-tripling risk, whereas
    // BOTH cases of `c` mean cup. There is no second meaning to collide with, so the ordinary fold is
    // correct and no case-sensitive entry is owed. Adding one would be the wrong abstraction: it would
    // imply a distinction that does not exist.
    c: 'cup',
    // R31 — the `*ful` family. A 1900s cookbook writes `teaspoonful`, and the de-pluralization fallback
    // below cannot reach it (no trailing `s`), so it normalized to itself, matched no portion, and cost
    // the line its gram conversion.
    teaspoonful: 'teaspoon',
    teaspoonfuls: 'teaspoon',
    tablespoonful: 'tablespoon',
    tablespoonfuls: 'tablespoon',
    cupful: 'cup',
    cupfuls: 'cup',
    // R32 — the HISTORICAL volume units, added by U7 alongside the `*ful` family above.
    //
    // ⚠️ This REDRAWS the boundary the R31 comment drew rather than erasing it. That comment excluded
    // `wineglassful` with the rest of the `*ful` words on the grounds that it "names no defined amount".
    // It does: Project Gutenberg #12350's own TABLE OF WEIGHTS AND MEASURES prints `4 tablespoons = 1
    // wine-glass`, and the named external standard covers the rest. `handful`, `spoonful` and `glassful`
    // remain absent, because those genuinely name no amount and supplying one would invent a quantity the
    // source never stated (R40).
    //
    // ⛔ Canonicalising the SPELLING is all that happens here. A historical unit has no
    // ingredient-independent gram weight and `unitToGrams` deliberately returns `null` for one; the
    // equivalence that gives it a value is PER SOURCE BOOK and lives in `@kitchensink/cookbook-import`'s
    // `unitEquivalence.ts`, because two books can print two different values for the same word (an
    // imperial gill is 142 mL against the US customary 118 mL). What this table buys is that the word is
    // spelled ONE way by the time that lookup happens.
    gill: 'gill',
    gills: 'gill',
    wineglass: 'wineglass',
    wineglasses: 'wineglass',
    wineglassful: 'wineglass',
    wineglassfuls: 'wineglass',
    'wine-glass': 'wineglass',
    'wine-glasses': 'wineglass',
    'wine-glassful': 'wineglass',
    'wine-glassfuls': 'wineglass',
    saltspoon: 'saltspoon',
    saltspoons: 'saltspoon',
    saltspoonful: 'saltspoon',
    saltspoonfuls: 'saltspoon',
    dessertspoon: 'dessertspoon',
    dessertspoons: 'dessertspoon',
    dessertspoonful: 'dessertspoon',
    dessertspoonfuls: 'dessertspoon',
    'dessert-spoon': 'dessertspoon',
    'dessert-spoons': 'dessertspoon',
    'dessert spoon': 'dessertspoon',
    'dessert spoons': 'dessertspoon',
    // U25 — the METRIC AND IMPERIAL VOLUME families, absent until deriving `UNIT_VOCABULARY` made
    // their absence visible. The table carried `cup`, `tablespoon` and `teaspoon` and no `ml` at all, so a
    // vocabulary shipped off it would have called the commonest unit in half the world's recipes
    // unrecognised. This is the derivation doing exactly what U25 says a hand-written copy cannot.
    //
    // ⛔ The canonical forms are the SPELLED-OUT words, matching the volume convention above rather than
    // the ABBREVIATION convention the mass family uses — and that is load-bearing rather than cosmetic.
    // `recipe-import-core`'s `millilitresPerUnit` feeds this function's output straight to
    // `parse-ingredient`'s `convertUnit`, which was measured 2026-08-25 to answer for `milliliter`/`liter`
    // and `null` for `millilitre`/`litre`. So the British spellings were a live DEFECT: a British source's
    // volume was unconvertible. Canonicalising onto the American spelling is the fix.
    //
    // ⛔ `fl oz` maps to `fluid ounce` and NEVER to `oz`. `oz` is a key of `MASS_UNIT_TO_GRAMS`, so
    // that alias would hand a volume an exact, ingredient-independent gram weight — silently weighing a
    // fluid ounce of honey as if it were a mass ounce.
    ml: 'milliliter',
    milliliter: 'milliliter',
    milliliters: 'milliliter',
    millilitre: 'milliliter',
    millilitres: 'milliliter',
    l: 'liter',
    liter: 'liter',
    liters: 'liter',
    litre: 'liter',
    litres: 'liter',
    pint: 'pint',
    pints: 'pint',
    quart: 'quart',
    quarts: 'quart',
    gallon: 'gallon',
    gallons: 'gallon',
    'fl oz': 'fluid ounce',
    floz: 'fluid ounce',
    'fluid ounce': 'fluid ounce',
    'fluid ounces': 'fluid ounce',
    clove: 'clove',
    cloves: 'clove',
    slice: 'slice',
    slices: 'slice',
    piece: 'piece',
    pieces: 'piece',
    stick: 'stick',
    sticks: 'stick',
    pinch: 'pinch',
    pinches: 'pinch',
};

/**
 * Aliases → canonical form, for the words a cook writes in the unit field that name **NO defined amount**.
 *
 * ⛔ THIS IS THE COMPLEMENT R31/R40 NAMED, PROMOTED FROM PROSE TO DATA — not a second copy of
 * {@link UNIT_ALIASES}, and the two are DISJOINT by their own definitions (asserted in `units.test.ts`). A
 * word belongs above if it names an amount and here if it does not; nothing can be in both.
 *
 * ⚠️ R31's comment excluded `handful`, `spoonful` and `glassful` from the table above because they
 * "genuinely name no amount and supplying one would invent a quantity the source never stated (R40)". That
 * reasoning STANDS and is untouched: {@link unitToGrams} still refuses to put a number on any word here,
 * exactly as it refuses one for a historical unit. What the exclusion could NOT do was let anything TELL
 * these words apart from a typo — `handful` and `carrot` were both "not in the table", so the editor had no
 * way to say "that is a real measure, just not a countable one" rather than treating it as an error.
 *
 * ⛔ Canonicalising the SPELLING is all that happens here — the same sentence R32's block above uses for
 * the historical units, and for the same reason. `splashes` normalized to `splashe` under the
 * de-pluralization fallback, which is a word nothing can match.
 *
 * ⛔ `dash` and `pinch` are deliberately ABSENT from this table. Both name a conventional amount (a pinch is
 * a sixteenth of a teaspoon), `pinch` is already an alias above, and moving it would change
 * `normalizeUnit('pinches')` from `pinch` to `pinche`. The boundary is "names an amount", not "is vague".
 */
const SUBJECTIVE_UNIT_ALIASES: Readonly<Record<string, string>> = {
    handful: 'handful',
    handfuls: 'handful',
    spoonful: 'spoonful',
    spoonfuls: 'spoonful',
    glassful: 'glassful',
    glassfuls: 'glassful',
    splash: 'splash',
    splashes: 'splash',
    drizzle: 'drizzle',
    drizzles: 'drizzle',
    knob: 'knob',
    knobs: 'knob',
    'to taste': 'to taste',
    'as needed': 'as needed',
};

/**
 * Aliases → canonical unit for the ONE pair whose CAPITALISATION carries meaning: `T` is a tablespoon and
 * `t` is a teaspoon (owner ruling, 2026-08-25).
 *
 * ⛔ SEPARATE FROM {@link UNIT_ALIASES} BECAUSE IT IS READ DIFFERENTLY, not because it is a different kind
 * of knowledge. {@link normalizeUnit} lower-cases before every lookup, which is right for every other unit
 * in the vocabulary — `Tbsp`, `TBSP`, `Cup` and `GRAM` are all the same word as their lower-case selves —
 * and it is exactly what destroyed this pair. Measured before this table existed: `normalizeUnit('T')` and
 * `normalizeUnit('t')` both returned `'t'`, which is in no table at all, so both classified `unknown` and
 * `parseIngredientLine('2 T butter')` stored `unit: 't'`. Two genuinely different units were
 * INDISTINGUISHABLE in the persisted data, which is why a later fix could not have separated them
 * retroactively — see the note on data at rest below.
 *
 * ⚠️ THE ACCEPTED RISK, RECORDED BESIDE THE DECISION THAT TAKES IT. A sloppy source that writes `t` meaning
 * TABLESPOON is now read three times too SMALL, silently — nothing downstream can tell an under-stated
 * amount from a correct one. The owner accepted that on 2026-08-25, on the grounds that the convention is
 * the standard American one and that the alternative (leaving both `unknown`) loses the amount entirely for
 * BOTH spellings. It is the same silent-wrongness class as summing an equivalence in
 * `recipe-import-core`'s `splitMeasurement` (stated vs restated), and it is written here rather than in a
 * plan so that the next reader of this table meets it as a decision instead of discovering it.
 *
 * ⚠️ DATA AT REST. Rows persisted BEFORE this ruling carry `unit: 't'` for both spellings and are
 * permanently ambiguous — the information needed to separate them was destroyed at write time. No
 * migration may guess: a backfill mapping historical `'t'` to either canonical form would assert a fact the
 * data does not contain, and would silently triple or third a real cook's amount. They stay `'t'`, which
 * classifies `unknown` and is honest.
 *
 * ⛔ EXACTLY TWO ENTRIES, and adding a third is a decision, not a convenience. Any key here SHADOWS the
 * case-insensitive path for that exact spelling, so a key whose lower-case form is already a
 * {@link UNIT_ALIASES} key would split one unit into two silently — `G`/`g` is the live example (`g` is
 * gram) and `L`/`l` the near miss (`l` is litre, and `L` must keep meaning litre). `units.test.ts` pins
 * both of those staying case-INSENSITIVE.
 */
export const CASE_SENSITIVE_UNIT_ALIASES: Readonly<Record<string, string>> = {
    T: 'tablespoon',
    t: 'teaspoon',
};

/**
 * The case-sensitive spellings, FOLDED — the question "is this a spelling whose meaning depends on case?"
 * can only be asked of a token that has already lost its case, so the key it is asked with is lower-case.
 */
const CASE_DEPENDENT_UNIT_SPELLINGS: ReadonlySet<string> = new Set(
    Object.keys(CASE_SENSITIVE_UNIT_ALIASES).map((spelling) => spelling.toLowerCase()),
);

/**
 * The deduplicated, sorted image of one or more spellings tables — their canonical vocabulary.
 *
 * ⛔ VARIADIC so that {@link UNIT_VOCABULARY} stays the image of EVERY table {@link normalizeUnit} reads.
 * A second table that the derivation did not see would reintroduce exactly the defect U25 removed: a
 * vocabulary that cannot detect that it is incomplete.
 *
 * @param aliases - The alias tables to take the combined image of.
 * @returns Every distinct canonical form those tables can produce, sorted. Pure.
 */
const vocabularyOf = (...aliases: readonly Readonly<Record<string, string>>[]): readonly string[] =>
    Object.freeze([...new Set(aliases.flatMap((table) => Object.values(table)))].sort());

/**
 * Every canonical unit {@link normalizeUnit} can produce from the amount-naming tables — the list an
 * ingredient editor's unit autocomplete binds to (plan U25).
 *
 * ⛔ DERIVED FROM THE TABLES, never restated. A hand-written second list cannot detect that the first one is
 * incomplete, which is precisely the defect the volume block above records. {@link CASE_SENSITIVE_UNIT_ALIASES}
 * is derived through the SAME function rather than assumed to be covered — and the derivation is what proves
 * the 2026-08-25 ruling adds SPELLINGS and no canonical FORM, since `tablespoon` and `teaspoon` were already
 * members. Had `T` mapped to something new, it would be in the vocabulary automatically instead of missing
 * from it.
 *
 * ⚠️ It is the RECOGNITION vocabulary, not a suggestion list: it includes `gill`, `wineglass`, `saltspoon`
 * and `dessertspoon`, which are right to recognise in a transcribed 1900s cookbook and odd to offer a modern
 * cook. Narrowing what is SUGGESTED is a product decision for the surface that suggests, not a change here.
 */
export const UNIT_VOCABULARY: readonly string[] = vocabularyOf(UNIT_ALIASES, CASE_SENSITIVE_UNIT_ALIASES);

/**
 * Every canonical form {@link normalizeUnit} can produce from {@link SUBJECTIVE_UNIT_ALIASES} — the words a
 * cook may legitimately write that name no amount.
 *
 * Derived on the same terms as {@link UNIT_VOCABULARY}, and disjoint from it.
 */
export const SUBJECTIVE_UNIT_VOCABULARY: readonly string[] = vocabularyOf(SUBJECTIVE_UNIT_ALIASES);

/** {@link UNIT_VOCABULARY} as a set, for {@link classifyUnit}'s membership test. */
const CANONICAL_UNITS: ReadonlySet<string> = new Set(UNIT_VOCABULARY);

/** {@link SUBJECTIVE_UNIT_VOCABULARY} as a set, for {@link classifyUnit}'s membership test. */
const SUBJECTIVE_UNITS: ReadonlySet<string> = new Set(SUBJECTIVE_UNIT_VOCABULARY);

/**
 * What a unit string IS, as far as this vocabulary can tell.
 *
 * Three members, not two, and the third is not a failure: `unknown` is what an editor renders when a cook
 * writes something we have never seen, and the wire accepts it unchanged. `subjective` is the state the
 * plan asks to be able to "mark" — a real measure, just not one anything can weigh.
 */
export type UnitClass = 'canonical' | 'subjective' | 'unknown';

/**
 * Trim and drop a trailing `.` — the punctuation-and-whitespace half of "cleaned", with CASE UNTOUCHED.
 *
 * ⛔ THE PARSE BOUNDARY, AND THE ONLY ONE (owner ruling, 2026-08-25). It replaced a single helper that
 * trimmed AND lower-cased in one step, which is what made `T` and `t` the same word. Splitting it — rather
 * than bolting a second normalization path onto {@link normalizeUnit} — is what keeps this ONE fold
 * expressed as two ordered steps: `T.` and ` T ` are still the same word as `T`, and nobody has to restate
 * what "trailing punctuation" means. Adding a second cleaner anywhere is the "two folds" failure
 * `cookbook-import`'s `parseNormalization.ts` exists to prevent.
 *
 * @param raw - The unit as written.
 * @returns The trimmed form, case preserved. Pure.
 */
const trimUnit = (raw: string): string => raw.trim().replace(/\.$/, '');

/**
 * Whether a spelling's canonical unit is decided by its CAPITALISATION — `T`/`t` and nothing else today.
 *
 * ⛔ DERIVED from {@link CASE_SENSITIVE_UNIT_ALIASES}, never restated, on the same terms as
 * {@link UNIT_VOCABULARY}: a second hand-written list of case-sensitive spellings could not detect that the
 * table had grown.
 *
 * ⚠️ IT EXISTS FOR A CALLER THAT HAS ALREADY FOLDED CASE AND THEREFORE CANNOT ANSWER — never for one
 * deciding how to normalise. `cookbook-import`'s `unitComparableWords` receives `rankingTokens` output,
 * which `foldForRanking` lower-cased on the way to a rule the persisted match grain mirrors in SQL, so the
 * case is irrecoverable there. For such a token the unit is genuinely UNDETERMINED, and this is how that
 * caller says so instead of guessing: a stray `t` inside a food name is a letter, not a teaspoon.
 *
 * ⛔ A caller that still HAS the case must not reach for this. It hands the spelling to
 * {@link normalizeUnit} intact, which is the whole point of the ruling.
 *
 * @param spelling - A unit spelling, in any case.
 * @returns `true` when capitalisation decides which unit it names. Pure.
 */
export const unitSpellingDependsOnCase = (spelling: string): boolean =>
    CASE_DEPENDENT_UNIT_SPELLINGS.has(trimUnit(spelling).toLowerCase());

/**
 * Reduce a raw unit string to its canonical form: trimmed, trailing `.` stripped, the two case-sensitive
 * spellings resolved, then lower-cased, known aliases mapped, and an unknown trailing `s` removed (so
 * `carrots` → `carrot`). Pure.
 *
 * ⛔ {@link CASE_SENSITIVE_UNIT_ALIASES} IS CONSULTED FIRST, AND IT IS THE ONLY LOOKUP THAT CAN SEE CASE.
 * `T` is a tablespoon and `t` is a teaspoon; every other unit in the vocabulary is case-INSENSITIVE and
 * must stay that way, which is why this is one small table read before the fold rather than a
 * case-sensitivity rule spread over the main one. See that table for the accepted risk this takes.
 *
 * ⚠️ {@link SUBJECTIVE_UNIT_ALIASES} is consulted AFTER {@link UNIT_ALIASES}, so no spelling that resolved
 * before this table existed resolves differently now. It canonicalises the SPELLING only — no gram weight
 * follows, exactly as none follows for a historical unit.
 */
export function normalizeUnit(raw: string): string {
    const trimmed = trimUnit(raw);
    const cased = CASE_SENSITIVE_UNIT_ALIASES[trimmed];

    if (cased !== undefined) {
        return cased;
    }

    // ⛔ THE ONLY FOLD IN THIS MODULE, and it happens exactly once, after the case-sensitive read. Nothing
    // else here or in any caller may lower-case a unit; `classifyUnit` delegates rather than cleaning, so
    // there is no second place for the two to disagree.
    const cleaned = trimmed.toLowerCase();
    const alias = UNIT_ALIASES[cleaned] ?? SUBJECTIVE_UNIT_ALIASES[cleaned];

    if (alias !== undefined) {
        return alias;
    }

    // Best-effort de-pluralization for units not in either alias table (e.g. a food-specific "carrots").
    return cleaned.endsWith('s') && cleaned.length > 1 ? cleaned.slice(0, -1) : cleaned;
}

/**
 * Decide whether a unit string names an amount, names no amount, or is a word this vocabulary has never
 * seen — plan U25's canonical/subjective distinction.
 *
 * ⛔ TOTAL, and it NEVER rejects. `unknown` is a verdict, not an error: a cook may write anything in the
 * unit field ("the size of an egg" is a real line from a real cookbook, R40), and the wire stores it
 * unchanged. The only thing this decides is how a surface RENDERS it.
 *
 * ⛔ The two tables are disjoint, so the order of the two membership tests below cannot change an answer —
 * `units.test.ts` asserts the disjointness rather than relying on the order.
 *
 * ⛔ IT CLEANS NOTHING — it is a set-membership verdict over {@link normalizeUnit}'s output and no more
 * (owner ruling, 2026-08-25). It used to pre-clean with a lower-casing helper, which would have destroyed
 * `T` vs `t` on the way in even with {@link normalizeUnit} fixed; trimming first instead would have worked
 * but left a SECOND fold, and the two could still disagree — the old double-clean answered `canonical` for
 * `Tbsp..` while `normalizeUnit` answered `tbsp.`, a word in no vocabulary. Delegating outright removes
 * the disagreement by construction rather than by care. Anything that folds a unit BEFORE handing it to
 * either function has the same defect; there is no reason to, because `normalizeUnit` cleans its own input.
 *
 * @param raw - The unit as the cook wrote it.
 * @returns Which kind of unit it is. Pure.
 */
export function classifyUnit(raw: string): UnitClass {
    const normalized = normalizeUnit(raw);

    if (normalized === '') {
        return 'unknown';
    }

    if (SUBJECTIVE_UNITS.has(normalized)) {
        return 'subjective';
    }

    return CANONICAL_UNITS.has(normalized) ? 'canonical' : 'unknown';
}

/**
 * Convert `quantity` of `unit` to grams — via an exact mass unit, else a matching household portion. Pure.
 *
 * @returns The gram weight, or `null` when the unit is neither a mass unit nor covered by a portion.
 */
export function unitToGrams(
    quantity: number,
    unit: string,
    portions: readonly IngredientPortion[] = [],
): number | null {
    const normalized = normalizeUnit(unit);

    const massFactor = MASS_UNIT_TO_GRAMS[normalized];

    if (massFactor !== undefined) {
        return quantity * massFactor;
    }

    const portion = portions.find((candidate) => normalizeUnit(candidate.unit) === normalized);

    if (portion !== undefined) {
        return quantity * portion.gramsPerUnit;
    }

    return null;
}
