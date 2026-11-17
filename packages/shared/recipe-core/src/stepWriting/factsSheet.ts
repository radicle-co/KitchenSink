/**
 * The facts sheet builder (spec 027 FR-035, FR-041, research R1, R11): code reads the facts out of a recipe's steps, and
 * the step writer is shown those and never the steps.
 *
 * DESIGN PATTERN: a pipeline of pure readers over one step, each producing one fact kind, assembled into the sheet.
 * Durations come in through a port because `@kitchensink/cooking-core` already depends on this package.
 *
 * Coverage (R11): every source step is kept, in order, including a step with no facts. A later fact check requires
 * coverage only of steps that carry at least one fact.
 *
 * The sheet holds no step wording. Every string in it is a lexicon key, a normalised number, a unit, or a name from the
 * recipe's own ingredient lines.
 *
 * Reachable through `@kitchensink/recipe-core/step-writing/facts-sheet`.
 *
 * @pattern Pipeline of pure functions
 * @pattern Port (injected duration reader)
 */
import { amountAt, leadingAmount } from '../parsing/measureReader.js';
import { CONTAINER_WORDS } from '../parsing/parentheticalMeasure.js';
import { escapeRegExp } from '../parsing/escapeRegExp.js';
import {
    LONG_TIME_UNIT_WORDS,
    SECONDS_PER_TIME_UNIT,
    TIME_UNIT_WORDS,
    type LongTimeUnit,
    type TimeUnit,
} from '../timeUnitWords.js';
import { classifyUnit, LENGTH_UNIT_VOCABULARY, normalizeUnit } from '../units.js';

import {
    SAFETY_CATEGORIES,
    type FactAmount,
    type FactDuration,
    type FactSafety,
    type FactTemperature,
    type FactsSheet,
    type FactsStep,
} from './factsSheet.types.js';
import { ALPHABET_BY_LANGUAGE, isOutputLanguage, PLAIN_FACT_PUNCTUATION, type OutputLanguage } from './alphabet.js';
import {
    FactsSheetInvalidError,
    NAME_WORD_CHARS,
    toPlainFactsSheet,
    assertIngredientName,
    wordsOf,
} from './factsSheetInput.js';
import {
    ACTION_VERBS,
    EQUIPMENT,
    FUNCTION_WORDS,
    INSTRUCTION_ADVERBS,
    READING_VERBS,
    SAFETY_RULES,
    type SafetyTerm,
} from './stepLexicons.js';

import type { RecipeIngredientView, RecipeStep } from '../recipe.types.js';

/** The readers a sheet is built with. Durations are injected: the real reader lives in a package that imports this one. */
export interface FactsSheetReaders {
    /**
     * The durations the text states, in seconds: one duration for one span of time ("20 minutes", "1 hour 30 minutes",
     * "ten minutes"), and none when the text states none. The sheet hands it one time written in digits, or one sentence
     * that has no digit time, and never a whole step. A range gives its low and high ends.
     */
    durations(text: string): readonly FactDuration[];
}

/**
 * The part of a recipe the sheet reads: its language, the ingredient lines, and its step texts. A line is named by the
 * text it shows, else by its bound food's name.
 */
export interface StepSourceRecipe {
    readonly language: string;
    readonly ingredientLines: readonly Pick<RecipeIngredientView, 'displayText' | 'name'>[];
    readonly steps: readonly Pick<RecipeStep, 'instruction'>[];
}

const NOT_LETTER_OR_DIGIT_BEFORE = String.raw`(?<![\p{L}\p{N}])`;
const NOT_LETTER_OR_DIGIT_AFTER = String.raw`(?![\p{L}\p{N}])`;

/** Between the words of a lexicon phrase: space or hyphen, never a sentence end. */
const PHRASE_JOINER = String.raw`[\s-]+`;

