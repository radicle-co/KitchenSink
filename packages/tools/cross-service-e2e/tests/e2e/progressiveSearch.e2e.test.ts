/**
 * The progressive food search and the remote pick on a DEPLOYED stage (ADR-0055 points 5, 9 and 10; plan 002 R62 to
 * R67, S7.10). Target: DEPLOYED (`docs/CODING_STANDARDS.md` §7.1a), a `pr-{N}` preview, as the linkage cook.
 *
 * | Claim                                       | Pinned here                                                                  |
 * | ------------------------------------------- | ---------------------------------------------------------------------------- |
 * | the answer is one caller's stream of frames | `200`, the NDJSON content type, `private, no-store`                          |
 * | our database first, the completion last     | frame 0 is `database`, the last is the only `complete`, every line parses    |
 * | a picked remote food becomes a root         | the adopt answers an id, and `GET /foods/{id}` is that root, resolved        |
 * | the root then hides the hit                 | the same search's `usda` frame still answers, and no longer holds the name   |
 *
 * Only a deployment shows these: the stage's own search service and its CloudFront cache, food's signing key, USDA,
 * and a streamed body through the shared ALB. The LOCAL tier (`food-service/tests/e2e/progressiveSearch.e2e.test.ts`)
 * proves the code against stand-ins.
 *
 * ⛔ The pick writes a catalog root from USDA, which a test may leave behind (ADR-0040 ruling 1), so nothing here is
 * cleaned up. It refuses any origin but a per-PR preview before it picks, as its job refuses one before it starts.
 *
 * ⚠️ The per-PR database outlives each run, so each run leaves one more remote food held. The pick takes the first term
 * whose USDA frame still shows a food it can tell apart by name, and fails naming every term's outcome once none does.
 */
import { readFileSync } from 'node:fs';

import {
    adoptRemoteFoodResponseSchema,
    foodResponseSchema,
    PROGRESSIVE_SEARCH_CONTENT_TYPE,
    progressiveSearchFrameSchema,
    type ProgressiveSearchFrame,
    type RemoteFoodView,
    type SourceFrame,
} from '@kitchensink/schema-food';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

/**
 * Read a required environment value, or throw naming it.
 *
 * @param name - The variable to read.
 * @returns Its value.
 */
function required(name: string): string {
    const value = process.env[name];

    if (value === undefined || value.trim() === '') {
        throw new Error(
            `${name} is required. This tier drives a DEPLOYED food origin; without it there is nothing to prove, ` +
                'and skipping would report a search nobody made.',
        );
    }

    return value;
}

/** The part of `scripts/mintLinkageCredentials.ts`'s artefact this spec sends. */
const linkageCredentialsSchema = z.object({ token: z.string().min(1) });

const FOOD_URL = required('LINKAGE_FOOD_URL').replace(/\/+$/, '');
const { token } = linkageCredentialsSchema.parse(JSON.parse(readFileSync(required('LINKAGE_CREDENTIALS'), 'utf-8')));

/** The remote source read here: the one whose register entry declares remote search today (ADR-0055 point 1). */
const SOURCE = 'usda';

/**
 * The terms tried, in order, for a remote food to pick: common enough that USDA's branded foods fill a page for each,
 * and each already in `searchTermQuerySchema`'s canonical form.
 */
const PICK_TERMS = ['kale', 'lentils', 'cheddar', 'yogurt', 'almond', 'salmon', 'basil', 'oats'] as const;

/** A per-PR preview's food host, `food-pr-{N}` (`publicSubdomainForStage`); production's is `food`. */
const PREVIEW_FOOD_HOST = /^food-pr-\d+\./u;

/** What one request observed. */
interface Answer {
    readonly status: number;
    readonly text: string;
    readonly headers: Headers;
}

/**
 * Call food-service as the linkage cook.
 *
 * @param path - The path under the food origin.
 * @param init - Fetch options; the bearer is always added.
 * @returns The status, the raw body and the headers.
 * @sideEffect Performs a network request.
 */
