/**
 * Tests for `import.schema.ts` — the bulk-import wire contract (ADR-0072), written before the schema.
 *
 * The claims, and the mutation each is there to catch:
 *
 *  1. EVERY request is strict (GR-017 §17-c). A key a client invents, `boundBy` and `ownerId` above all, is a 400 and
 *     never a silent strip: `bound_by` is written only by the save path (ADR-0072 §5), and the owner is the principal.
 *  2. Item bounds fit the columns they write (the storage-capacity gate reads these same schemas): an ordinal is a
 *     non-negative int4, a request carries 1..25 items, so the 100 kB body limit answers an oversized file with a `413`
 *     rather than a `22003`.
 *  3. The per-recipe statement (ADR-0072 §9) has FOUR legal forms and nothing else: "I wrote this" carries no citation;
 *     a public web page carries a URL; a book and a paid site carry a citation. A citation on the first, or none on the
 *     others, is unrepresentable (kills: an optional `citation` on every member).
 *  4. The recipe payload reuses the create-recipe bounds, so an editor's counter and the importer agree.
 *  5. Responses are LOOSE (a newer server's field must not break an installed client) and REUSE the paste match view, so
 *     the closed `MatchState` has one definition.
 *  6. The vocabularies equal the code's and the database's: the match modes are `MATCH_MODES`, the statement and source
 *     kinds are the CHECK's.
 */
import { describe, expect, it } from 'vitest';
import { PARSE_JOB_LINE_MAX_CHARS } from '@kitchensink/recipe-core/parsing/parse-job-text';

import { MATCH_MODES } from '../../import/domain/importBindingPolicy.js';
import {
    IMPORT_SOURCE_KINDS,
    IMPORT_STATEMENT_KINDS,
    IMPORT_VISIBILITIES,
} from '../../database/schema/recipeImports.js';
import {
    IMPORT_MAX_CITATION_LENGTH,
    MAX_IMPORT_ITEMS,
    MAX_IMPORT_ITEMS_PER_REQUEST,
    advanceImportRequestSchema,
    createImportRequestSchema,
    importCursorRequestSchema,
    importFlaggedResponseSchema,
    importMatchModeSchema,
    importPickRequestSchema,
    importRecipeSchema,
    importStatementSchema,
    importStepResponseSchema,
    importToCheckResponseSchema,
    importViewSchema,
    leaveImportRequestSchema,
    putImportItemsRequestSchema,
    recordImportChoicesRequestSchema,
} from '../import.schema.js';
import { parseProposalMatchSchema } from '../parseJobs.schema.js';

const RECIPE = {
    title: 'Tomato soup',
    ingredientLines: ['2 cups tomatoes', '1 tsp salt'],
    steps: [{ instruction: 'Simmer.' }],
};
const ITEM = { ordinal: 0, recipe: RECIPE };
const CREATE = { matchMode: 'review', visibility: 'private', items: [ITEM] };
const INT4_MAX = 2_147_483_647;

describe('createImportRequestSchema', () => {
    it('accepts the first chunk of a file', () => {
        expect(createImportRequestSchema.safeParse(CREATE).success).toBe(true);
    });

    it.each([
        ['an unknown top-level key', { ...CREATE, ownerId: 'sneaky' }],
        ['a client-sent boundBy', { ...CREATE, boundBy: 'cook' }],
        ['an unknown key on an item', { ...CREATE, items: [{ ...ITEM, stage: 'saved' }] }],
        [
            'an unknown key on the recipe',
            { ...CREATE, items: [{ ...ITEM, recipe: { ...RECIPE, sourceType: 'imported_public' } }] },
        ],
        ['an invented match mode', { ...CREATE, matchMode: 'guess' }],
        ['the snake_case spelling of a mode', { ...CREATE, matchMode: 'keep_as_written' }],
        ['an invented visibility', { ...CREATE, visibility: 'friends' }],
        ['no items', { ...CREATE, items: [] }],
        [
            'too many items for one request',
            {
                ...CREATE,
                items: Array.from({ length: MAX_IMPORT_ITEMS_PER_REQUEST + 1 }, (_n, ordinal) => ({
                    ...ITEM,
                    ordinal,
                })),
            },
        ],
        ['a missing mode', { visibility: 'private', items: [ITEM] }],
        ['a missing visibility', { matchMode: 'review', items: [ITEM] }],
    ])('rejects %s', (_name, body) => {
        expect(createImportRequestSchema.safeParse(body).success).toBe(false);
    });

    it('accepts exactly the per-request maximum', () => {
        const items = Array.from({ length: MAX_IMPORT_ITEMS_PER_REQUEST }, (_n, ordinal) => ({ ...ITEM, ordinal }));

        expect(createImportRequestSchema.safeParse({ ...CREATE, items }).success).toBe(true);
    });

    it('rejects two items with one ordinal in the same request', () => {
        expect(createImportRequestSchema.safeParse({ ...CREATE, items: [ITEM, ITEM] }).success).toBe(false);
    });
});

