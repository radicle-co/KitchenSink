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
    recipeIngredientNameSchema,
    recipeIngredientQuantitySchema,
    recipeMinutesSchema,
    recipeServingsSchema,
} from '@kitchensink/recipe-core';
import { describe, it, expect } from 'vitest';

import {
    normalizeDurationToMinutes,
    normalizeServings,
    parseIngredientLine,
    sanitizeToPlainText,
} from '../src/index.js';

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

            expect(result.quantity).toBe(expected.quantity);
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
        expect(result.quantity).toBe(0.5);
        expect(result.unit).toBe('cup');
        expect(result.name).toBe('butter');
    });

    it('preserves a whole prose sentence rather than dropping the line it cannot parse', () => {
        const sentence = 'Have ready a warm oven and bake three-quarters of an hour.';
        const result = parseIngredientLine(sanitizeToPlainText(sentence));

        expect(result.raw).toBe(sentence);
        expect(result.quantity).toBeNull();
        expect(result.needsReview).toBe(true);
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
    it('emits only quantities recipeIngredientQuantitySchema accepts', () => {
        for (const line of everyCorpusLine()) {
            const { quantity } = parseIngredientLine(line);

            if (quantity !== null) {
                expect(recipeIngredientQuantitySchema.safeParse(quantity).success).toBe(true);
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
