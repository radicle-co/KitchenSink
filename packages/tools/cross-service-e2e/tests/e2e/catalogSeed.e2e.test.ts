/**
 * The DEPLOYED catalog seed, read through food-service's public API (curated plan U8, D tier).
 *
 * Target: DEPLOYED (`docs/CODING_STANDARDS.md` §7.1a). Every other catalog suite seeds its own rows into a
 * database it started, so none of them can see whether the seed a deploy applied (ADR-0051) is the seed the
 * repository holds. This one reads the stage's own catalog and fails if it is not.
 *
 * | Plan line | Pinned here |
 * | --- | --- |
 * | a baseline root is searchable | an SR Legacy root no curated entry covers is found under its USDA description |
 * | `refs/resolve` answers a root id | that root answers `found` with its name, as the cook's own caller |
 * | a stranger gets not-found | an id nothing holds answers `absent`, the entry a stranger's private food gets |
 * | the KTD-16 test roots' variants are present | both roots read with live variants, and a variant ref resolves under its root |
 *
 * ⚠️ The stranger half is partial, stated rather than hidden. A deployed stranger needs a SECOND signed-in cook,
 * and the test pool's linkage tier holds one slot (`@kitchensink/e2e-fixtures/testPool`). So this suite pins the
 * `absent` entry for an id nothing holds, and `food-service/tests/foodRefsApi.integration.test.ts` pins that a
 * stranger's private food answers the byte-equal body. Closing it here needs a second linkage slot, provisioned
 * by `poolAdmin --apply`.
 *
 * It lives in the LINKAGE tier, not in `tests/deployed/`, because every read here needs a Clerk bearer the stage
 * accepts. The `tests/deployed/` job holds no credential and also runs against production (its config states
 * why), so a credentialed read cannot live there. This tier drives a `pr-{N}` preview only.
 *
 * ⚠️ The facts below are SEED facts, taken from the committed seed (`food-service/src/foods/seed/data/`). If the
 * curated seed later covers the baseline root named here, this suite fails naming it, and the fix is to name
 * another baseline root, not to loosen the check.
 */
import { readFileSync } from 'node:fs';

import {
    foodResponseSchema,
    resolveFoodRefsResponseSchema,
    searchResponseSchema,
    type FoodRef,
    type FoodRefEntry,
    type FoodResponse,
} from '@kitchensink/schema-food';
import { beforeAll, describe, expect, it } from 'vitest';

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
            `${name} is required. This tier reads a DEPLOYED catalog; without it there is nothing to prove, ` +
                'and skipping would report a seed nobody read.',
        );
    }

    return value;
}

const FOOD_URL = required('LINKAGE_FOOD_URL').replace(/\/+$/, '');
const credentials = JSON.parse(readFileSync(required('LINKAGE_CREDENTIALS'), 'utf-8')) as LinkageCredentials;

/**
 * An SR Legacy item the curated seed does not cover, so the baseline makes it a root under its full USDA
 * description (KTD-16). Read from the committed seed on 2026-10-02: `fdc:168217`, one of its 164 baseline roots.
 */
const BASELINE_ROOT = 'Raspberry juice concentrate';

/** The two KTD-16 test roots, each with a synonym the committed seed declares for it. */
const TEST_ROOTS = [
    { name: 'beef brisket', synonym: 'first cut brisket' },
    { name: 'boneless skinless chicken breasts', synonym: 'boneless chicken breasts' },
] as const;

/** A well-formed id no food holds: a ULID made only of zeros, which no generator issues. */
const UNKNOWN_ID = '00000000000000000000000000';

/** What one request observed. */
interface Answer {
    readonly status: number;
    readonly body: unknown;
}

/**
 * Call food-service as the linkage cook.
 *
 * @param path - The path under the food origin.
 * @param init - Fetch options; the bearer is always added.
 * @returns The status and the decoded body.
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
    const text = await response.text();

    return { status: response.status, body: text === '' ? undefined : (JSON.parse(text) as unknown) };
}

/**
 * The message an unexpected status fails with. A `401` here is most often the bearer ageing out: a Clerk session
 * token lives about sixty seconds, and the job mints one for the whole run.
 *
 * @param answer - What the call observed.
 * @returns The failure message.
 */
