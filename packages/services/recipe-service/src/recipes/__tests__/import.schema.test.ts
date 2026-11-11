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
    MAX_IMPORT_RECIPE_BYTES,
    MAX_IMPORT_ITEMS_PER_REQUEST,
    advanceImportRequestSchema,
    createImportRequestSchema,
    importCursorRequestSchema,
    importListQuerySchema,
    importPickResponseSchema,
    importFlaggedResponseSchema,
    importMatchModeSchema,
    getImportQuerySchema,
    importPickRequestSchema,
    importRecipeSchema,
    importStatementSchema,
    importStepLineSchema,
    importStepResponseSchema,
    importToCheckResponseSchema,
    importToCheckCountResponseSchema,
    importListResponseSchema,
    importViewSchema,
    recordImportChoicesBatchRequestSchema,
    MAX_IMPORT_CHOICES_PER_REQUEST,
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
const IMPORT_ID = '66666666-6666-4666-8666-000000000001';
const CREATE = { id: IMPORT_ID, expectedTotal: 1, matchMode: 'review', visibility: 'private', items: [ITEM] };
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
        ['a missing mode', { id: IMPORT_ID, expectedTotal: 1, visibility: 'private', items: [ITEM] }],
        ['no id (the client mints it, so a lost 201 is safe to replay)', { ...CREATE, id: undefined }],
        ['an id that is not a UUID', { ...CREATE, id: 'abc' }],
        ['no expectedTotal (the wizard cannot know the file is complete)', { ...CREATE, expectedTotal: undefined }],
        ['a zero expectedTotal', { ...CREATE, expectedTotal: 0 }],
        ['a fractional expectedTotal', { ...CREATE, expectedTotal: 1.5 }],
        [
            'an item whose ordinal is past expectedTotal',
            { ...CREATE, expectedTotal: 1, items: [{ ...ITEM, ordinal: 1 }] },
        ],
        ['a missing visibility', { id: IMPORT_ID, expectedTotal: 1, matchMode: 'review', items: [ITEM] }],
    ])('rejects %s', (_name, body) => {
        expect(createImportRequestSchema.safeParse(body).success).toBe(false);
    });

    it('accepts exactly the per-request maximum', () => {
        const items = Array.from({ length: MAX_IMPORT_ITEMS_PER_REQUEST }, (_n, ordinal) => ({ ...ITEM, ordinal }));

        expect(
            createImportRequestSchema.safeParse({ ...CREATE, expectedTotal: MAX_IMPORT_ITEMS_PER_REQUEST, items })
                .success,
        ).toBe(true);
    });

    it('rejects two items with one ordinal in the same request', () => {
        expect(createImportRequestSchema.safeParse({ ...CREATE, expectedTotal: 2, items: [ITEM, ITEM] }).success).toBe(
            false,
        );
    });

    it('lets an item carry its own statement and visibility, so a file needs no round trip per recipe', () => {
        const item = { ...ITEM, statement: { kind: 'authored' }, visibility: 'public' };

        expect(createImportRequestSchema.safeParse({ ...CREATE, items: [item] }).success).toBe(true);
        expect(putImportItemsRequestSchema.safeParse({ items: [item] }).success).toBe(true);
        expect(
            putImportItemsRequestSchema.safeParse({ items: [{ ...ITEM, statement: { kind: 'book' } }] }).success,
        ).toBe(false);
        expect(putImportItemsRequestSchema.safeParse({ items: [{ ...ITEM, visibility: 'friends' }] }).success).toBe(
            false,
        );
    });
});

describe('the item ordinal fits int4, and there is no per-file cap (ADR-0072 §8)', () => {
    const withOrdinal = (ordinal: number) => putImportItemsRequestSchema.safeParse({ items: [{ ...ITEM, ordinal }] });

    it('accepts 0 and the last ordinal', () => {
        expect(withOrdinal(0).success).toBe(true);
        expect(withOrdinal(MAX_IMPORT_ITEMS - 1).success).toBe(true);
    });

    it.each([-1, 1.5, MAX_IMPORT_ITEMS, INT4_MAX, INT4_MAX + 1, Number.NaN])('rejects %s', (ordinal) => {
        expect(withOrdinal(ordinal).success).toBe(false);
    });

    it('⛔ puts the ceiling at int4 itself: the owner ruled a file of any size is accepted, so only the column bounds it', () => {
        expect(MAX_IMPORT_ITEMS).toBe(INT4_MAX);
        expect(withOrdinal(INT4_MAX - 1).success).toBe(true);
    });
});

