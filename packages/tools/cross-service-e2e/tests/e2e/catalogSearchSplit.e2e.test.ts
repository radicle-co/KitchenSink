/**
 * The split food search on a DEPLOYED stage (plan 002 R40, S3): the shared catalog route never carries the cook's own
 * food, and the per-caller route does. Target: DEPLOYED (`docs/CODING_STANDARDS.md` §7.1a), a `pr-{N}` preview.
 *
 * Every other suite of these routes boots the service itself, so none can see whether the deployed image serves them
 * as written. This one drives the stage's own food origin as the linkage cook.
 *
 * | Plan 002 S3 property                                      | Pinned here                                                   |
 * | --------------------------------------------------------- | ------------------------------------------------------------- |
 * | 1 — the catalog answer ignores the caller's own foods     | the body for Q is byte-identical before and after the cook authors a food matching Q |
 * | 5 — a shared body carries no caller's counter             | no `x-ratelimit-*` and no `Cache-Control` on the catalog `200` |
 * | 6 — the per-caller route returns the cook's own food      | the new food, `private`, under `private, no-store`             |
 *
 * ⚠️ A preview has no CloudFront (ADR-0020 is production only), so this proves the ORIGIN. Nothing here proves the
 * production edge's cache; that is `EdgeStack.test.ts` (the synthesized key) and `prod-deploy.yml`'s tokenless probe
 * of the catalog path (the edge's verifier answers before the cache).
 *
 * ⚠️ One credential. A deployed check that two different cooks receive the same bytes needs a SECOND linkage slot, and
 * the test pool holds one (`@kitchensink/e2e-fixtures/testPool`). `food-service/tests/catalogSearchApi.integration.test.ts`
 * (mocked) and `tests/e2e/catalogSearchPrivacy.e2e.test.ts` (LOCAL) pin the two-caller case; deployed, it is a gap.
 */
import { readFileSync } from 'node:fs';

import {
    authoredFoodSearchResponseSchema,
    catalogSearchResponseSchema,
    foodResponseSchema,
} from '@kitchensink/schema-food';
import { afterAll, describe, expect, it } from 'vitest';

/** The credential artefact `scripts/mintLinkageCredentials.ts` writes; only the bearer is read here. */
interface LinkageCredentials {
    readonly token: string;
}

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

const FOOD_URL = required('LINKAGE_FOOD_URL').replace(/\/+$/, '');
const credentials = JSON.parse(readFileSync(required('LINKAGE_CREDENTIALS'), 'utf-8')) as LinkageCredentials;

/**
 * A KTD-16 test root of the committed seed, which every preview applies on deploy (ADR-0051), and the search term. The
 * catalog must keep answering the root alone.
 */
const ROOT_NAME = 'beef brisket';

/**
 * The cook's own food: it holds the search term, so the authored route finds it, and it equals no seed root, so a
 * leftover cannot pass for the root in the next spec, which searches the same term as the same cook.
 */
const AUTHORED_NAME = `${ROOT_NAME} split probe`;

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
            authorization: `Bearer ${credentials.token}`,
            ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
        },
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
 * Search one split route for {@link ROOT_NAME}, insisting on a `200`.
 *
 * @param route - `catalog` or `authored`.
 * @returns The answer.
 * @sideEffect Performs a network request.
 */
async function search(route: 'catalog' | 'authored'): Promise<Answer> {
    const answer = await callFood(`/api/v1/foods/${route}/search?query=${encodeURIComponent(ROOT_NAME)}`);

    expect(answer.status, failureOf(answer)).toBe(200);

    return answer;
}

/**
 * The rate-limit headers an answer carries.
 *
 * @param answer - The answer.
 * @returns Their names.
 */
function rateLimitHeaders(answer: Answer): string[] {
    return [...answer.headers.keys()].filter((name) => name.startsWith('x-ratelimit'));
}

describe('the split food search on the deployed food origin (plan 002 S3)', () => {
    let authoredId: string | undefined;

    afterAll(async () => {
        // The pool reset after the run purges the cook's foods too (ADR-0040); this keeps the window small.
        if (authoredId !== undefined) {
            const deleted = await callFood(`/api/v1/foods/${authoredId}`, { method: 'DELETE' });

            if (deleted.status >= 300) {
                console.warn(`catalogSearchSplit: left authored food ${authoredId} behind — ${failureOf(deleted)}`);
            }
        }
    });

    it("never carries the cook's own food in the catalog answer, and the authored route does", async () => {
        const before = await search('catalog');
        const rootIds = catalogSearchResponseSchema
            .parse(JSON.parse(before.text))
            .results.filter((hit) => hit.name === ROOT_NAME)
            .map((hit) => hit.id);

        // Positive control: the seed root is there, so "unchanged" cannot mean "empty both times".
        expect(rootIds, `no catalog root named '${ROOT_NAME}' — is the committed seed applied?`).toHaveLength(1);
        expect(before.headers.get('cache-control'), 'the catalog 200 leaves caching to the edge').toBeNull();
        expect(rateLimitHeaders(before)).toStrictEqual([]);

        const created = await callFood('/api/v1/foods/authored', {
            method: 'POST',
            body: JSON.stringify({ name: AUTHORED_NAME, macros: { calories: 250, proteinG: 20, carbsG: 0, fatG: 18 } }),
        });

        // A `409` means a previous run left this cook's food behind and the pool reset did not purge it.
        expect(created.status, failureOf(created)).toBe(201);
        authoredId = foodResponseSchema.parse(JSON.parse(created.text)).id;

        const after = await search('catalog');

        expect(after.text).toBe(before.text);

        const mine = await search('authored');

        expect(authoredFoodSearchResponseSchema.parse(JSON.parse(mine.text)).results).toContainEqual(
            expect.objectContaining({ id: authoredId, name: AUTHORED_NAME }),
        );
        expect(mine.headers.get('cache-control')).toBe('private, no-store');
        expect(rateLimitHeaders(mine)).toStrictEqual([]);
    });
});
