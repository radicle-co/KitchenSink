/**
 * Integration tier — the ASSEMBLED normalize pipeline over a committed slice of REAL corpus text.
 *
 * | Requirement | Test |
 * | ----------- | ---- |
 * | FR-020 — free-text ingredient lines become structured quantity/unit/name | "parses every hand-checked phrase" |
 * | FR-020 — unparseable lines are preserved and flagged, never dropped | the prose rows of the golden |
 * | FR-021 — durations and yields normalize, or stay empty and flagged | duration + servings suites |
 * | HAZ-029 — sanitization precedes every parse | "the sanitize -> parse pipeline" |
 * | GR-007 — the values this package emits are storable by recipe-core's schemas | "downstream contract" |
 *
 * What this tier proves that the unit tier structurally cannot:
 *
 * 1. The REAL third-party parsers (`parse-ingredient`, `sanitize-html`, `fraction.js`) run end to end
 *    against text nobody wrote for a test. The unit tier pins each stage; only this one pins the seam.
 * 2. Every value the pipeline calls "resolved" actually SATISFIES the schemas in `@kitchensink/recipe-core`
 *    that guard the persisted columns. That is the assertion that stops a `500` at INSERT, and a mocked
 *    boundary cannot make it.
 * 3. The golden file's phrases really occur in the committed corpus, so the golden cannot drift into
 *    fiction — the failure mode of every golden regenerated from its own implementation.
 * 4. The package's bundle boundary is a CONTROL rather than a comment: nothing under `packages/apps/**`
 *    may depend on it, and that is checked against the real filesystem.
 */
import { globSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    quantityLowerBound,
    quantityUpperBound,
    recipeIngredientNameSchema,
    recipeIngredientQuantitySchema,
    recipeMinutesSchema,
    recipeServingsSchema,
} from '@kitchensink/recipe-core';

import { parseIngredient } from 'parse-ingredient';
import { describe, it, expect } from 'vitest';

import {
    normalizeDurationToMinutes,
    normalizeServings,
    parseIngredientLine,
    sanitizeToPlainText,
} from '../src/index.js';
// ⛔ From the MODULE, not the package index: `IMPORT_UNITS` is the library extension table, and this tier
// is the only place that asks the library its own verdict rather than taking ours (U35).
import { IMPORT_UNITS } from '../src/ingredientLine.js';

import { GOLDEN_DURATIONS, GOLDEN_INGREDIENTS, GOLDEN_SERVINGS } from './__fixtures__/goldenCorpusParse.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const CORPUS_MARKER = '--- CORPUS BEGINS ---';

/**
 * The corpus slice with its provenance block stripped. Everything after the marker is verbatim source.
 *
 * Line endings are normalized to LF. The Project Gutenberg original is CRLF, and a golden asserting
 * `\r\n` would be testing that file's line endings — and would break on any checkout with
 * `core.autocrlf` set — rather than testing the parse.
 */
function readCorpus(): string {
    const file = readFileSync(join(HERE, '__fixtures__', 'internationalJewishCookBook.txt'), 'utf8');
    const body = file.split(CORPUS_MARKER)[1];

    if (body === undefined) {
        throw new Error(`Corpus fixture is missing its "${CORPUS_MARKER}" marker.`);
    }

    return body.replace(/\r\n/g, '\n');
}

/** How MOD-018 hands a wrapped source phrase to the parser: one line, single-spaced. */
function asExtractedField(phrase: string): string {
    return phrase.replace(/\s+/g, ' ').trim();
}

const corpus = readCorpus();

describe('the corpus fixture itself', () => {
    it('carries its Project Gutenberg provenance, because the licence claim travels with the text', () => {
        const file = readFileSync(join(HERE, '__fixtures__', 'internationalJewishCookBook.txt'), 'utf8');

        expect(file).toContain('Project Gutenberg');
        expect(file).toContain('12350');
        expect(file).toContain('PUBLIC DOMAIN');
    });

    it('is real prose written in number WORDS, which is the whole reason it is the corpus', () => {
        expect(corpus).toContain('one-half cup of butter');
        expect(corpus).toContain('three-quarters of an hour');
        expect(corpus.length).toBeGreaterThan(1000);
    });
});