/** A phrase as a pattern: its words joined, an apostrophe of either kind, a plural `s` allowed. */
function phrasePattern(phrase: string, joiner: string): string {
    const words = wordsOf(phrase).map((word) => escapeRegExp(word).replaceAll(/['’]/gu, "['’]"));

    return `${words.join(joiner)}(?:e?s)?`;
}

/** One compiled matcher for a set of phrases, matching on word boundaries and ignoring case. */
const matcherOf = (phrases: readonly string[], flags: string): RegExp =>
    new RegExp(
        `${NOT_LETTER_OR_DIGIT_BEFORE}(?:${phrases.map((phrase) => phrasePattern(phrase, PHRASE_JOINER)).join('|')})${NOT_LETTER_OR_DIGIT_AFTER}`,
        flags,
    );

// ── Actions and equipment ──

const EQUIPMENT_MATCHERS: readonly (readonly [string, RegExp])[] = EQUIPMENT.map((item) => [
    item,
    matcherOf([item], 'giu'),
]);

interface Span {
    readonly start: number;
    readonly end: number;
}

/** The spans that are not inside a strictly longer span, so "butter" inside "peanut butter" is not counted. */
function outermost<T extends Span>(found: readonly T[]): T[] {
    const inside = (a: Span, b: Span): boolean =>
        a.start >= b.start && a.end <= b.end && a.end - a.start < b.end - b.start;

    return found.filter((entry) => !found.some((other) => inside(entry, other)));
}

/** The text with each span blanked to spaces, so offsets hold and no word is read out of it. */
function blanked(text: string, spans: readonly Span[]): string {
    return spans.reduce(
        (rest, { start, end }) => `${rest.slice(0, start)}${' '.repeat(end - start)}${rest.slice(end)}`,
        text,
    );
}

/** A clause: the text between marks that end one. */
const CLAUSE = /[^.,;:!?()\n]+/gu;
const WORD = /[\p{L}\p{N}'’-]+/gu;

/**
 * The closed-lexicon verbs a step uses as instructions, in order of first use, once each. A verb counts only in its base
 * form, at an instruction position: the start of a clause (after any of a closed list of adverbs), or right after "and"
 * or "then". The words of equipment and of ingredients are not read (a baking sheet is no baking, brown sugar is no
 * browning), and a verb before "of" is a noun ("rest of the batter").
 */
function actionsOf(text: string, namedThings: readonly Span[]): string[] {
    const found = [...blanked(text, namedThings).matchAll(CLAUSE)].flatMap(([clause]) => {
        const words = [...clause.matchAll(WORD)].map((match) => match[0].toLowerCase());

        const afterAdverbs = (from: number): number => {
            let at = from;

            while (INSTRUCTION_ADVERBS.has(words[at] ?? '')) {
                at += 1;
            }

            return at;
        };

        const starts = [0, ...words.flatMap((word, index) => (word === 'and' || word === 'then' ? [index + 1] : []))];

        return starts.flatMap((start) => {
            const word = words[afterAdverbs(start)] ?? '';
            const next = words[afterAdverbs(start) + 1];

            return Object.hasOwn(ACTION_VERBS, word) && next !== 'of' ? [ACTION_VERBS[word] ?? word] : [];
        });
    });

    return [...new Set(found)];
}

/** The closed-lexicon equipment in a step, outermost match only, in order of use. */
function equipmentMatchesOf(text: string): { item: string; start: number; end: number }[] {
    return outermost(
        EQUIPMENT_MATCHERS.flatMap(([item, matcher]) =>
            [...text.matchAll(matcher)].map((match) => ({
                item,
                start: match.index,
                end: match.index + match[0].length,
            })),
        ),
    ).sort((a, b) => a.start - b.start);
}

// ── Temperatures ──

const NUMBER = String.raw`(?<![\p{N}.,])\d+(?:[.,]\d+)?`;
const SCALE_WORD = String.raw`celsius|fahrenheit|centigrade`;

/**
 * A temperature: a number (or a range of two) and a scale. The scale is a degree sign with C or F or a scale word,
 * "degrees" with a scale, a scale word, or a bare C or F straight after the number. "Degrees" with no scale is not
 * matched: it is read later as a count, so it stays protected and is never guessed at.
 */
const TEMPERATURE = new RegExp(
    String.raw`(?:(?<low>${NUMBER})\s*(?:[-–—]|to)\s*)?(?<high>${NUMBER})` +
        String.raw`(?:\s*°\s*(?<sign>[CF])(?!\p{L})|\s*°\s*(?<signWord>${SCALE_WORD})` +
        String.raw`|\s*(?:degrees?|deg\.?)\s*(?<degree>[CF](?!\p{L})|${SCALE_WORD})` +
        String.raw`|\s*(?<word>${SCALE_WORD})|\s?(?<bare>[CF])(?!\p{L}))`,
    'giu',
);

/** The smallest number a bare C or F after it is read as a temperature. Below it, "1 C" is a cup. */
const MIN_BARE_SCALE_TEMPERATURE = 50;

/** A temperature and where in the step it is written. */
interface PlacedTemperature extends FactTemperature {
    readonly start: number;
}

const numberOf = (token: string): number | undefined => amountAt([token], 0)?.low;

/**
 * The temperatures in a step and the text with them blanked out, so no amount is read from a temperature
 * ("200 C" holds a cup in the unit table).
 */
function readTemperatures(text: string): { temperatures: PlacedTemperature[]; rest: string } {
    const temperatures: PlacedTemperature[] = [];
    const spans: Span[] = [];

    for (const match of text.matchAll(TEMPERATURE)) {
        const { low, high, sign, signWord, degree, word, bare } = match.groups ?? {};
        const marker = sign ?? signWord ?? degree ?? word ?? bare ?? '';
        const highValue = numberOf(high ?? '');

        if (
            highValue === undefined ||
            marker === '' ||
            (bare !== undefined && highValue < MIN_BARE_SCALE_TEMPERATURE)
        ) {
            continue;
        }

        const scale = marker.toUpperCase().startsWith('F') ? 'F' : 'C';
        const lowValue = low === undefined ? undefined : numberOf(low);

        const start = match.index;

        temperatures.push(...(lowValue === undefined ? [] : [{ value: lowValue, scale, start } as const]), {
            value: highValue,
            scale,
            start,
        });
        spans.push({ start, end: start + match[0].length });
    }

    return { temperatures, rest: blanked(text, spans) };
}

// ── Ingredients ──

interface IngredientMatcher {
    readonly name: string;
    readonly matcher: RegExp;
    /**
     * Any run of the name's words but the first, anchored where it is tried (sticky) and ending at a phrase edge ("Cheddar"
     * and "cheese" for "shredded Cheddar cheese"). `null` for a name of one word. An amount directly before it counts as
     * the edge on its left.
     */
    readonly runAfterAmount: RegExp | null;
}

/** Format (`\p{Cf}`) and default-ignorable characters, as a regex class body. */
const HIDDEN = String.raw`\p{Cf}\p{Default_Ignorable_Code_Point}`;

/**
 * What a name is cleaned of: anything outside letters, marks, numbers and the plain punctuation becomes a space. A name
 * with a hidden character is refused before it is cleaned, so this set never sees one.
 */
const OUTSIDE_PLAIN_NAME = new RegExp(`[^\\p{L}\\p{M}\\p{N}${escapeRegExp(PLAIN_FACT_PUNCTUATION)}]`, 'gu');

/** A whole emoji sequence: the pictograph with any presentation selector, skin tone or joined part. Decoration. */
// Built from a string: the `v` flag needs ES2024, which the engine runs on (see `alphabet.ts`) and this package's target does not name.
const EMOJI_SEQUENCE = new RegExp(String.raw`\p{RGI_Emoji}`, 'gv');

/** A hidden character anywhere in a text. Not global, so `test` keeps no position between calls. */
const HAS_HIDDEN_CHARACTER = new RegExp(`[${HIDDEN}]`, 'u');

const HIDDEN_CHARACTERS = new RegExp(`[${HIDDEN}]`, 'gu');

/** A step's text without its hidden characters, in NFC, so none can split a word or hide a fact from a reader. */
const readableStep = (text: string): string => text.replaceAll(HIDDEN_CHARACTERS, '').normalize('NFC');

/**
 * A line's text as a plain name, in NFC, so the sheet holds the form that was checked: what is outside the plain set
 * becomes a space, and the name starts at a letter, mark, number or apostrophe. It is never cut: a name that is too
 * long is refused, not made into text the cook did not write. A name with nothing plain in it is empty.
 */
function plainNameOf(text: string): string {
    const spaced = text.normalize('NFC').replaceAll(OUTSIDE_PLAIN_NAME, ' ').replaceAll(/\s+/gu, ' ');

    return spaced.replace(new RegExp(`^[^${NAME_WORD_CHARS}]+`, 'u'), '').trim();
}

/**
 * The name of one ingredient line: the text it shows, else its bound food's name.
 *
 * The raw text is checked before it is made plain, so a link is refused and never sanitised into a name. A line that is
 * an address, outside the alphabet, too long, or step text refuses the whole sheet: dropping it would describe another
 * recipe, and cleaning or cutting it would be text the cook never wrote.
 *
 * @throws {FactsSheetInvalidError} Naming the line, never its text.
 */
function nameOfLine(
    line: StepSourceRecipe['ingredientLines'][number],
    index: number,
    language: OutputLanguage,
): string | undefined {
    const field = `ingredientLines[${index}]`;

    for (const raw of [line.displayText ?? '', line.name ?? '']) {
        // An emoji is decoration, not a fact: the whole sequence goes, then the name is checked.
        const undecorated = raw.replaceAll(EMOJI_SEQUENCE, ' ');

        // Refused before any cleaning: cleaning would split the name or drop the character, text the cook never wrote.
        if (HAS_HIDDEN_CHARACTER.test(undecorated)) {
            throw new FactsSheetInvalidError(field);
        }

        const name = plainNameOf(undecorated);

        if (name === '') {
            continue;
        }

        if (ALPHABET_BY_LANGUAGE[language].addressRule(raw)) {
            throw new FactsSheetInvalidError(field);
        }

        assertIngredientName(field, name, language);

        return name;
    }

    return undefined;
}

/** The names of the ingredient lines, once each, in order. */
function ingredientNamesOf(lines: StepSourceRecipe['ingredientLines'], language: OutputLanguage): string[] {
    return [...new Set(lines.flatMap((line, index) => nameOfLine(line, index, language) ?? []))];
}

/** A word of a name as a pattern: its characters literally, an apostrophe of either kind. */
const tokenPattern = (token: string): string => escapeRegExp(token).replaceAll(/['’]/gu, "['’]");

const FUNCTION_WORD_PATTERN = `(?:${FUNCTION_WORDS.join('|')})`;

/** Where a run of a name's last words may start: a sentence or clause edge, or just after a function word. */
const RUN_BEFORE = `(?<=^|[.,;:!?()\\n]\\s*|${NOT_LETTER_OR_DIGIT_BEFORE}${FUNCTION_WORD_PATTERN}\\s+)`;

/** Where a run of a name's last words may end: a sentence or clause edge, or just before a function word. */
const RUN_AFTER = `(?=$|\\s*[.,;:!?()\\n]|\\s+${FUNCTION_WORD_PATTERN}${NOT_LETTER_OR_DIGIT_AFTER})`;

/**
 * A matcher per ingredient name: the whole name, or a run of its last words (a single last word is a run). The words of a
 * name join by a space or a hyphen only. The whole name matches on word boundaries. A run shorter than the name matches
 * only at a sentence or clause edge, or beside a function word on both sides, so "broth" is "chicken broth" in "add the
 * broth" and not in "add broth to the pot", and "chicken" is never "chicken broth". The plural of the last word matches.
 */
function ingredientMatchersOf(names: readonly string[]): IngredientMatcher[] {
    return names.map((name) => {
        const tokens = name.split(/[\s-]+/u).filter((token) => token !== '');
        const run = (from: number): string => `${tokens.slice(from).map(tokenPattern).join(PHRASE_JOINER)}(?:e?s)?`;
        const runs = tokens.slice(1).map((_token, index) => run(index + 1));
        // Every run of consecutive words that does not start at the first word, longest first.
        const innerRuns = tokens
            .slice(1)
            .flatMap((_token, start) =>
                tokens.slice(start + 1).map((_end, length) =>
                    tokens
                        .slice(start + 1, tokens.length - length)
                        .map(tokenPattern)
                        .join(PHRASE_JOINER),
                ),
            )
            .map((words) => `${words}(?:e?s)?`);
        const partial = runs.length === 0 ? '' : `|${RUN_BEFORE}(?:${runs.join('|')})${RUN_AFTER}`;

        return {
            name,
            matcher: new RegExp(
                `${NOT_LETTER_OR_DIGIT_BEFORE}(?:${run(0)})${NOT_LETTER_OR_DIGIT_AFTER}${partial}`,
                'giu',
            ),
            runAfterAmount: runs.length === 0 ? null : new RegExp(`(?:${innerRuns.join('|')})${RUN_AFTER}`, 'iuy'),
        };
    });
}

interface Mention extends Span {
    readonly name: string;
}

/**
 * Every place a step mentions an ingredient name, in order. A name inside a longer name of the recipe is not counted, and
 * a place that two different names both match is no mention of either: "broth" is not picked between "chicken broth" and
 * "beef broth".
 */
function mentionsOf(text: string, matchers: readonly IngredientMatcher[]): Mention[] {
    const found = outermost(
        matchers.flatMap(({ name, matcher }) =>
            [...text.matchAll(matcher)].map((match) => ({
                name,
                start: match.index,
                end: match.index + match[0].length,
            })),
        ),
    );

    return found
        .filter(
            (mention) =>
                !found.some(
                    (other) =>
                        other !== mention &&
                        other.start === mention.start &&
                        other.end === mention.end &&
                        other.name !== mention.name,
                ),
        )
        .sort((a, b) => a.start - b.start);
}

// ── Amounts ──

interface Piece {
    readonly text: string;
    readonly start: number;
    readonly end: number;
}

const LEADING_PUNCTUATION = /^[("'“[]+/u;
const TRAILING_PUNCTUATION: ReadonlySet<string> = new Set(['.', ',', ';', ':', '!', '?', ')', '"', "'", '”', ']']);

/** The text without trailing punctuation. A loop, because a pattern ending in `+$` is quadratic on a long run. */
function withoutTrailingPunctuation(text: string): string {
    let end = text.length;

    while (end > 0 && TRAILING_PUNCTUATION.has(text.charAt(end - 1))) {
        end -= 1;
    }

    return text.slice(0, end);
}

/** Unlike the measure reader's glued-unit split, any letters are split off a number, so no number is ever dropped. */
const GLUED = /^([^\p{L}]+)(\p{L}.*)$/u;
const ORDINAL_SUFFIXES: ReadonlySet<string> = new Set(['st', 'nd', 'rd', 'th']);

/** The words of the text without their outer punctuation, a unit glued to its number split off. */
function piecesOf(text: string): Piece[] {
    return [...text.matchAll(/\S+/gu)].flatMap((match): Piece[] => {
        const lead = LEADING_PUNCTUATION.exec(match[0])?.[0].length ?? 0;
        const trimmed = withoutTrailingPunctuation(match[0].slice(lead));
        const start = match.index + lead;

        if (trimmed === '') {
            return [];
        }

        const glued = GLUED.exec(trimmed);
        const [, number = '', unit = ''] = glued ?? [];

        if (glued !== null && amountAt([number], 0) !== undefined) {
            return ORDINAL_SUFFIXES.has(unit.toLowerCase())
                ? []
                : [
                      { text: number, start, end: start + number.length },
                      { text: unit, start: start + number.length, end: start + trimmed.length },
                  ];
        }

        return [{ text: trimmed, start, end: start + trimmed.length }];
    });
}

/** The longest run of words an amount can span: "1 1/2", or "2 to 3". */
const AMOUNT_TOKENS = 4;

/** Length units a step may state. "in" is left out: it is a preposition far more often than inches. */
const LENGTH_UNITS: ReadonlySet<string> = new Set(
    LENGTH_UNIT_VOCABULARY.filter((unit) => unit !== 'in' && unit !== 'in.' && /\p{L}/u.test(unit)),
);

/** The unit a word names: a canonical or subjective unit, a length, or `null` when it is no unit. */
function unitOf(word: string): string | null {
    const lower = word.toLowerCase();

    if (LENGTH_UNITS.has(lower)) {
        return lower;
    }

    // A package word is a unit ("2 cans beans"), kept as its singular.
    if (CONTAINER_WORDS.has(lower)) {
        return CONTAINER_WORDS.has(lower.replace(/(?:es|s)$/u, '')) ? lower.replace(/(?:es|s)$/u, '') : lower;
    }

    return classifyUnit(word) === 'unknown' ? null : normalizeUnit(word);
}

interface ReadAmount {
    readonly quantities: readonly number[];
    readonly unit: string | null;
    readonly start: number;
    readonly end: number;
    /** The unit a time is in. `null` when the amount is not a time. */
    readonly timeUnit: TimeUnit | LongTimeUnit | null;
    /** The word the cook wrote after a time's number, as written. */
    readonly timeWord: string | null;
    /** The unit is a length ("2 inch"): a size, never an amount of an ingredient. */
    readonly isLength: boolean;
    /** The number is glued to its unit by a hyphen ("9-inch"): a size of something, never an amount of an ingredient. */
    readonly hyphenSized: boolean;
}

/** What the word after a number names: a time unit, or a unit of measure, or neither. */
function wordAfter(word: string | undefined): { timeUnit: TimeUnit | LongTimeUnit | null; unit: string | null } {
    const lower = word?.toLowerCase();

    if (word === undefined || lower === undefined) {
        return { timeUnit: null, unit: null };
    }

    if (Object.hasOwn(TIME_UNIT_WORDS, lower)) {
        return { timeUnit: TIME_UNIT_WORDS[lower] ?? null, unit: null };
    }

    return Object.hasOwn(LONG_TIME_UNIT_WORDS, lower)
        ? { timeUnit: LONG_TIME_UNIT_WORDS[lower] ?? null, unit: null }
        : { timeUnit: null, unit: unitOf(word) };
}

/** Every number in the text with the word after it, in order. */
function readAmounts(text: string): ReadAmount[] {
    const pieces = piecesOf(text);
    const reads: ReadAmount[] = [];
    let at = 0;

    while (at < pieces.length) {
        const read = leadingAmount(pieces.slice(at, at + AMOUNT_TOKENS).map((piece) => piece.text));

        if (read === undefined) {
            at += 1;
            continue;
        }

        const last = pieces[at + read.taken - 1];
        const next = pieces[at + read.taken];
        const quantities =
            read.high === undefined ? [read.low] : [Math.min(read.low, read.high), Math.max(read.low, read.high)];
        const start = pieces[at]?.start ?? 0;
        const { timeUnit, unit } = wordAfter(next?.text);
        const consumed = read.taken + (timeUnit !== null || unit !== null ? 1 : 0);

        reads.push({
            quantities,
            unit,
            start,
            end: pieces[at + consumed - 1]?.end ?? last?.end ?? start,
            timeUnit,
            timeWord: timeUnit === null ? null : (next?.text ?? null),
            isLength: unit !== null && LENGTH_UNITS.has(unit),
            hyphenSized: last?.text.endsWith('-') === true,
        });
        at += consumed;
    }

    return reads;
}

/** A time in days or weeks. The duration reader does not read these, so the sheet reads each one alone. */
const isLongTime = (read: ReadAmount): read is ReadAmount & { readonly timeUnit: LongTimeUnit } =>
    read.timeUnit === 'day' || read.timeUnit === 'week';

/** What may sit between two parts of one time: "1 hour 30 minutes", "1 hour, 30 minutes", "1 hour and 30 minutes". */
const TIME_JOINER = /^\s*(?:,\s*)?(?:and\s+)?$/iu;

/** The runs of adjacent times in a step: the parts of one compound time are one run. `text` is the unmasked step. */
function timeRunsOf(reads: readonly ReadAmount[], text: string): ReadAmount[][] {
    const runs: ReadAmount[][] = [];

    reads.forEach((read, index) => {
        const previous = reads[index - 1];
        const run = runs.at(-1);

        if (read.timeUnit === null) {
            return;
        }

        if (
            !isLongTime(read) &&
            previous !== undefined &&
            !isLongTime(previous) &&
            previous.timeUnit !== null &&
            run !== undefined &&
            run.at(-1) === previous &&
            TIME_JOINER.test(text.slice(previous.end, read.start))
        ) {
            run.push(read);
        } else {
            runs.push([read]);
        }
    });

    return runs;
}

/** A duration and where in the step it is written. */
interface PlacedDuration {
    readonly at: number;
    readonly duration: FactDuration;
}

/**
 * The durations of a step and the time reads the reader returned nothing for.
 *
 * The reader is asked about one time at a time: a run of adjacent times as written, and a range as its two ends, so a
 * range keeps its high end whatever the reader does with a range. A time it returns is a duration and only that. A time
 * it returns nothing for stays an amount, in hours, minutes or seconds, so no stated time falls out of the sheet.
 */
function timesOf(
    reads: readonly ReadAmount[],
    text: string,
    readers: FactsSheetReaders,
): { durations: PlacedDuration[]; unread: ReadonlySet<ReadAmount> } {
    const durations: PlacedDuration[] = [];
    const unread = new Set<ReadAmount>();

    for (const run of timeRunsOf(reads, text)) {
        const [first] = run;
        const [low, high] = first?.quantities ?? [];

        if (first === undefined) {
            continue;
        }

        const at = first.start;

        if (isLongTime(first)) {
            const seconds = SECONDS_PER_TIME_UNIT[first.timeUnit];

            durations.push({
                at,
                duration: { minSeconds: (low ?? 0) * seconds, maxSeconds: (high ?? low ?? 0) * seconds },
            });
            continue;
        }

        if (run.length === 1 && low !== undefined && high !== undefined && first.timeWord !== null) {
            const [min] = readers.durations(`${low} ${first.timeWord}`);
            const [max] = readers.durations(`${high} ${first.timeWord}`);

            if (min !== undefined && max !== undefined) {
                durations.push({ at, duration: { minSeconds: min.minSeconds, maxSeconds: max.maxSeconds } });
            } else {
                unread.add(first);
            }

            continue;
        }

        const found = readers.durations(text.slice(first.start, run.at(-1)?.end));

        if (found.length > 0) {
            durations.push(...found.map((duration) => ({ at, duration })));
        } else {
            run.forEach((read) => unread.add(read));
        }
    }

    return { durations, unread };
}

/** A sentence ends at a full stop, "!" or "?" followed by a space, so "1.5 hours" is not cut. */
const SENTENCE_END = /(?<=[.!?])\s+/u;

/**
 * The durations the reader finds in the sentences that state no digit time. A time written in words ("Simmer ten
 * minutes.") has no digit for the sheet to find, so the sentence is handed to the same reader cooking mode uses, and
 * the sheet and the timer agree. A sentence with a digit time is not asked, so no time is counted twice.
 */
function wordTimesOf(text: string, digitTimes: readonly ReadAmount[], readers: FactsSheetReaders): PlacedDuration[] {
    let from = 0;

    return text.split(SENTENCE_END).flatMap((sentence): PlacedDuration[] => {
        const start = text.indexOf(sentence, from);
        const end = start + sentence.length;

        from = end;

        return digitTimes.some((read) => read.start >= start && read.start < end)
            ? []
            : readers.durations(sentence).map((duration) => ({ at: start, duration }));
    });
}

/** A step with this many untied measures, or more, refuses the whole sheet. */
const MAX_UNTIED_MEASURES_EXCLUSIVE = 2;

/** A name ends where a phrase does: at a sentence or clause edge, or before a function word. */
const NAME_ENDS = new RegExp(`^${RUN_AFTER}`, 'iu');

/** What may sit between an amount and the name it measures: nothing, or "of" or "of the". */
const TIE_WORDS = String.raw`\s*(?:of\s+(?:the\s+)?)?`;

const DIRECT_TIE = new RegExp(`^${TIE_WORDS}$`, 'iu');

/** The same gap, as the start of the text after an amount. */
const TIE_PREFIX = new RegExp(`^${TIE_WORDS}`, 'iu');

/** What may sit between two amounts that share one name: "1 cup plus 2 tablespoons flour". */
const PLUS_TIE = /^\s+plus\s+$/iu;

/** Whether an amount can measure an ingredient: not a time, a length or a hyphenated size. */
const canMeasure = (read: ReadAmount): boolean => read.timeUnit === null && !read.isLength && !read.hyphenSized;

/**
 * The one ingredient whose last words follow the amount directly ("1 cup Cheddar" for "shredded Cheddar cheese"), or
 * `null` when none does, or two names do. The amount stands as the edge on the left of the run.
 */
function nameAfterAmount(read: ReadAmount, matchers: readonly IngredientMatcher[], text: string): string | null {
    const from = read.end + (TIE_PREFIX.exec(text.slice(read.end))?.[0].length ?? 0);
    const found = matchers.filter(({ runAfterAmount }) => {
        if (runAfterAmount === null) {
            return false;
        }

        runAfterAmount.lastIndex = from;

        return runAfterAmount.test(text);
    });

    return found.length === 1 ? (found[0]?.name ?? null) : null;
}

/**
 * The amounts of a step. An amount is tied to an ingredient only in the shape `NUM [UNIT] [of [the]] NAME`, with nothing
 * in between, or as the first part of `NUM UNIT plus NUM UNIT NAME`, where both parts are tied. A time, a length, a
 * hyphenated size and any other shape stay untied: a missing tie is safe, a wrong one is published. A time is an amount
 * only when the reader returned no duration for it.
 *
 * @returns The amounts, and how many measures with a unit stayed untied. A measure is an amount that is no time, length or
 * hyphenated size.
 */
function amountsOf(
    reads: readonly ReadAmount[],
    unread: ReadonlySet<ReadAmount>,
    mentions: readonly Mention[],
    matchers: readonly IngredientMatcher[],
    text: string,
): { amounts: FactAmount[]; untiedMeasures: number } {
    const ties = reads.map((read): string | null => {
        if (!canMeasure(read)) {
            return null;
        }

        const mention = mentions.find((each) => each.start >= read.end);

        return mention !== undefined &&
            DIRECT_TIE.test(text.slice(read.end, mention.start)) &&
            NAME_ENDS.test(text.slice(mention.end))
            ? mention.name
            : nameAfterAmount(read, matchers, text);
    });

    for (let index = reads.length - 2; index >= 0; index -= 1) {
        const read = reads[index];
        const next = reads[index + 1];

        if (
            read !== undefined &&
            next !== undefined &&
            ties[index] === null &&
            ties[index + 1] !== null &&
            canMeasure(read) &&
            PLUS_TIE.test(text.slice(read.end, next.start))
        ) {
            ties[index] = ties[index + 1] ?? null;
        }
    }

    const amounts = reads.flatMap((read, index): FactAmount[] =>
        read.timeUnit !== null && !unread.has(read)
            ? []
            : read.quantities.map((quantity) => ({
                  quantity,
                  unit: read.timeUnit ?? read.unit,
                  ingredient: ties[index] ?? null,
              })),
    );
    const untiedMeasures = reads.filter(
        (read, index) => canMeasure(read) && read.unit !== null && ties[index] === null,
    ).length;

    return { amounts, untiedMeasures };
}

// ── Safety ──

/** One matcher per safety term, compiled once from the closed lexicon. */
const TERM_MATCHERS: ReadonlyMap<SafetyTerm, RegExp> = new Map(
    Object.values(SAFETY_RULES).flatMap((rules) =>
        rules.flatMap((rule) =>
            [...rule.anyOf, ...(rule.alsoNeeds ?? [])].map((term): [SafetyTerm, RegExp] => [
                term,
                matcherOf(term.phrases, 'iu'),
            ]),
        ),
    ),
);

const keysIn = (text: string, terms: readonly SafetyTerm[]): string[] =>
    terms.filter((term) => TERM_MATCHERS.get(term)?.test(text) === true).map((term) => term.fact);

/** The same matchers, global, so every match of a term can be found. */
const GLOBAL_TERM_MATCHERS: ReadonlyMap<SafetyTerm, RegExp> = new Map(
    [...TERM_MATCHERS].map(([term, matcher]): [SafetyTerm, RegExp] => [term, new RegExp(matcher.source, 'giu')]),
);

/** Where each match of the terms ends in the text. */
function cueEndsOf(text: string, terms: readonly SafetyTerm[]): number[] {
    return terms.flatMap((term) => {
        const matcher = GLOBAL_TERM_MATCHERS.get(term);

        return matcher === undefined ? [] : [...text.matchAll(matcher)].map((match) => match.index + match[0].length);
    });
}

/** What ends a clause for a doneness temperature: the end of a sentence or a semicolon. */
const CLAUSE_END = /[.!?;]/u;

const READING_VERB = new RegExp(
    `${NOT_LETTER_OR_DIGIT_BEFORE}(?:${READING_VERBS.join('|')})${NOT_LETTER_OR_DIGIT_AFTER}`,
    'giu',
);

/**
 * The doneness temperature of a step: the first temperature after a reading verb ("reads", "registers", "reaches") that
 * follows a cue, all in one clause. "Until a thermometer reads 165 F" gives 165. An oven temperature stated before the
 * cue, or after it with no reading verb, is not one. A range gives both its ends.
 */
function donenessTemperatures(
    text: string,
    cues: readonly SafetyTerm[],
    temperatures: readonly PlacedTemperature[],
): PlacedTemperature[] {
    const cueEnds = cueEndsOf(text, cues);
    const sameClause = (from: number, to: number): boolean => !CLAUSE_END.test(text.slice(from, to));
    const verbs = [...text.matchAll(READING_VERB)]
        .map((match) => ({ start: match.index, end: match.index + match[0].length }))
        .filter((verb) => cueEnds.some((end) => end <= verb.start && sameClause(end, verb.start)));
    const first = temperatures.find((temperature) =>
        verbs.some((verb) => verb.end <= temperature.start && sameClause(verb.end, temperature.start)),
    );

    return first === undefined ? [] : temperatures.filter((temperature) => temperature.start === first.start);
}

/** The safety lines of a step: per category, the lexicon keys that fired and any doneness temperatures. Never words. */
function safetyOf(text: string, temperatures: readonly PlacedTemperature[]): FactSafety[] {
    return SAFETY_CATEGORIES.flatMap((category): FactSafety[] => {
        const facts = SAFETY_RULES[category].flatMap((rule): string[] => {
            const lead = keysIn(text, rule.anyOf);
            const also = rule.alsoNeeds === undefined ? [] : keysIn(text, rule.alsoNeeds);

            if (lead.length === 0 || (rule.alsoNeeds !== undefined && also.length === 0)) {
                return [];
            }

            const done = rule.needsTemperature === true ? donenessTemperatures(text, rule.anyOf, temperatures) : [];

            if (rule.needsTemperature === true && done.length === 0) {
                return [];
            }

            return [...lead, ...also, ...done.map(({ value, scale }) => `${Math.round(value)} ${scale}`)];
        });

        return facts.length === 0 ? [] : [{ category, facts: [...new Set(facts)] }];
    });
}

// ── The sheet ──

/**
 * Build the facts sheet of a recipe.
 *
 * @param recipe - Its language, the names its ingredient lines show, and its step texts.
 * @param readers - The injected duration reader.
 * @returns One entry per source step, in order. The sheet holds no step text. Pure.
 * @throws {FactsSheetInvalidError} When the language is not a language tag, or a field is still not a plain fact.
 */
export function buildFactsSheet(recipe: StepSourceRecipe, readers: FactsSheetReaders): FactsSheet {
    if (!isOutputLanguage(recipe.language)) {
        throw new FactsSheetInvalidError('language');
    }

    const ingredientNames = ingredientNamesOf(recipe.ingredientLines, recipe.language);
    const matchers = ingredientMatchersOf(ingredientNames);

    const steps = recipe.steps.map(({ instruction }, stepIndex): FactsStep => {
        // Hidden characters are dropped and the text composed first, so none can split a word or hide a fact.
        const text = readableStep(instruction);
        const { temperatures, rest } = readTemperatures(text);
        const mentions = mentionsOf(text, matchers);
        const equipment = equipmentMatchesOf(text);
        // Figure and hyphen-like dashes read as the hyphen a range is written with. One character each, so offsets hold.
        const reads = readAmounts(rest.replaceAll(/[‐‑‒―]/gu, '-'));
        const { durations: digitDurations, unread } = timesOf(reads, text, readers);
        const durations = [
            ...digitDurations,
            ...wordTimesOf(
                text,
                reads.filter((read) => read.timeUnit !== null),
                readers,
            ),
        ]
            .sort((a, b) => a.at - b.at)
            .map(({ duration }) => duration);

        const { amounts, untiedMeasures } = amountsOf(reads, unread, mentions, matchers, text);

        // Two or more measures the sheet cannot tie leave the writer free to attach them wrongly: refuse the sheet.
        if (untiedMeasures >= MAX_UNTIED_MEASURES_EXCLUSIVE) {
            throw new FactsSheetInvalidError(`steps[${stepIndex}].amounts`);
        }

        return {
            actions: actionsOf(text, [...equipment, ...mentions]),
            amounts,
            temperatures: temperatures.map(({ value, scale }) => ({ value, scale })),
            durations,
            // An amount may tie to a name its run stands for ("1 cup Cheddar"), so the step names it too.
            ingredients: [
                ...new Set([...mentions.map((mention) => mention.name), ...amounts.flatMap((a) => a.ingredient ?? [])]),
            ],
            equipment: [...new Set(equipment.map(({ item }) => item))],
            safety: safetyOf(text, temperatures),
        };
    });

    return toPlainFactsSheet({ language: recipe.language, ingredientNames, steps });
}