describe('the item ordinal fits int4 and a file of any plausible size (no per-file cap, ADR-0072 §8)', () => {
    const withOrdinal = (ordinal: number) => putImportItemsRequestSchema.safeParse({ items: [{ ...ITEM, ordinal }] });

    it('accepts 0 and the last ordinal', () => {
        expect(withOrdinal(0).success).toBe(true);
        expect(withOrdinal(MAX_IMPORT_ITEMS - 1).success).toBe(true);
    });

    it.each([-1, 1.5, MAX_IMPORT_ITEMS, INT4_MAX, INT4_MAX + 1, Number.NaN])('rejects %s', (ordinal) => {
        expect(withOrdinal(ordinal).success).toBe(false);
    });

    it('keeps the ceiling inside int4, so an out-of-range ordinal is a 400 and never a 22003', () => {
        expect(MAX_IMPORT_ITEMS).toBeLessThanOrEqual(INT4_MAX);
    });
});

describe('putImportItemsRequestSchema', () => {
    it('is strict and needs at least one item', () => {
        expect(putImportItemsRequestSchema.safeParse({ items: [ITEM] }).success).toBe(true);
        expect(putImportItemsRequestSchema.safeParse({ items: [] }).success).toBe(false);
        expect(putImportItemsRequestSchema.safeParse({ items: [ITEM], matchMode: 'review' }).success).toBe(false);
    });
});

describe('importRecipeSchema — the create-recipe bounds, reused', () => {
    it('requires a title and the ingredient lines, and lets the time fields be absent', () => {
        expect(importRecipeSchema.safeParse({ title: 'x', ingredientLines: [], steps: [] }).success).toBe(true);
        expect(importRecipeSchema.safeParse({ ingredientLines: [], steps: [] }).success).toBe(false);
        expect(importRecipeSchema.safeParse({ title: 'x', steps: [] }).success).toBe(false);
    });

    it('rejects a title the create route would reject', () => {
        expect(importRecipeSchema.safeParse({ ...RECIPE, title: '' }).success).toBe(false);
        expect(importRecipeSchema.safeParse({ ...RECIPE, title: 'x'.repeat(10_000) }).success).toBe(false);
    });

    it.each([
        ['a blank ingredient line', { ingredientLines: [''] }],
        ['an over-long ingredient line', { ingredientLines: ['x'.repeat(PARSE_JOB_LINE_MAX_CHARS + 1)] }],
        [
            'more ingredient lines than a parse job holds',
            { ingredientLines: Array.from({ length: 201 }, () => 'salt') },
        ],
        ['a blank step', { steps: [{ instruction: '' }] }],
        ['a zero timer', { steps: [{ instruction: 'Simmer.', timerSeconds: 0 }] }],
        ['a servings count beyond int4', { servings: INT4_MAX + 1 }],
        ['a prep time beyond int4', { prepTimeMinutes: INT4_MAX + 1 }],
        [
            'an ingredient bound to a food (the importer binds, the file does not)',
            { ingredients: [{ ingredientId: 'x' }] },
        ],
        ['a client-sent source type', { sourceType: 'imported_public' }],
        ['a client-sent source url (the statement carries the citation)', { sourceUrl: 'https://example.test/x' }],
    ])('rejects %s', (_name, extra) => {
        expect(importRecipeSchema.safeParse({ ...RECIPE, ...extra }).success).toBe(false);
    });
});

describe('importStatementSchema — the per-recipe statement (ADR-0072 §9)', () => {
    it.each([
        ['I wrote this', { kind: 'authored' }],
        ['a public web page, with its URL', { kind: 'public_web', citation: 'https://example.test/soup' }],
        ['a book, with a citation', { kind: 'book', citation: 'Joy of Cooking, p. 12' }],
        ['a paid site, with a citation', { kind: 'paid_site', citation: 'Paid Site, tomato soup' }],
    ])('accepts %s', (_name, statement) => {
        expect(importStatementSchema.safeParse(statement).success).toBe(true);
    });

    it.each([
        ['"I wrote this" carrying a citation', { kind: 'authored', citation: 'x' }],
        ['a public web page with no citation', { kind: 'public_web' }],
        ['a book with no citation', { kind: 'book' }],
        ['a paid site with no citation', { kind: 'paid_site' }],
        ['a public web page whose citation is not a URL', { kind: 'public_web', citation: 'a blog I like' }],
        ['a public web page that is not http(s)', { kind: 'public_web', citation: 'javascript:alert(1)' }],
        ['a blank citation', { kind: 'book', citation: '   ' }],
        ['an over-long citation', { kind: 'book', citation: 'x'.repeat(IMPORT_MAX_CITATION_LENGTH + 1) }],
        ['an invented kind', { kind: 'blog', citation: 'x' }],
        [
            'the DERIVED source type (the server sets it from the statement)',
            { kind: 'authored', sourceType: 'imported_public' },
        ],
    ])('rejects %s', (_name, statement) => {
        expect(importStatementSchema.safeParse(statement).success).toBe(false);
    });

    it('accepts a citation of exactly the maximum length', () => {
        expect(
            importStatementSchema.safeParse({ kind: 'book', citation: 'x'.repeat(IMPORT_MAX_CITATION_LENGTH) }).success,
        ).toBe(true);
    });
});