describe('the golden file describes THIS corpus', () => {
    it.each(GOLDEN_INGREDIENTS.map((entry) => [entry.phrase]))('finds the ingredient phrase %j verbatim', (phrase) => {
        expect(corpus).toContain(phrase);
    });

    it.each(GOLDEN_DURATIONS.map((entry) => [entry.phrase]))('finds the duration phrase %j verbatim', (phrase) => {
        expect(corpus).toContain(phrase);
    });

    it.each(GOLDEN_SERVINGS.map((entry) => [entry.phrase]))('finds the yield phrase %j verbatim', (phrase) => {
        expect(corpus).toContain(phrase);
    });
});

describe('the sanitize -> parse pipeline over the corpus', () => {
    it.each(GOLDEN_INGREDIENTS.map((entry) => [entry.phrase, entry]))(
        'parses %j as the source text calls for',
        (_phrase, expected) => {
            const field = sanitizeToPlainText(asExtractedField(expected.phrase));
            const result = parseIngredientLine(field);

            // Asserted as BOUNDS rather than as the value object, so the golden keeps stating what the
            // source SAYS. Every phrase in the committed slice states one amount, so both bounds are it —
            // and a range slipping in unnoticed would fail here rather than pass silently.
            expect(quantityLowerBound(result.quantity)).toBe(expected.quantity);
            expect(quantityUpperBound(result.quantity)).toBe(expected.quantity);
            expect(result.unit).toBe(expected.unit);
            expect(result.name).toBe(expected.name);
            expect(result.needsReview).toBe(expected.needsReview);
            expect(result.raw).toBe(field);
        },
    );

    it('flows markup through sanitization before parsing, so no tag reaches the parser', () => {
        const field = sanitizeToPlainText('<li><b>one-half</b> cup of <i>butter</i></li>');
        const result = parseIngredientLine(field);

        expect(field).not.toMatch(/<[a-zA-Z]/);
        expect(result.quantity).toEqual({ kind: 'exact', value: 0.5 });
        expect(result.unit).toBe('cup');
        expect(result.name).toBe('butter');
    });

    it('preserves a whole prose sentence rather than dropping the line it cannot parse', () => {
        const sentence = 'Have ready a warm oven and bake three-quarters of an hour.';
        const result = parseIngredientLine(sanitizeToPlainText(sentence));

        expect(result.raw).toBe(sentence);
        expect(result.quantity).toEqual({ kind: 'absent' });
        expect(result.needsReview).toBe(true);
    });

    /**
     * U35 — capital `T` is a tablespoon, lowercase `t` is a teaspoon (owner ruling, 2026-08-25).
     *
     * ⛔ WHAT THIS TIER PROVES THAT THE UNIT TIER STRUCTURALLY CANNOT: the case has to survive EVERY stage
     * of the assembled pipeline, not just `normalizeUnit`. `sanitize-html` runs first and rewrites the
     * text; `parse-ingredient` tokenizes it; only then does our alias table see a token. A fold introduced
     * by EITHER library — an entity decode, a tag strip, a `toLowerCase()` in the tokenizer — silently
     * un-does the ruling while every unit test stays green, because a unit test hands `normalizeUnit` a
     * string nobody sanitized.
     *
     * ⚠️ The 1919 corpus writes `tablespoonful`, never `T`, so these phrases are NOT drawn from the golden.
     * That is deliberate: the golden states what the committed source says, and inventing a `T` line in it
     * would make the golden fiction — the failure mode this file's own header warns about.
     */
    it('carries the T/t distinction through sanitization and the real parser, both apart and intact', () => {
        const tablespoon = parseIngredientLine(sanitizeToPlainText('<li>2 T <b>butter</b></li>'));
        const teaspoon = parseIngredientLine(sanitizeToPlainText('<li>2 t <b>vanilla</b></li>'));

        expect(tablespoon.unit).toBe('tablespoon');
        expect(teaspoon.unit).toBe('teaspoon');
        expect(tablespoon.unit).not.toBe(teaspoon.unit);

        // The rest of the line still parses, so the case-sensitive branch did not cost the parse anything.
        expect(tablespoon.quantity).toEqual({ kind: 'exact', value: 2 });
        expect(teaspoon.quantity).toEqual({ kind: 'exact', value: 2 });
        expect(tablespoon.name).toBe('butter');
        expect(teaspoon.name).toBe('vanilla');
        expect(tablespoon.needsReview).toBe(false);
        expect(teaspoon.needsReview).toBe(false);
    });

    /**
     * U35 — the PERIOD spellings, which only this tier can prove.
     *
     * ⛔ `recipe-core` strips a trailing `.` before it looks a unit up, so `T.` means tablespoon in the
     * EDITOR. Measured against `parse-ingredient@2.2.0`, the library carries `tbsp.` and `Tbsp.` as
     * alternates but NOT `T.` or `t.`, so `"2 T. butter"` did not parse as a measurement at all — the
     * importer read `unitOfMeasure: null` and a description of `"T. butter"`. Two modules implementing one
     * ruling and disagreeing about it.
     *
     * ⛔ THIS IS A LIBRARY-VOCABULARY GAP, SO IT IS FIXED AT THE LIBRARY'S OWN EXTENSION POINT
     * (`IMPORT_UNITS`), never by a second table of ours — the same split R31 drew: recipe-core canonicalises
     * a unit a USER typed, the library's tokenizer decides what is a unit at all, and no table of ours can
     * do the latter. Only a real `parseIngredient` call can show the alternate took, which is why this
     * assertion is here rather than in the unit tier.
     */
    it('reads the PERIOD spellings T. and t. as the same units, through the real tokenizer', () => {
        const tablespoon = parseIngredientLine(sanitizeToPlainText('<li>2 T. <b>butter</b></li>'));
        const teaspoon = parseIngredientLine(sanitizeToPlainText('<li>2 t. <b>vanilla</b></li>'));

        expect(tablespoon.unit).toBe('tablespoon');
        expect(teaspoon.unit).toBe('teaspoon');
        expect(tablespoon.unit).not.toBe(teaspoon.unit);
        expect(tablespoon.name).toBe('butter');
        expect(teaspoon.name).toBe('vanilla');
        expect(tablespoon.quantity).toEqual({ kind: 'exact', value: 2 });
        expect(teaspoon.quantity).toEqual({ kind: 'exact', value: 2 });
    });

    /**
     * U35 — the TWO VOCABULARIES AGREE, asserted rather than asserted in prose.
     *
     * ⛔ THIS IS WHAT MAKES THE `IMPORT_UNITS` ENTRIES LOAD-BEARING, and it took a measurement to find.
     * Removing `'T.'` alone leaves `parseIngredientLine` still answering `tablespoon`, because this package
     * re-normalises the library's VERBATIM `unitOfMeasure` and never reads its `unitOfMeasureID` — so the
     * obvious assertion cannot see a half-registration. What it hides is worse than what it shows:
     * `parse-ingredient` matches MULTI-character alternates CASE-INSENSITIVELY (single-character `T`/`t`
     * are the exception), so with only `'t.'` registered the library reports `unitOfMeasureID: 'teaspoon'`
     * for `"2 T. butter"` — a threefold disagreement with our own answer, sitting one field away from a
     * reader who takes the library at its word.
     *
     * ⚠️ This is the ONLY assertion in the change that reaches for `parse-ingredient` directly, and it is
     * here on purpose: the claim is about the library's vocabulary agreeing with ours, which nothing
     * downstream of the anti-corruption layer can express.
     */
    it('agrees with the library about T/t — the two vocabularies name the same unit, not merely a unit', () => {
        for (const [line, unit] of [
            ['2 T butter', 'tablespoon'],
            ['2 t vanilla', 'teaspoon'],
            ['2 T. butter', 'tablespoon'],
            ['2 t. vanilla', 'teaspoon'],
        ] as const) {
            expect(parseIngredientLine(line).unit).toBe(unit);
            // The library's OWN identification of the same token, through the same extension table the
            // parse uses. A half-registered pair makes this half disagree while the line above still passes.
            expect(parseIngredient(line, { additionalUOMs: IMPORT_UNITS })[0]?.unitOfMeasureID).toBe(unit);
        }
    });

    it('leaves the case-INSENSITIVE spellings alone through the same pipeline', () => {
        for (const [markup, unit] of [
            ['<li>2 Tbsp. <b>butter</b></li>', 'tablespoon'],
            ['<li>2 TBSP <b>butter</b></li>', 'tablespoon'],
            ['<li>2 Cups <b>flour</b></li>', 'cup'],
        ] as const) {
            expect(parseIngredientLine(sanitizeToPlainText(markup)).unit).toBe(unit);
        }
    });
});

