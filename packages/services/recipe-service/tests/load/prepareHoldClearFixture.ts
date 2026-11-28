/**
 * Build the world `holdClear.load.js` runs against: a signed staff token and a pool of recipes that are HELD by a mistaken
 * source correction (ADR-0106), each with the correction id the staff preview shows.
 *
 * WHY a prepare step: the route needs a Clerk session token whose signed `public_metadata.scopes` carries
 * `recipes:source:correct`, and k6's goja runtime cannot sign RS256. So this step generates a throwaway keypair with the
 * suite's own `tests/support/jwt.ts`, mints the staff token and one owner token per recipe, and builds each held recipe over
 * the service's real HTTP API: create it as "I wrote this", correct it to a web page, correct it back (that is what sets
 * `source_correction_hold`), then read the preview for `latestCorrectionId`. k6 loads the pool with `open()`.
 *
 * It writes three files next to this script (all gitignored):
 *   - `holdClearPublicKey.pem` and `holdClearPrivateKey.pem` — the throwaway pair, generated on the FIRST run (which then
 *     stops, because the service must trust the public key as `CLERK_JWT_KEY` before it can accept a recipe).
 *   - `holdClearPool.json` — `{ staffToken, clear: Entry[], stale: Entry[] }`. A `clear` entry is cleared exactly once by the
 *     run; a `stale` entry is never cleared (a wrong correction id is refused and writes nothing), so it can be hit repeatedly.
 *
 * The service MUST be booted trusting the key and the azp:
 *   CLERK_JWT_KEY="$(cat tests/load/holdClearPublicKey.pem)" CLERK_AUTHORIZED_PARTIES=http://localhost:3000
 * and with `RATE_LIMIT_WRITE` raised (every clear shares one staff identity); see `README.md`. Tokens live
 * `HOLD_CLEAR_TOKEN_TTL_SECONDS` (default 1800), so re-run this step when the pool is older than that.
 *
 * Usage (from packages/services/recipe-service):
 *   RECIPE_API_BASE_URL=http://localhost:3000 npx tsx tests/load/prepareHoldClearFixture.ts
 *
 * @sideEffect Writes held recipes to the service under test, draws from the CSPRNG and writes files next to this script.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

import { sourceCorrectionPreviewSchema, SOURCE_CORRECT_SCOPE } from '../../src/recipes/recipes.schema.js';
import { generateClerkKeypair, mintToken } from '../support/jwt.js';

const outDir = dirname(fileURLToPath(import.meta.url));
const BASE_URL = (process.env['RECIPE_API_BASE_URL'] ?? 'http://localhost:3000').replace(/\/+$/u, '');
const AZP = process.env['HOLD_CLEAR_AZP'] ?? 'http://localhost:3000';
const CLEAR_COUNT = Math.max(1, Number(process.env['HOLD_CLEAR_POOL_SIZE'] ?? 500));
const STALE_COUNT = Math.max(1, Number(process.env['HOLD_CLEAR_STALE_POOL_SIZE'] ?? 20));
const TTL_SECONDS = Number(process.env['HOLD_CLEAR_TOKEN_TTL_SECONDS'] ?? 1800);
const MAX_THROTTLE_WAITS = 20;

const idResponse = z.object({ id: z.string() });
const RECIPE_LINK = 'https://example.com/hold-clear-load';

/** A 26-character, ULID-shaped owner id that no real account has. Pure. */
const ownerId = (index: number): string => `01JLOADHOLDCLR${String(index).padStart(12, '0')}`;

const publicKeyFile = join(outDir, 'holdClearPublicKey.pem');
const privateKeyFile = join(outDir, 'holdClearPrivateKey.pem');

// The service must trust the key BEFORE any recipe can be created, so the first run only writes the pair and stops;
// later runs reuse it. Delete both files to rotate.
if (!existsSync(privateKeyFile) || !existsSync(publicKeyFile)) {
    const generated = generateClerkKeypair();

    writeFileSync(publicKeyFile, generated.publicKeyPem, 'utf-8');
    writeFileSync(privateKeyFile, generated.privateKeyPem, { encoding: 'utf-8', mode: 0o600 });
    console.log(
        `prepareHoldClearFixture: wrote a new keypair to ${outDir}. Boot the service with ` +
            'CLERK_JWT_KEY="$(cat tests/load/holdClearPublicKey.pem)" and re-run this step to build the pool.',
    );
    process.exit(0);
}

