/**
 * The progressive search's body reader (ADR-0055 point 9; staff-architect review ruling 1 and "Tests owed"): the body
 * is split on the newline BYTE, each line is decoded and parsed with the food schema's zod, a frame type the client does
 * not know is ignored, an outcome it does not know reads as unavailable, and a body that ends without `complete` is
 * incomplete. The five splitter cases the review lists are rows of {@link SPLITTER_CASES}.
 */
import { describe, expect, it } from 'vitest';

import { EMPTY_PROGRESSIVE_ANSWER, withProgressiveFrame, type ProgressiveAnswer } from '../progressiveAnswer.js';
import { progressiveFramesOf, type ProgressiveFrame } from '../progressiveFrames.js';

const encoder = new TextEncoder();

/** The frames a well-formed answer sends, as food writes them: one JSON value per line. */
const DATABASE_LINE =
    '{"type":"database","catalog":{"outcome":"answered","results":[{"id":"food_1","name":"Crème fraîche","score":0.9}]},"authored":{"outcome":"answered","results":[]}}';
const SOURCE_LINE =
    '{"type":"source","source":"usda","outcome":"answered","items":[{"name":"Crème, sour","reference":"ref_1"}]}';
const COMPLETE_LINE = '{"type":"complete"}';

/** The body as chunks the transport might hand over. */
async function* chunksOf(...chunks: readonly Uint8Array[]): AsyncGenerator<Uint8Array> {
    for (const chunk of chunks) {
        yield chunk;
    }
}

/** Every frame the reader yields for `chunks`, read at a fixed clock. */
async function framesOf(chunks: AsyncIterable<Uint8Array>, receivedAt = 1_000): Promise<ProgressiveFrame[]> {
    const frames: ProgressiveFrame[] = [];

    for await (const frame of progressiveFramesOf(chunks, () => receivedAt)) {
        frames.push(frame);
    }

    return frames;
}

/** The answer the frames fold to. */
const answerOf = (frames: readonly ProgressiveFrame[]): ProgressiveAnswer =>
    frames.reduce(withProgressiveFrame, EMPTY_PROGRESSIVE_ANSWER);

/** `bytes` cut at `index`, into two chunks. */
const split = (bytes: Uint8Array, index: number): readonly [Uint8Array, Uint8Array] => [
    bytes.subarray(0, index),
    bytes.subarray(index),
];

/** The index of the second byte of the first `è` in `text`'s UTF-8: a cut there splits the character in two. */
const insideFirstMultiByte = (text: string): number => encoder.encode(text.slice(0, text.indexOf('è'))).length + 1;

interface SplitterCase {
    readonly name: string;
    readonly chunks: () => readonly Uint8Array[];
    readonly types: readonly string[];
    readonly complete: boolean;
}

const WHOLE_BODY = `${DATABASE_LINE}\n${SOURCE_LINE}\n${COMPLETE_LINE}\n`;

const SPLITTER_CASES: readonly SplitterCase[] = [
    {
        name: 'a multi-byte character split across two chunks',
        chunks: () => split(encoder.encode(WHOLE_BODY), insideFirstMultiByte(WHOLE_BODY)),
        types: ['database', 'source', 'complete'],
        complete: true,
    },
    {
        name: 'every frame in one chunk',
        chunks: () => [encoder.encode(WHOLE_BODY)],
        types: ['database', 'source', 'complete'],
        complete: true,
    },
    {
        name: 'a partial last line (the body was cut mid-frame)',
        chunks: () => [encoder.encode(`${DATABASE_LINE}\n${SOURCE_LINE.slice(0, 40)}`)],
        types: ['database'],
        complete: false,
    },
    {
        name: 'a body with no complete frame',
        chunks: () => [encoder.encode(`${DATABASE_LINE}\n${SOURCE_LINE}\n`)],
        types: ['database', 'source'],
        complete: false,
    },
    {
        name: 'an unknown frame type between known ones',
        chunks: () => [encoder.encode(`${DATABASE_LINE}\n{"type":"progress","percent":50}\n${COMPLETE_LINE}\n`)],
        types: ['database', 'complete'],
        complete: true,
    },
    {
        name: 'a frame split across three chunks, one byte at a time at the newline',
        chunks: () => {
            const bytes = encoder.encode(`${DATABASE_LINE}\n${COMPLETE_LINE}\n`);
            const newline = bytes.indexOf(0x0a);

            return [bytes.subarray(0, newline), bytes.subarray(newline, newline + 1), bytes.subarray(newline + 1)];
        },
        types: ['database', 'complete'],
        complete: true,
    },
    {
        name: 'a last frame with no trailing newline',
        chunks: () => [encoder.encode(`${DATABASE_LINE}\n${COMPLETE_LINE}`)],
        types: ['database', 'complete'],
        complete: true,
    },
    {
        name: 'blank lines between frames',
        chunks: () => [encoder.encode(`${DATABASE_LINE}\n\n${COMPLETE_LINE}\n`)],
        types: ['database', 'complete'],
        complete: true,
    },
];

