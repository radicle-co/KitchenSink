/**
 * The progressive search's frames (ADR-0055 point 9, review ruling 1, `rowEditorOpenDecisions.md` system change 13):
 * one `database` frame holding both groups, each with its own outcome; one `source` frame per remote source, naming
 * it by register id; and `complete`. A remote hit carries the name its root will carry and the sealed reference, and
 * never the source's key or a variant.
 */
import { describe, expect, it } from 'vitest';

import { MAX_REMOTE_REFERENCE_LENGTH } from '../foods.schema.js';
import {
    PROGRESSIVE_SEARCH_CONTENT_TYPE,
    progressiveSearchFrameSchema,
    progressiveSearchLineSchema,
    remoteFoodViewSchema,
} from '../progressiveSearch.schema.js';

const DATABASE = {
    type: 'database',
    catalog: { outcome: 'answered', results: [{ id: 'R-kale', name: 'kale', score: 1 }] },
    authored: { outcome: 'unavailable' },
};

describe('progressiveSearchFrameSchema', () => {
    it.each<[string, unknown]>([
        ['the database frame, each group with its own outcome', DATABASE],
        [
            'a database frame whose groups both answered nothing',
            {
                type: 'database',
                catalog: { outcome: 'answered', results: [] },
                authored: { outcome: 'answered', results: [] },
            },
        ],
        [
            'a source that answered',
            {
                type: 'source',
                source: 'usda',
                outcome: 'answered',
                items: [{ name: 'Kale chips, baked', reference: 'a.b.c.d.e' }],
            },
        ],
        ['a busy source', { type: 'source', source: 'usda', outcome: 'busy', retryAfterSeconds: 60 }],
        [
            'the cook’s limit, with when it ends',
            { type: 'source', source: 'usda', outcome: 'limited', retryAfterSeconds: 1_200 },
        ],
        ['an unavailable source', { type: 'source', source: 'usda', outcome: 'unavailable' }],
        ['completion', { type: 'complete' }],
    ])('accepts %s', (_label, frame) => {
        expect(progressiveSearchFrameSchema.safeParse(frame).success).toBe(true);
    });

    it.each<[string, unknown]>([
        ['a database frame missing a group', { type: 'database', catalog: DATABASE.catalog }],
        [
            'a source named by its display name rather than its register id',
            {
                type: 'source',
                source: 'FoodData Central',
                outcome: 'unavailable',
            },
        ],
        ['a limit with no end', { type: 'source', source: 'usda', outcome: 'limited' }],
        [
            'a busy source with a wait of nothing',
            { type: 'source', source: 'usda', outcome: 'busy', retryAfterSeconds: 0 },
        ],
        ['a frame type it does not publish', { type: 'progress' }],
    ])('refuses %s', (_label, frame) => {
        expect(progressiveSearchFrameSchema.safeParse(frame).success).toBe(false);
    });
});

/**
 * One line as a client reads it: the contract's promise that a frame or an outcome can be added without a client
 * breaking. A frame type the client does not know is `null`, which it skips; an outcome it does not know is unavailable.
 */
describe('progressiveSearchLineSchema', () => {
    it.each<[string, unknown, unknown]>([
        ['the database frame, as it is', DATABASE, DATABASE],
        [
            'a busy source, as it is',
            { type: 'source', source: 'usda', outcome: 'busy', retryAfterSeconds: 60 },
            { type: 'source', source: 'usda', outcome: 'busy', retryAfterSeconds: 60 },
        ],
        ['completion, as it is', { type: 'complete' }, { type: 'complete' }],
        ['a frame type it does not know, as nothing to read', { type: 'progress', percent: 50 }, null],
        [
            'a source outcome it does not know, as unavailable',
            { type: 'source', source: 'usda', outcome: 'throttled', retryInMinutes: 3 },
            { type: 'source', source: 'usda', outcome: 'unavailable' },
        ],
        [
            'a source frame that does not parse, as unavailable',
            { type: 'source', source: 'usda', outcome: 'answered', items: [{ name: '' }] },
            { type: 'source', source: 'usda', outcome: 'unavailable' },
        ],
        [
            'a group outcome it does not know, as that group unavailable, the other standing',
            { type: 'database', catalog: { outcome: 'partial' }, authored: DATABASE.catalog },
            { type: 'database', catalog: { outcome: 'unavailable' }, authored: DATABASE.catalog },
        ],
        [
            'a source frame naming no valid source, as nothing to read',
            { type: 'source', source: 'USDA!', outcome: 'answered', items: [] },
            null,
        ],
    ])('reads %s', (_label, line, read) => {
        expect(progressiveSearchLineSchema.parse(line)).toStrictEqual(read);
    });

    it.each<[string, unknown]>([
        ['an object with no type', { outcome: 'answered' }],
        ['a value that is not an object', 'complete'],
    ])('refuses %s, which is not a frame', (_label, line) => {
        expect(progressiveSearchLineSchema.safeParse(line).success).toBe(false);
    });
});

describe('remoteFoodViewSchema', () => {
    it('carries a name and a reference, and drops anything else a hit might have had', () => {
        expect(
            remoteFoodViewSchema.parse({ name: 'Kale', reference: 'a.b.c.d.e', externalKey: '2346405', variant: {} }),
        ).toStrictEqual({ name: 'Kale', reference: 'a.b.c.d.e' });
    });

    it('bounds the reference as the pick command does', () => {
        expect(
            remoteFoodViewSchema.safeParse({ name: 'Kale', reference: 'a'.repeat(MAX_REMOTE_REFERENCE_LENGTH + 1) })
                .success,
        ).toBe(false);
        expect(remoteFoodViewSchema.safeParse({ name: '', reference: 'a.b.c.d.e' }).success).toBe(false);
    });
});

describe('PROGRESSIVE_SEARCH_CONTENT_TYPE', () => {
    it('is newline-delimited JSON in UTF-8', () => {
        expect(PROGRESSIVE_SEARCH_CONTENT_TYPE).toBe('application/x-ndjson; charset=utf-8');
    });
});