function failureOf(answer: Answer): string {
    const hint = answer.status === 401 ? ' (the linkage bearer aged out or was refused; see the job mint step)' : '';

    return `HTTP ${String(answer.status)}${hint}: ${JSON.stringify(answer.body)}`;
}

/**
 * Search the catalog and return the hits named exactly `name`.
 *
 * @param query - The search text.
 * @param name - The name a hit must carry.
 * @returns The ids of the hits with that name.
 * @sideEffect Performs a network request.
 */
async function idsNamed(query: string, name: string): Promise<readonly string[]> {
    const answer = await callFood(`/api/v1/foods/search?query=${encodeURIComponent(query)}`);

    expect(answer.status, failureOf(answer)).toBe(200);

    return searchResponseSchema
        .parse(answer.body)
        .results.filter((hit) => hit.name === name)
        .map((hit) => hit.id);
}

/**
 * Read one food by id.
 *
 * @param id - The food id.
 * @returns The food.
 * @sideEffect Performs a network request.
 */
async function readFood(id: string): Promise<FoodResponse> {
    const answer = await callFood(`/api/v1/foods/${encodeURIComponent(id)}`);

    expect(answer.status, failureOf(answer)).toBe(200);

    return foodResponseSchema.parse(answer.body);
}

/**
 * Resolve refs as the linkage cook.
 *
 * @param refs - The refs to resolve.
 * @returns One entry per distinct ref.
 * @sideEffect Performs a network request.
 */
async function resolve(refs: readonly FoodRef[]): Promise<readonly FoodRefEntry[]> {
    const answer = await callFood('/api/v1/foods/refs/resolve', { method: 'POST', body: JSON.stringify({ refs }) });

    expect(answer.status, failureOf(answer)).toBe(200);

    return resolveFoodRefsResponseSchema.parse(answer.body).entries;
}

beforeAll(async () => {
    const health = await fetch(`${FOOD_URL}/health`);

    if (health.status !== 200) {
        throw new Error(`food service is not serving at ${FOOD_URL}/health (HTTP ${String(health.status)}).`);
    }
});

describe('the deployed catalog seed (curated plan U8)', () => {
    it('serves a baseline root under its USDA description, and resolves it found', async () => {
        const [id, ...extra] = await idsNamed(BASELINE_ROOT, BASELINE_ROOT);

        expect(
            id,
            `no root named "${BASELINE_ROOT}": the stage does not hold the committed seed's baseline`,
        ).toBeDefined();
        expect(extra, 'the baseline holds one root per distinct description').toEqual([]);

        const [entry] = await resolve([{ kind: 'root', id: id! }]);

        expect(entry).toMatchObject({ outcome: 'found', ref: { kind: 'root', id }, name: BASELINE_ROOT });
    });

    it('answers absent for an id nothing holds, the entry a stranger gets for a private food', async () => {
        const entries = await resolve([{ kind: 'root', id: UNKNOWN_ID }]);

        expect(entries).toEqual([{ outcome: 'absent', ref: { kind: 'root', id: UNKNOWN_ID } }]);
    });

    it.each(TEST_ROOTS)('serves the KTD-16 test root $name with live variants, found by its synonym', async (root) => {
        const [id] = await idsNamed(root.synonym, root.name);

        expect(id, `"${root.synonym}" did not find "${root.name}": the curated seed is not applied`).toBeDefined();

        const food = await readFood(id!);
        const [variant] = food.variants ?? [];

        expect(variant, `"${root.name}" has no live variant`).toBeDefined();
        expect(variant!.parts.length, 'a variant names at least one part').toBeGreaterThan(0);

        const [entry] = await resolve([{ kind: 'variant', id: variant!.id }]);

        expect(entry).toMatchObject({
            outcome: 'found',
            ref: { kind: 'variant', id: variant!.id },
            name: root.name,
            variant: { rootId: id, parts: variant!.parts },
        });
    });
});