describe('putImportItemsRequestSchema', () => {
    it('is strict and needs at least one item', () => {
        expect(putImportItemsRequestSchema.safeParse({ items: [ITEM] }).success).toBe(true);
        expect(putImportItemsRequestSchema.safeParse({ items: [] }).success).toBe(false);
        expect(putImportItemsRequestSchema.safeParse({ items: [ITEM], matchMode: 'review' }).success).toBe(false);
    });
});

describe('importRecipeSchema — a title the list can show', () => {
    it('⛔ refuses a blank title: the item table’s CHECK would answer it with a 500 (23514), so the wire refuses it first', () => {
        expect(importRecipeSchema.safeParse({ title: '   ', ingredientLines: [], steps: [] }).success).toBe(false);
        expect(importRecipeSchema.safeParse({ title: '\u200b', ingredientLines: [], steps: [] }).success).toBe(true);
        expect(importRecipeSchema.safeParse({ title: ' x ', ingredientLines: [], steps: [] }).success).toBe(true);
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
        ['a whitespace-only ingredient line', { ingredientLines: ['   '] }],
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

describe('one recipe always fits one request (the body limit is 100 kB)', () => {
    const BODY_LIMIT_BYTES = 100 * 1024;
    const bytes = (value: unknown): number => new TextEncoder().encode(JSON.stringify(value)).length;

    /** The recipe with `chars` of `filler` spread over steps of at most 4,000 characters (the per-step cap is 5,000). */
    function recipeWithFiller(chars: number, filler: string) {
        const steps = [];

        for (let left = chars; left > 0; left -= 4_000) {
            steps.push({ instruction: filler.repeat(Math.min(left, 4_000)) });
        }

        return { ...RECIPE, steps };
    }

    /** The recipe with the MOST filler whose serialized size is still at most `target` bytes. */
    function recipeOfBytes(target: number, filler = 'x') {
        let low = 1;
        let high = target;

        while (low < high) {
            const mid = Math.ceil((low + high) / 2);

            if (bytes(recipeWithFiller(mid, filler)) <= target) {
                low = mid;
            } else {
                high = mid - 1;
            }
        }

        return recipeWithFiller(low, filler);
    }

    it('keeps the bound under the limit with room for the envelope', () => {
        expect(MAX_IMPORT_RECIPE_BYTES).toBeLessThan(BODY_LIMIT_BYTES);
    });

    it('accepts a recipe right at the bound, and a request carrying only that recipe fits the body limit', () => {
        const recipe = recipeOfBytes(MAX_IMPORT_RECIPE_BYTES);

        expect(importRecipeSchema.safeParse(recipe).success).toBe(true);
        expect(bytes({ matchMode: 'review', visibility: 'private', items: [{ ordinal: 0, recipe }] })).toBeLessThan(
            BODY_LIMIT_BYTES,
        );
    });

    it('rejects a recipe over the bound, so "send fewer items" is always a remedy', () => {
        expect(importRecipeSchema.safeParse(recipeOfBytes(MAX_IMPORT_RECIPE_BYTES + 1_000)).success).toBe(false);
    });

    it('counts BYTES, not characters: multi-byte text that is short in characters is still over', () => {
        const recipe = recipeOfBytes(MAX_IMPORT_RECIPE_BYTES + 3_000, '汁');
        const characters = recipe.steps.reduce((sum, step) => sum + step.instruction.length, 0);

        expect(characters).toBeLessThan(MAX_IMPORT_RECIPE_BYTES / 2);
        expect(importRecipeSchema.safeParse(recipe).success).toBe(false);
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
        ['next from done (there is no item to mark)', { from: null, move: { action: 'next' } }],
        ['skip from done (there is no item to mark)', { from: null, move: { action: 'skip' } }],
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
        expectedTotal: 2,
        allowance: { limit: 1000, used: 3, resetsAt: null },
        pause: null,
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
                issue: null,
            },
        ],
        nextAfter: null,
    };

    it('parses a view and tolerates a field a newer server adds', () => {
        expect(importViewSchema.safeParse(view).success).toBe(true);
        expect(importViewSchema.safeParse({ ...view, somethingNew: 1 }).success).toBe(true);
    });

    it('says how much of the allowance is spent and when more opens, so a paused import can explain itself', () => {
        const paused = { ...view, allowance: { limit: 1000, used: 1000, resetsAt: '2026-10-27T03:30:00.000Z' } };

        expect(importViewSchema.safeParse(paused).success).toBe(true);
        expect(importViewSchema.safeParse({ ...view, allowance: undefined }).success).toBe(false);
        expect(
            importViewSchema.safeParse({ ...view, allowance: { ...view.allowance, resetsAt: 'tomorrow' } }).success,
        ).toBe(false);
    });

    it('lets an item say it cannot be saved yet, as an opaque key, so a stuck item is never silent', () => {
        const stuck = { ...view.items[0], stage: 'matched', issue: { reason: 'visibilityRefused' } };

        expect(importViewSchema.safeParse({ ...view, items: [stuck] }).success).toBe(true);
        expect(importViewSchema.safeParse({ ...view, items: [{ ...stuck, issue: { reason: '' } }] }).success).toBe(
            false,
        );
    });

    it('reads a null cursor as done', () => {
        expect(importViewSchema.safeParse({ ...view, cursorOrdinal: null }).success).toBe(true);
    });

    it('closes the stage and review vocabularies on the way OUT too', () => {
        expect(importViewSchema.safeParse({ ...view, items: [{ ...view.items[0], stage: 'ready' }] }).success).toBe(
            false,
        );
    });

    it('⛔ carries the row the import saves: its name, and the shown words and note the parse gave (owner ruling 2026-11-08)', () => {
        const line = {
            lineIndex: 0,
            foodIndex: 0,
            sourceLine: '1 (9 inch) double-crust pie pastry',
            phrase: '9 inch double-crust pie pastry',
            name: 'double-crust pie pastry',
            note: '9 inch',
            measure: { quantity: { kind: 'exact', value: 1 }, unit: '' },
            judgementDigest: 'jd',
            match: null,
            flag: null,
            pick: null,
            boundBy: null,
        };

        expect(importStepLineSchema.safeParse(line).success).toBe(true);
        expect(importStepLineSchema.safeParse({ ...line, displayText: 'my pie pastry' }).success).toBe(true);
        // The name is what a line kept as written is saved under, so it is never missing or blank.
        expect(importStepLineSchema.safeParse({ ...line, name: undefined }).success).toBe(false);
        expect(importStepLineSchema.safeParse({ ...line, name: '  ' }).success).toBe(false);
        // A blank shown name or note is refused, as on a recipe line.
        expect(importStepLineSchema.safeParse({ ...line, displayText: '' }).success).toBe(false);
        expect(importStepLineSchema.safeParse({ ...line, note: '' }).success).toBe(false);
    });

    it('uses the paste match view, not a second copy of it', () => {
        const line = {
            lineIndex: 0,
            foodIndex: 0,
            sourceLine: '2 cups tomatoes',
            phrase: 'tomatoes',
            name: 'tomatoes',
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
            recipeId: '66666666-6666-4666-8666-0000000000a1',
            judgementDigest: 'jd',
            bound: { kind: 'root', id: 'f1', name: 'Milk crackers' },
            boundBy: 'exact',
            flag: { state: 'flagged', suggestion: { kind: 'root', id: 'f2', name: 'Milk' } },
            match: { state: 'confident', reason: 'exactName', proposed: null, candidates: [] },
        };

        expect(importFlaggedResponseSchema.safeParse({ lines: [flagged], nextAfter: null }).success).toBe(true);
        // The cook can open the draft, pick against the digest, and see the candidates: all of it is on the line.
        expect(
            importFlaggedResponseSchema.safeParse({
                lines: [{ ...flagged, judgementDigest: undefined }],
                nextAfter: null,
            }).success,
        ).toBe(false);
        expect(
            importFlaggedResponseSchema.safeParse({ lines: [{ ...flagged, match: undefined }], nextAfter: null })
                .success,
        ).toBe(false);
        // Food was down on this read: the name is null, never a name invented from storage (ADR-0045).
        expect(
            importFlaggedResponseSchema.safeParse({
                lines: [
                    {
                        ...flagged,
                        bound: { ...flagged.bound, name: null },
                        flag: { state: 'flagged', suggestion: null },
                    },
                ],
                nextAfter: null,
            }).success,
        ).toBe(true);
        // A draft the cook deleted is a null recipeId.
        expect(
            importFlaggedResponseSchema.safeParse({ lines: [{ ...flagged, recipeId: null }], nextAfter: null }).success,
        ).toBe(true);
        expect(
            importFlaggedResponseSchema.safeParse({
                lines: [{ ...flagged, flag: { state: 'clear' } }],
                nextAfter: null,
            }).success,
        ).toBe(false);
        expect(
            importFlaggedResponseSchema.safeParse({
                lines: [{ ...flagged, flag: { state: 'checking' } }],
                nextAfter: null,
            }).success,
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

        expect(importToCheckResponseSchema.safeParse({ lines: [waiting], nextAfter: 'opaque' }).success).toBe(true);
        expect(
            importToCheckResponseSchema.safeParse({ lines: [{ ...waiting, ordinal: -1 }], nextAfter: null }).success,
        ).toBe(false);
    });
});

describe('a pick answers whether it applied (a stale pick is not an error and not silent)', () => {
    const step = {
        ordinal: 0,
        title: 'Soup',
        stage: 'matched',
        review: 'pending',
        statement: null,
        visibility: null,
        lines: [],
    };

    it('carries applied and the fresh step', () => {
        expect(importPickResponseSchema.safeParse({ applied: true, step }).success).toBe(true);
        expect(importPickResponseSchema.safeParse({ applied: false, step }).success).toBe(true);
        expect(importPickResponseSchema.safeParse({ step }).success).toBe(false);
        expect(importPickResponseSchema.safeParse({ applied: true }).success).toBe(false);
    });
});

describe('the read queries page, and a blank value is not zero', () => {
    it('GET import: after is an ordinal and limit is capped', () => {
        expect(getImportQuerySchema.safeParse({ after: '0', limit: '500' }).success).toBe(true);
        expect(getImportQuerySchema.safeParse({}).success).toBe(true);
        expect(getImportQuerySchema.safeParse({ limit: '501' }).success).toBe(false);
        expect(getImportQuerySchema.safeParse({ limit: '0' }).success).toBe(false);
    });

    it.each(['', ' ', '-1', '1.5', 'abc', '1e3'])(
        'GET import: refuses after=%j rather than reading it as 0',
        (after) => {
            expect(getImportQuerySchema.safeParse({ after }).success).toBe(false);
        },
    );

    it('flagged and to-check: after is an opaque cursor and limit is capped', () => {
        expect(importListQuerySchema.safeParse({ after: 'opaque-cursor', limit: '100' }).success).toBe(true);
        expect(importListQuerySchema.safeParse({}).success).toBe(true);
        expect(importListQuerySchema.safeParse({ after: '' }).success).toBe(false);
        expect(importListQuerySchema.safeParse({ limit: '501' }).success).toBe(false);
    });
});

describe('ADR-0072 service lane additions to the contract', () => {
    const view = {
        id: '66666666-6666-4666-8666-000000000001',
        matchMode: 'keepAsWritten',
        visibility: 'private',
        cursorOrdinal: 0,
        reviewClosed: false,
        version: 'abc123',
        expectedTotal: 2,
        allowance: { limit: 1000, used: 3, resetsAt: null },
        pause: null,
        counts: { total: 2, received: 1, parsing: 0, matched: 0, saved: 1 },
        items: [],
        nextAfter: null,
    };

    it('⛔ the view says whether the import is paused, as an opaque key, and a pause is required (null when running)', () => {
        expect(importViewSchema.safeParse(view).success).toBe(true);
        expect(importViewSchema.safeParse({ ...view, pause: { reason: 'outOfSlots' } }).success).toBe(true);
        expect(importViewSchema.safeParse({ ...view, pause: { reason: '' } }).success).toBe(false);
        expect(importViewSchema.safeParse({ ...view, pause: undefined }).success).toBe(false);
    });

    it('⛔ a match is null when food could not be asked, on the step, the flagged line and the to-check line', () => {
        const line = {
            lineIndex: 0,
            foodIndex: 0,
            sourceLine: '1 cup milk',
            phrase: 'milk',
            name: 'milk',
            measure: { quantity: { kind: 'exact', value: 1 }, unit: 'cup' },
            judgementDigest: 'jd',
            match: null,
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
        const flagged = {
            ordinal: 0,
            lineIndex: 0,
            foodIndex: 0,
            title: 'Soup',
            sourceLine: '1 cup milk',
            recipeId: null,
            judgementDigest: 'jd',
            bound: { kind: 'root', id: 'f1', name: null },
            boundBy: 'exact',
            flag: { state: 'checking' },
            match: null,
        };
        const waiting = {
            ordinal: 0,
            lineIndex: 0,
            foodIndex: 0,
            title: 'Soup',
            sourceLine: '1 cup milk',
            judgementDigest: 'jd',
            match: null,
        };

        expect(importStepResponseSchema.safeParse(step).success).toBe(true);
        expect(importFlaggedResponseSchema.safeParse({ lines: [flagged], nextAfter: null }).success).toBe(true);
        expect(importToCheckResponseSchema.safeParse({ lines: [waiting], nextAfter: null }).success).toBe(true);
        // Absent is still not null: the key is required, so a server that forgot it fails the client's parse.
        expect(
            importToCheckResponseSchema.safeParse({ lines: [{ ...waiting, match: undefined }], nextAfter: null })
                .success,
        ).toBe(false);
    });

    it('lists the cook’s imports, paged, so a second device can resume', () => {
        const summary = {
            id: view.id,
            matchMode: 'review',
            visibility: 'public',
            expectedTotal: 864,
            counts: { total: 864, received: 800, parsing: 0, matched: 0, saved: 64 },
            createdAt: '2026-10-26T12:00:00.000Z',
            updatedAt: '2026-10-26T13:00:00.000Z',
        };

        expect(importListResponseSchema.safeParse({ imports: [summary], nextAfter: null }).success).toBe(true);
        expect(importListResponseSchema.safeParse({ imports: [], nextAfter: 'opaque' }).success).toBe(true);
        expect(
            importListResponseSchema.safeParse({ imports: [{ ...summary, id: 'x' }], nextAfter: null }).success,
        ).toBe(false);
        expect(importListResponseSchema.safeParse({ imports: [summary] }).success).toBe(false);
    });

    it('counts the lines waiting on the cook across the whole library', () => {
        expect(importToCheckCountResponseSchema.safeParse({ count: 0 }).success).toBe(true);
        expect(importToCheckCountResponseSchema.safeParse({ count: 7 }).success).toBe(true);
        expect(importToCheckCountResponseSchema.safeParse({ count: -1 }).success).toBe(false);
        expect(importToCheckCountResponseSchema.safeParse({ count: 1.5 }).success).toBe(false);
    });

    describe('the batch of choices (“make the rest public” is one list and one confirm)', () => {
        const entry = {
            ordinal: 3,
            statement: { kind: 'public_web', citation: 'https://example.com/r' },
            visibility: 'public',
        };

        it('takes 1..MAX entries, each a statement, a visibility or both, with distinct ordinals', () => {
            expect(recordImportChoicesBatchRequestSchema.safeParse({ items: [entry] }).success).toBe(true);
            expect(recordImportChoicesBatchRequestSchema.safeParse({ items: [] }).success).toBe(false);
            expect(
                recordImportChoicesBatchRequestSchema.safeParse({
                    items: Array.from({ length: MAX_IMPORT_CHOICES_PER_REQUEST + 1 }, (_, ordinal) => ({
                        ...entry,
                        ordinal,
                    })),
                }).success,
            ).toBe(false);
            expect(recordImportChoicesBatchRequestSchema.safeParse({ items: [entry, entry] }).success).toBe(false);
            expect(recordImportChoicesBatchRequestSchema.safeParse({ items: [{ ordinal: 1 }] }).success).toBe(false);
        });

        it('is strict: an invented key is a 400 and boundBy can never ride it', () => {
            expect(
                recordImportChoicesBatchRequestSchema.safeParse({ items: [{ ...entry, boundBy: 'cook' }] }).success,
            ).toBe(false);
            expect(recordImportChoicesBatchRequestSchema.safeParse({ items: [entry], extra: 1 }).success).toBe(false);
        });
    });
});