describe('recordImportChoicesRequestSchema (POST …/items/{ordinal})', () => {
    it('accepts a statement, a visibility, or both', () => {
        expect(recordImportChoicesRequestSchema.safeParse({ statement: { kind: 'authored' } }).success).toBe(true);
        expect(recordImportChoicesRequestSchema.safeParse({ visibility: 'public' }).success).toBe(true);
        expect(
            recordImportChoicesRequestSchema.safeParse({ statement: { kind: 'authored' }, visibility: 'private' })
                .success,
        ).toBe(true);
    });

    it("lets null clear the recipe's own visibility, so it follows the import again", () => {
        expect(recordImportChoicesRequestSchema.safeParse({ visibility: null }).success).toBe(true);
    });

    it.each([
        ['nothing at all', {}],
        ['a stage', { stage: 'saved' }],
        ['a client-sent boundBy', { boundBy: 'cook' }],
        ['an invented visibility', { visibility: 'friends' }],
        ['a bad statement', { statement: { kind: 'book' } }],
    ])('rejects %s', (_name, body) => {
        expect(recordImportChoicesRequestSchema.safeParse(body).success).toBe(false);
    });
});

describe('importPickRequestSchema (PUT …/items/{ordinal}/pick)', () => {
    const base = { lineIndex: 0, foodIndex: 0, against: 'judgement-digest' };

    it.each([
        ['a food', { kind: 'food', id: 'food-1' }],
        ['a variant', { kind: 'variant', id: 'variant-1' }],
        ['"keep as written"', { kind: 'asWritten' }],
    ])('accepts %s', (_name, pick) => {
        expect(importPickRequestSchema.safeParse({ ...base, pick }).success).toBe(true);
    });

    it.each([
        ['a food with no id', { ...base, pick: { kind: 'food' } }],
        ['"as written" carrying an id', { ...base, pick: { kind: 'asWritten', id: 'x' } }],
        ['an invented kind', { ...base, pick: { kind: 'default', id: 'x' } }],
        ['no digest to pick against', { lineIndex: 0, foodIndex: 0, pick: { kind: 'asWritten' } }],
        ['an empty digest', { ...base, against: '', pick: { kind: 'asWritten' } }],
        ['a negative line', { ...base, lineIndex: -1, pick: { kind: 'asWritten' } }],
        ['a line beyond int4', { ...base, lineIndex: INT4_MAX + 1, pick: { kind: 'asWritten' } }],
        ['a fractional food index', { ...base, foodIndex: 0.5, pick: { kind: 'asWritten' } }],
        ['a client-sent boundBy', { ...base, boundBy: 'cook', pick: { kind: 'asWritten' } }],
    ])('rejects %s', (_name, body) => {
        expect(importPickRequestSchema.safeParse(body).success).toBe(false);
    });
});

describe('importCursorRequestSchema (POST …/cursor)', () => {
    it.each([
        [{ from: 3, move: { action: 'next' } }],
        [{ from: 3, move: { action: 'skip' } }],
        [{ from: 3, move: { action: 'back' } }],
        [{ from: null, move: { action: 'back' } }],
        [{ from: 3, move: { action: 'open', to: 7 } }],
    ])('accepts %j', (body) => {
        expect(importCursorRequestSchema.safeParse(body).success).toBe(true);
    });

    it.each([
        ['no expected position (the 409 needs something to compare)', { move: { action: 'next' } }],
        ['open with no target', { from: 3, move: { action: 'open' } }],
        ['a target on next', { from: 3, move: { action: 'next', to: 4 } }],
        ['an invented action', { from: 3, move: { action: 'rewind' } }],
        ['a negative target', { from: 3, move: { action: 'open', to: -1 } }],
        ['a fractional position', { from: 1.5, move: { action: 'next' } }],
        ['a key beside the move', { from: 3, move: { action: 'next' }, extra: true }],
    ])('rejects %s', (_name, body) => {
        expect(importCursorRequestSchema.safeParse(body).success).toBe(false);
    });
});