const privateKeyPem = readFileSync(privateKeyFile, 'utf-8');
const bearerFor = (userId: string, extra: { scopes?: string[]; roles?: string[] }): string =>
    mintToken(privateKeyPem, {
        sub: `load:${userId}`,
        azp: AZP,
        externalId: userId,
        expiresInSeconds: TTL_SECONDS,
        ...extra,
    });
const staffToken = bearerFor('01JLOADHOLDCLRSTAFF000001', { scopes: [SOURCE_CORRECT_SCOPE] });

/** One JSON call; waits out a 429 (the per-user write limit) and throws on any other non-2xx so a half-built pool never ships. */
async function call(method: string, path: string, bearer: string, body?: unknown): Promise<unknown> {
    for (let attempt = 0; attempt <= MAX_THROTTLE_WAITS; attempt += 1) {
        const res = await fetch(`${BASE_URL}${path}`, {
            method,
            headers: { 'content-type': 'application/json', authorization: `Bearer ${bearer}` },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });

        if (res.status === 429) {
            await sleep(Math.max(1, Number(res.headers.get('retry-after') ?? 1)) * 1000);
            continue;
        }

        const text = await res.text();

        if (!res.ok) {
            throw new Error(`${method} ${path} -> ${res.status} ${text}`);
        }

        return text === '' ? {} : JSON.parse(text);
    }

    throw new Error(`${method} ${path} stayed throttled after ${MAX_THROTTLE_WAITS} waits; raise RATE_LIMIT_WRITE`);
}

const correction = (owner: string, answer: unknown): unknown => ({
    ownerAccountId: owner,
    answer,
    ground: 'ownerConfirmedByAccountEmail',
    reason: 'k6 hold-clear load fixture.',
});

/** Create one held recipe for `index` and return its pool entry. */
async function heldRecipe(index: number, flourId: string): Promise<Record<string, string>> {
    const owner = ownerId(index);
    const ownerBearer = bearerFor(owner, { roles: ['premium'] });
    const { id } = idResponse.parse(
        await call('POST', '/api/v1/recipes', ownerBearer, {
            title: `Hold Clear Load ${index}`,
            visibility: 'private',
            statement: { kind: 'authored', wording: { version: 'statementAuthored.v1', locale: 'en' } },
            ingredients: [{ ingredientId: flourId, quantity: { kind: 'exact', value: 2 }, unit: 'cup' }],
            steps: [{ instruction: 'Mix.' }],
            servings: 2,
            prepTimeMinutes: 5,
            cookTimeMinutes: 20,
            totalTimeMinutes: 25,
            cuisine: 'Italian',
        }),
    );
    const path = `/api/v1/recipes/${id}/source-correction`;

    await call('POST', path, staffToken, correction(owner, { kind: 'public_web', citation: RECIPE_LINK }));
    await call('POST', path, staffToken, correction(owner, { kind: 'authored' }));

    const preview = sourceCorrectionPreviewSchema.parse(
        await call('GET', `${path}?ownerAccountId=${encodeURIComponent(owner)}`, staffToken),
    );

    if (preview.latestCorrectionId === null) {
        throw new Error(`recipe ${id} shows no correction after two corrections`);
    }

    return { recipeId: id, ownerAccountId: owner, correctionId: preview.latestCorrectionId };
}

const { id: flourId } = idResponse.parse(
    await call('POST', '/api/v1/ingredients', bearerFor(ownerId(0), { roles: ['premium'] }), { name: 'flour' }),
);
const clear: Record<string, string>[] = [];
const stale: Record<string, string>[] = [];

for (let i = 0; i < CLEAR_COUNT + STALE_COUNT; i += 1) {
    (i < CLEAR_COUNT ? clear : stale).push(await heldRecipe(i, flourId));
}

writeFileSync(join(outDir, 'holdClearPool.json'), JSON.stringify({ staffToken, clear, stale }, null, 2), 'utf-8');

console.log(
    `prepareHoldClearFixture: wrote ${clear.length} clear + ${stale.length} stale held recipes (token ttl ${TTL_SECONDS}s) ` +
        `and holdClearPublicKey.pem to ${outDir}`,
);