describe('progressiveFramesOf — splitting the body', () => {
    it.each(SPLITTER_CASES)('$name', async ({ chunks, types, complete }) => {
        const frames = await framesOf(chunksOf(...chunks()));

        expect(frames.map((frame) => frame.type)).toEqual(types);
        expect(answerOf(frames).complete).toBe(complete);
    });

    it('decodes a character split across chunks whole, never as replacement characters', async () => {
        const [first, second] = split(encoder.encode(WHOLE_BODY), insideFirstMultiByte(WHOLE_BODY));
        const [database] = await framesOf(chunksOf(first, second));

        expect(database).toMatchObject({
            type: 'database',
            catalog: { outcome: 'answered', results: [{ name: 'Crème fraîche' }] },
        });
    });
});

describe('progressiveFramesOf — reading each frame', () => {
    it.each<[string, string, unknown]>([
        [
            'an unknown source outcome reads as unavailable',
            '{"type":"source","source":"usda","outcome":"throttled","retryInMinutes":3}',
            { type: 'source', source: 'usda', outcome: 'unavailable' },
        ],
        [
            'an answered source frame whose items do not parse reads as unavailable',
            '{"type":"source","source":"usda","outcome":"answered","items":[{"name":""}]}',
            { type: 'source', source: 'usda', outcome: 'unavailable' },
        ],
        [
            'a source frame that names no valid source is dropped',
            '{"type":"source","source":"USDA!","outcome":"answered","items":[]}',
            undefined,
        ],
        [
            'an unknown catalog outcome makes that group unavailable, and the other group stands',
            '{"type":"database","catalog":{"outcome":"partial"},"authored":{"outcome":"answered","results":[]}}',
            {
                type: 'database',
                catalog: { outcome: 'unavailable' },
                authored: { outcome: 'answered', results: [] },
            },
        ],
        [
            'a malformed authored group makes that group unavailable, and the other group stands',
            '{"type":"database","catalog":{"outcome":"answered","results":[]},"authored":{"outcome":"answered","results":[{"id":3}]}}',
            {
                type: 'database',
                catalog: { outcome: 'answered', results: [] },
                authored: { outcome: 'unavailable' },
            },
        ],
        ['a line that is not JSON is dropped', '{"type":"database",', undefined],
        ['a JSON value that is not an object is dropped', '"complete"', undefined],
        ['an object with no type is dropped', '{"outcome":"answered"}', undefined],
    ])('%s', async (_case, line, expected) => {
        const frames = await framesOf(chunksOf(encoder.encode(`${line}\n`)));

        expect(frames[0]).toEqual(expected);
        expect(frames).toHaveLength(expected === undefined ? 0 : 1);
    });

    it.each<['busy' | 'limited']>([['busy'], ['limited']])(
        'turns a %s frame’s seconds into the time it ends, from when the frame arrived',
        async (outcome) => {
            const line = `{"type":"source","source":"usda","outcome":"${outcome}","retryAfterSeconds":90}\n`;
            const frames = await framesOf(chunksOf(encoder.encode(line)), 5_000);

            expect(frames).toEqual([{ type: 'source', source: 'usda', outcome, retryAt: 95_000 }]);
        },
    );

    it('reads the clock when each frame arrives, not once for the body', async () => {
        const times = [1_000, 61_000];
        const frames: ProgressiveFrame[] = [];
        const body = chunksOf(
            encoder.encode('{"type":"source","source":"usda","outcome":"limited","retryAfterSeconds":1}\n'),
            encoder.encode('{"type":"source","source":"cnf","outcome":"limited","retryAfterSeconds":1}\n'),
        );

        for await (const frame of progressiveFramesOf(body, () => times.shift() ?? 0)) {
            frames.push(frame);
        }

        expect(frames.map((frame) => (frame.type === 'source' && 'retryAt' in frame ? frame.retryAt : 0))).toEqual([
            2_000, 62_000,
        ]);
    });
});

describe('withProgressiveFrame — folding frames into one answer', () => {
    const database: ProgressiveFrame = {
        type: 'database',
        catalog: { outcome: 'answered', results: [] },
        authored: { outcome: 'answered', results: [] },
    };
    const usda: ProgressiveFrame = { type: 'source', source: 'usda', outcome: 'answered', items: [] };
    const cnf: ProgressiveFrame = { type: 'source', source: 'cnf', outcome: 'unavailable' };
    const complete: ProgressiveFrame = { type: 'complete' };

    it('keeps the database frame, the sources in the order they arrived, and completion', () => {
        expect(answerOf([database, cnf, usda, complete])).toEqual({
            database,
            sources: [cnf, usda],
            complete: true,
        });
    });

    it('starts with nothing arrived and not complete', () => {
        expect(EMPTY_PROGRESSIVE_ANSWER).toEqual({ database: undefined, sources: [], complete: false });
    });

    it('keeps the first database frame and the first frame of each source', () => {
        const later: ProgressiveFrame = {
            type: 'database',
            catalog: { outcome: 'unavailable' },
            authored: { outcome: 'unavailable' },
        };
        const usdaAgain: ProgressiveFrame = { type: 'source', source: 'usda', outcome: 'unavailable' };

        expect(answerOf([database, usda, later, usdaAgain])).toEqual({
            database,
            sources: [usda],
            complete: false,
        });
    });

    it('ignores every frame after completion', () => {
        expect(answerOf([database, complete, usda])).toEqual({ database, sources: [], complete: true });
    });

    it('returns the same answer for a frame it ignores, so nothing re-renders for it', () => {
        const answer = answerOf([database, complete]);

        expect(withProgressiveFrame(answer, usda)).toBe(answer);
    });
});
