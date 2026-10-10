/**
 * The committed curated seed through the whole apply, with the database mocked (curated catalog plan U6, KTD-1, KTD-2;
 * the integration tier mocks the database, owner ruling 2026-09-20).
 *
 * The real committed files go through the real Facade, image, projection, planner, write set, Unit of Work and
 * Transaction Script; only the connection is a recording fake. What it proves is the statement ORDER over the full seed
 * (the lock first and its release last, every write inside one READ COMMITTED transaction, the ledger row last before
 * COMMIT, the three timeouts in every transaction) and that every staged table carries exactly the rows the projection
 * holds. That 0018's keys and triggers accept the order is the LOCAL e2e tier's (`tests/e2e/catalogSeedApply.e2e.test.ts`).
 *
 * Counts are DERIVED from the projection, never written here, because the curated files are regenerated.
 */
import { fileURLToPath } from 'node:url';

import { beforeAll, describe, expect, it } from 'vitest';

import {
    makeRecordingSeedSession,
    type RecordingSeedSession,
} from '../src/foods/seed/catalog/__fixtures__/recordingSeedSession.js';
import { EMPTY_SNAPSHOT, type CatalogSnapshot } from '../src/foods/seed/catalog/catalogSnapshot.js';
import {
    SEED_IDLE_IN_TRANSACTION_TIMEOUT_MS,
    SEED_LOCK_TIMEOUT_MS,
    SEED_STATEMENT_TIMEOUT_MS,
    applyCatalogSeed,
    type CatalogSeedResult,
} from '../src/foods/seed/catalog/catalogSeedTransaction.js';
import type { CatalogChanges } from '../src/foods/seed/catalog/curatedSeedFormat.js';
import { composeSeedImage } from '../src/foods/seed/catalog/seedImage.js';
import { projectSeed } from '../src/foods/seed/catalog/seedProjection.js';
import { loadSeedSources } from '../src/foods/seed/catalog/seedSources.js';

const DATA_DIR = fileURLToPath(new URL('../src/foods/seed/data/', import.meta.url));
const SEED_SHA = 'c'.repeat(64);
const OLDER_SHA = 'd'.repeat(64);

const SETTINGS = [
    `SET LOCAL statement_timeout = ${String(SEED_STATEMENT_TIMEOUT_MS)}`,
    `SET LOCAL lock_timeout = ${String(SEED_LOCK_TIMEOUT_MS)}`,
    `SET LOCAL idle_in_transaction_session_timeout = ${String(SEED_IDLE_IN_TRANSACTION_TIMEOUT_MS)}`,
    'SET LOCAL search_path = pg_catalog, public, pg_temp',
];
const READ_WRITE = 'BEGIN ISOLATION LEVEL READ COMMITTED';
const UNLOCK = 'SELECT pg_advisory_unlock($1, $2)';

let projected: CatalogSnapshot;
let changes: CatalogChanges;

beforeAll(async () => {
    const inputs = await loadSeedSources(DATA_DIR);

    projected = projectSeed(composeSeedImage(inputs));
    changes = inputs.curated.changes;
}, 120_000);

/**
 * Apply the committed seed over a recording session.
 *
 * @param session - The session.
 * @param held - What the stand-in snapshot reads.
 * @param check - The stand-in verifier's check.
 * @returns The result.
 */
async function apply(
    session: RecordingSeedSession,
    held: CatalogSnapshot,
    check: () => Promise<void> = async () => undefined,
): Promise<CatalogSeedResult> {
    return applyCatalogSeed({
        session,
        snapshot: { read: async () => held },
        verify: { prepare: async () => undefined, check },
        target: projected.content,
        changes,
        seedSha: SEED_SHA,
        log: () => undefined,
    });
}