describe('the duration pipeline over the corpus', () => {
    it.each(GOLDEN_DURATIONS.map((entry) => [entry.phrase, entry]))(
        'normalizes %j as the source text calls for',
        (_phrase, expected) => {
            const result = normalizeDurationToMinutes(sanitizeToPlainText(asExtractedField(expected.phrase)));

            expect(result.minutes).toBe(expected.minutes);
            expect(result.needsReview).toBe(expected.needsReview);
        },
    );
});

describe('the yield pipeline over the corpus', () => {
    it.each(GOLDEN_SERVINGS.map((entry) => [entry.phrase, entry]))(
        'normalizes %j as the source text calls for',
        (_phrase, expected) => {
            const result = normalizeServings(sanitizeToPlainText(asExtractedField(expected.phrase)));

            expect(result.servings).toBe(expected.servings);
            expect(result.needsReview).toBe(expected.needsReview);
        },
    );
});

describe('downstream contract — every resolved value is storable by recipe-core', () => {
    it('emits only quantity BOUNDS recipeIngredientQuantitySchema accepts', () => {
        for (const line of everyCorpusLine()) {
            const { quantity } = parseIngredientLine(line);

            // Both bounds, not just the lower one: U7 made the upper bound reachable, so checking only
            // the low bound would leave the newly-storable half of the model unguarded against the column.
            for (const bound of [quantityLowerBound(quantity), quantityUpperBound(quantity)]) {
                if (bound !== null) {
                    expect(recipeIngredientQuantitySchema.safeParse(bound).success).toBe(true);
                }
            }
        }
    });

    it('never emits a range whose upper bound sits below its lower one', () => {
        for (const line of everyCorpusLine()) {
            const { quantity } = parseIngredientLine(line);

            if (quantity.kind === 'range') {
                expect(quantity.high).toBeGreaterThan(quantity.low);
            }
        }
    });

    it('emits only names recipeIngredientNameSchema accepts, or flags them', () => {
        for (const line of everyCorpusLine()) {
            const result = parseIngredientLine(line);
            const storable = recipeIngredientNameSchema.safeParse(result.name).success;

            expect(storable || result.needsReview).toBe(true);
        }
    });

    it('emits only durations recipeMinutesSchema accepts', () => {
        for (const line of everyCorpusLine()) {
            const { minutes } = normalizeDurationToMinutes(line);

            if (minutes !== undefined) {
                expect(recipeMinutesSchema.safeParse(minutes).success).toBe(true);
            }
        }
    });

    it('emits only servings recipeServingsSchema accepts', () => {
        for (const line of everyCorpusLine()) {
            const { servings } = normalizeServings(line);

            if (servings !== undefined) {
                expect(recipeServingsSchema.safeParse(servings).success).toBe(true);
            }
        }
    });

    it('never throws on any line of the corpus, including the blank and the heading ones', () => {
        for (const line of everyCorpusLine()) {
            expect(() => {
                parseIngredientLine(sanitizeToPlainText(line));
                normalizeDurationToMinutes(line);
                normalizeServings(line);
            }).not.toThrow();
        }
    });
});

describe('the bundle boundary is a control, not a comment', () => {
    it('is depended on by no app package, because its parsers must not ship in the Expo bundle', () => {
        const repoRoot = join(HERE, '..', '..', '..', '..');
        const appManifests = globSync('packages/apps/**/package.json', {
            cwd: repoRoot,
            exclude: (path) => path.includes('node_modules'),
        });

        expect(appManifests.length).toBeGreaterThan(0);

        for (const relative of appManifests) {
            const manifest: unknown = JSON.parse(readFileSync(join(repoRoot, relative), 'utf8'));
            expect(JSON.stringify(manifest)).not.toContain('@kitchensink/recipe-import-core');
        }
    });
});

/** Every non-blank line of the committed corpus slice — the adversarial input this package must survive. */
function everyCorpusLine(): readonly string[] {
    return corpus.split('\n');
}