async function callFood(path: string, init: RequestInit = {}): Promise<Answer> {
    const response = await fetch(`${FOOD_URL}${path}`, {
        ...init,
        headers: {
            authorization: `Bearer ${token}`,
            ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        redirect: 'manual',
    });

    return { status: response.status, text: await response.text(), headers: response.headers };
}

/**
 * The message an unexpected status fails with. A `401` is most often the bearer ageing out: a Clerk session token
 * lives about sixty seconds, and the job mints one per spec file.
 *
 * @param answer - What the call observed.
 * @returns The failure message.
 */
function failureOf(answer: Answer): string {
    const hint = answer.status === 401 ? ' (the linkage bearer aged out or was refused; see the job mint step)' : '';

    return `HTTP ${String(answer.status)}${hint}: ${answer.text}`;
}

/**
 * The frames of a progressive body: each line one JSON frame ended by the newline byte (ADR-0055 point 9), and each
 * one in the contract. A blank line, an unknown frame or a body cut mid-line fails here.
 *
 * @param body - The body.
 * @returns The frames, in order.
 */
function framesOf(body: string): ProgressiveSearchFrame[] {
    expect(body.endsWith('\n'), 'the last frame ends with a newline, as every frame does').toBe(true);

    return body
        .slice(0, -1)
        .split('\n')
        .map((line) => progressiveSearchFrameSchema.parse(JSON.parse(line)));
}

/** One progressive answer: the response, and its frames. */
interface ProgressiveAnswer {
    readonly answer: Answer;
    readonly frames: readonly ProgressiveSearchFrame[];
}

/**
 * Search progressively for `term`, insisting on a `200`.
 *
 * @param term - A canonical term.
 * @returns The answer and its frames.
 * @sideEffect Performs a network request; a term the search service has not cached spends one USDA call.
 */
async function searchProgressive(term: string): Promise<ProgressiveAnswer> {
    const answer = await callFood(`/api/v1/foods/search/progressive?query=${encodeURIComponent(term)}`);

    expect(answer.status, failureOf(answer)).toBe(200);

    return { answer, frames: framesOf(answer.text) };
}

/**
 * The one frame {@link SOURCE} sent.
 *
 * @param frames - The answer's frames.
 * @returns Its frame.
 */
function sourceFrameOf(frames: readonly ProgressiveSearchFrame[]): SourceFrame {
    const found = frames.filter((frame): frame is SourceFrame => frame.type === 'source' && frame.source === SOURCE);

    expect(found, `exactly one ${SOURCE} frame`).toHaveLength(1);

    return found[0]!;
}

/**
 * A remote food this proof can pick: its name is the only one of its kind in the source's frame and names no catalog
 * result, so the name alone tells whether the next answer still shows it.
 *
 * @param frames - One answer's frames.
 * @returns The food, or why there is none.
 */
function pickableIn(
    frames: readonly ProgressiveSearchFrame[],
): { readonly pick: RemoteFoodView } | { readonly outcome: string } {
    const source = sourceFrameOf(frames);

    if (source.outcome !== 'answered') {
        return {
            outcome: 'retryAfterSeconds' in source ? `${source.outcome} ${source.retryAfterSeconds}s` : source.outcome,
        };
    }

    const database = frames[0];
    const catalogNames = new Set(
        database?.type === 'database' && database.catalog.outcome === 'answered'
            ? database.catalog.results.flatMap((result) => (result.name === null ? [] : [result.name.toLowerCase()]))
            : [],
    );
    const names = source.items.map((item) => item.name.toLowerCase());
    const pick = source.items.find(
        (_item, index) =>
            !catalogNames.has(names[index]!) && names.filter((name) => name === names[index]).length === 1,
    );

    return pick === undefined ? { outcome: `answered ${String(source.items.length)}, none to tell apart` } : { pick };
}

describe('the progressive food search on the deployed food origin (plan 002 S7)', () => {
    it('answers our database first and the completion last, every line a frame of the contract', async () => {
        const { answer, frames } = await searchProgressive(PICK_TERMS[0]);

        expect(answer.headers.get('content-type')).toBe(PROGRESSIVE_SEARCH_CONTENT_TYPE);
        expect(answer.headers.get('cache-control')).toBe('private, no-store');
        expect(frames[0]).toMatchObject({
            type: 'database',
            catalog: { outcome: 'answered' },
            authored: { outcome: 'answered' },
        });
        expect(frames.at(-1)).toStrictEqual({ type: 'complete' });
        expect(frames.filter((frame) => frame.type === 'complete')).toHaveLength(1);
        sourceFrameOf(frames);
    });

    it('makes a picked remote food a root, and the same search then no longer shows it', async () => {
        expect(new URL(FOOD_URL).hostname, 'a pick writes a catalog root, so it runs only on a per-PR preview').toMatch(
            PREVIEW_FOOD_HOST,
        );

        const outcomes: string[] = [];
        let found: { readonly term: string; readonly pick: RemoteFoodView } | undefined;

        for (const term of PICK_TERMS) {
            const pickable = pickableIn((await searchProgressive(term)).frames);

            if ('pick' in pickable) {
                found = { term, pick: pickable.pick };
                break;
            }

            outcomes.push(`${term}: ${pickable.outcome}`);
        }

        if (found === undefined) {
            throw new Error(`no term shows a remote food to pick on this preview (${outcomes.join('; ')})`);
        }

        const adopted = await callFood('/api/v1/foods/remote/adopt', {
            method: 'POST',
            body: JSON.stringify({ reference: found.pick.reference }),
        });

        expect(adopted.status, failureOf(adopted)).toBe(200);
        expect(adopted.headers.get('cache-control')).toBe('private, no-store');

        const { id } = adoptRemoteFoodResponseSchema.parse(JSON.parse(adopted.text));
        const root = await callFood(`/api/v1/foods/${encodeURIComponent(id)}`);

        expect(root.status, failureOf(root)).toBe(200);
        expect(foodResponseSchema.parse(JSON.parse(root.text))).toMatchObject({
            id,
            name: found.pick.name,
            status: 'RESOLVED',
        });

        const after = sourceFrameOf((await searchProgressive(found.term)).frames);

        // The positive control: the source answered, so the name's absence is the catalog holding the food.
        expect(after.outcome, `the ${SOURCE} frame after the pick`).toBe('answered');
        expect(after.outcome === 'answered' ? after.items.map((item) => item.name) : []).not.toContain(found.pick.name);
    });
});