describe('advance and leave take no body', () => {
    it.each([
        ['advance', advanceImportRequestSchema],
        ['leave', leaveImportRequestSchema],
    ])('%s is an empty strict object', (_name, schema) => {
        expect(schema.safeParse({}).success).toBe(true);
        expect(schema.safeParse({ ownerId: 'x' }).success).toBe(false);
    });
});

describe('the vocabularies', () => {
    it('match modes are exactly MATCH_MODES (the binding policy owns them)', () => {
        expect([...importMatchModeSchema.options].sort()).toStrictEqual([...MATCH_MODES].sort());
    });

    it('the statement\'s four kinds are "authored" plus the three source kinds the table stores', () => {
        const kinds = importStatementSchema.options.map((member) => member.shape.kind.value).sort();

        expect(kinds).toStrictEqual(['authored', ...IMPORT_SOURCE_KINDS].sort());
        expect(IMPORT_STATEMENT_KINDS).toStrictEqual(['authored', 'source']);
        expect(IMPORT_VISIBILITIES).toStrictEqual(['public', 'private']);
    });
});

describe('responses are loose and reuse the paste match view', () => {
    const view = {
        id: '66666666-6666-4666-8666-000000000001',
        matchMode: 'review',
        visibility: 'private',
        cursorOrdinal: 0,
        reviewClosed: false,
        version: 'abc123',
        counts: { total: 2, received: 1, parsing: 0, matched: 0, saved: 1 },
        items: [
            {
                ordinal: 0,
                title: 'Soup',
                stage: 'saved',
                review: 'pending',
                statement: { kind: 'authored' },
                visibility: null,
                recipeId: null,
            },
        ],
        nextAfter: null,
    };

    it('parses a view and tolerates a field a newer server adds', () => {
        expect(importViewSchema.safeParse(view).success).toBe(true);
        expect(importViewSchema.safeParse({ ...view, somethingNew: 1 }).success).toBe(true);
    });

    it('reads a null cursor as done', () => {
        expect(importViewSchema.safeParse({ ...view, cursorOrdinal: null }).success).toBe(true);
    });

    it('closes the stage and review vocabularies on the way OUT too', () => {
        expect(importViewSchema.safeParse({ ...view, items: [{ ...view.items[0], stage: 'ready' }] }).success).toBe(
            false,
        );
    });

    it('uses the paste match view, not a second copy of it', () => {
        const line = {
            lineIndex: 0,
            foodIndex: 0,
            sourceLine: '2 cups tomatoes',
            phrase: 'tomatoes',
            measure: { quantity: { kind: 'exact', value: 2 }, unit: 'cup' },
            judgementDigest: 'jd',
            match: {
                state: 'confident',
                reason: 'exactName',
                proposed: { kind: 'root', id: 'f1', name: 'Tomato' },
                candidates: [],
            },
            flag: null,
            pick: null,
            boundBy: null,
        };
        const step = {
            ordinal: 0,
            title: 'Soup',
            stage: 'matched',
            review: 'pending',
            statement: null,
            visibility: null,
            lines: [line],
        };

        expect(importStepResponseSchema.safeParse(step).success).toBe(true);
        expect(parseProposalMatchSchema.safeParse(line.match).success).toBe(true);
        expect(
            importStepResponseSchema.safeParse({
                ...step,
                lines: [{ ...line, match: { ...line.match, state: 'maybe' } }],
            }).success,
        ).toBe(false);
    });

    it('closes the flag states', () => {
        const flagged = {
            ordinal: 0,
            lineIndex: 0,
            foodIndex: 0,
            title: 'Soup',
            sourceLine: '1 cup milk',
            bound: { kind: 'root', id: 'f1', name: 'Milk crackers' },
            boundBy: 'exact',
            flag: { state: 'flagged', suggestion: { kind: 'root', id: 'f2', name: 'Milk' } },
        };

        expect(importFlaggedResponseSchema.safeParse({ lines: [flagged] }).success).toBe(true);
        expect(
            importFlaggedResponseSchema.safeParse({ lines: [{ ...flagged, flag: { state: 'clear' } }] }).success,
        ).toBe(false);
        expect(
            importFlaggedResponseSchema.safeParse({ lines: [{ ...flagged, flag: { state: 'checking' } }] }).success,
        ).toBe(true);
    });

    it('lists the lines saved as written that wait for the cook', () => {
        const waiting = {
            ordinal: 0,
            lineIndex: 0,
            foodIndex: 0,
            title: 'Soup',
            sourceLine: '1 cup milk',
            judgementDigest: 'jd',
            match: { state: 'needsChoice', reason: 'reviewBudgetSpent', proposed: null, candidates: [] },
        };

        expect(importToCheckResponseSchema.safeParse({ lines: [waiting] }).success).toBe(true);
        expect(importToCheckResponseSchema.safeParse({ lines: [{ ...waiting, ordinal: -1 }] }).success).toBe(false);
    });
});