describe('the committed seed on an empty catalog, with the database mocked', () => {
    let session: RecordingSeedSession;
    let result: CatalogSeedResult;

    beforeAll(async () => {
        session = makeRecordingSeedSession({ ledgerHead: null });
        result = await apply(session, EMPTY_SNAPSHOT);
    }, 120_000);

    it('takes the lock first and releases it last, with every write inside one READ COMMITTED transaction', () => {
        const { steps } = session;
        const begin = steps.indexOf(READ_WRITE);

        expect(result.outcome).toBe('applied');
        expect(steps[1]).toBe('SELECT pg_advisory_lock($1, $2)');
        expect(steps.at(-1)).toBe(UNLOCK);
        expect(steps.slice(begin, begin + 5)).toEqual([READ_WRITE, ...SETTINGS]);
        expect(steps.slice(-3)).toEqual(['ledgerInsert', 'COMMIT', UNLOCK]);
        expect(steps.slice(0, begin).some((step) => step.endsWith('Insert'))).toBe(false);
    });

    it('sets the three timeouts and the search path in every transaction it opens', () => {
        const begins = session.steps.flatMap((step, index) => (step.startsWith('BEGIN') ? [index] : []));

        expect(begins).toHaveLength(2);

        for (const begin of begins) {
            expect(session.steps.slice(begin + 1, begin + 5)).toEqual(SETTINGS);
        }
    });

    it('stages exactly the rows the projection holds, table by table', () => {
        const { content } = projected;
        const items = [...content.items.values()];
        const owners = [
            ...[...content.roots.values()].flatMap((root) => (root.nutrition === null ? [] : [root.nutrition])),
            ...[...content.variants.values()].map((variant) => variant.nutrition),
        ];
        const portions = items.flatMap((item) => item.portions);

        expect({
            item: session.stagedRows('item').length,
            root: session.stagedRows('root').length,
            variant: session.stagedRows('variant').length,
            source: session.stagedRows('source').length,
            header: session.stagedRows('header').length,
            citation: session.stagedRows('citation').length,
            value: session.stagedRows('value').length,
            sourcePortion: session.stagedRows('source_portion').length,
            citedPortion: session.stagedRows('cited_portion').length,
            category: session.stagedRows('category_assignment').length,
            part: session.stagedRows('part').length,
        }).toEqual({
            item: content.items.size,
            root: content.roots.size,
            variant: content.variants.size,
            source: items.reduce((sum, item) => sum + item.sources.length, 0),
            header: owners.length,
            citation: owners.length,
            value: owners.reduce((sum, nutrition) => sum + nutrition.values.length, 0),
            sourcePortion: portions.filter((portion) => !('citation' in portion)).length,
            citedPortion: portions.filter((portion) => 'citation' in portion).length,
            category: items.reduce((sum, item) => sum + item.categories.length, 0),
            part: [...content.variants.values()].reduce((sum, variant) => sum + variant.parts.length, 0),
        });
        expect(session.stagedRows('value').length).toBeGreaterThan(100_000);
    });

    it('stages one dictionary entry per distinct nutrient and category the rows name', () => {
        const values = session.stagedRows('value').map((line) => line.split('\t').slice(2, 4).join('\t'));
        const categories = session.stagedRows('category_assignment').map((line) => line.split('\t')[1]);

        expect(
            session
                .stagedRows('nutrient')
                .map((line) => line.split('\t').slice(1, 3).join('\t'))
                .sort(),
        ).toEqual([...new Set(values)].sort());
        expect(
            session
                .stagedRows('category')
                .map((line) => line.split('\t')[1])
                .sort(),
        ).toEqual([...new Set(categories)].sort());
    });
});

describe('the committed seed over a catalog that already holds it, with the database mocked', () => {
    it('runs the verifier alone, read-only, when the ledger holds this digest (R36, AE5)', async () => {
        const session = makeRecordingSeedSession({ ledgerHead: SEED_SHA });
        let checked = 0;

        const result = await apply(session, projected, async () => {
            checked += 1;
        });

        expect(result.outcome).toBe('unchanged');
        expect(checked).toBe(1);
        expect(session.steps.filter((step) => step.startsWith('BEGIN'))).toEqual([
            'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY',
        ]);
        expect(session.steps).not.toContain('ledgerInsert');
    }, 120_000);

    it('records an older ledger’s new digest without writing a catalog row, once the verifier passes', async () => {
        const session = makeRecordingSeedSession({ ledgerHead: OLDER_SHA });

        const result = await apply(session, projected);
        const begin = session.steps.indexOf(READ_WRITE);

        expect(result.outcome).toBe('applied');
        expect(session.steps.slice(begin)).toEqual([READ_WRITE, ...SETTINGS, 'ledgerInsert', 'COMMIT', UNLOCK]);
    }, 120_000);
});

describe('a failure after the writes, with the database mocked', () => {
    it('rolls back without the digest when the verifier fails, and releases the lock in its own finally', async () => {
        const session = makeRecordingSeedSession({ ledgerHead: OLDER_SHA });
        const collapse = new Error('variant fdc:171077 is missing');

        await expect(
            apply(session, EMPTY_SNAPSHOT, async () => {
                throw collapse;
            }),
        ).rejects.toBe(collapse);
        expect(session.steps).not.toContain('ledgerInsert');
        expect(session.steps).toContain('valueInsert');
        expect(session.steps.slice(-2)).toEqual(['ROLLBACK', UNLOCK]);
    }, 120_000);

    it('releases the lock when the COMMIT the deferred triggers refuse rejects', async () => {
        const refused = new Error('the seeder released usda 171077 and no seed-owned row holds it');
        let commits = 0;
        const session = makeRecordingSeedSession({
            ledgerHead: OLDER_SHA,
            failures: [
                {
                    // The first COMMIT ends the read-only transaction; the second is the write's.
                    when: (statement) => statement.sql === 'COMMIT' && (commits += 1) === 2,
                    error: refused,
                },
            ],
        });

        await expect(apply(session, EMPTY_SNAPSHOT)).rejects.toBe(refused);
        expect(session.steps.slice(-3)).toEqual(['COMMIT', 'ROLLBACK', UNLOCK]);
    }, 120_000);
});
