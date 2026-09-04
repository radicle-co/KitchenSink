/**
 * Unit suite for the food-catalog RESEED (U12b) — plan
 * `docs/plans/2026-08-20-001-fix-ingredient-resolution-quality-plan.md` §U12, Sequencing step 5;
 * requirements R44–R47.
 *
 * Three properties are under test:
 *
 *  1. **The same destructive-operation guard U12a's clear carries** (R45). A reseed is less destructive
 *     than a clear, but it is still a BULK WRITE against shared data that mints fresh ULIDs, so the stage
 *     must be NAMED with no default, `--confirm` must equal the resolved stage, production refuses without
 *     `--allow-prod`, `--allow-prod` is REJECTED off production, and `--dry-run` writes nothing and needs
 *     no confirmation. Every refusal is asserted to have touched NOTHING — a guard that refuses after the
 *     write is not a guard.
 *  2. **The post-condition** (the reseed's own proof). A seed cannot be one transaction across ~8k foods,
 *     so unlike the clear this assertion runs AFTER the write and cannot roll it back — which is exactly
 *     why it must be exhaustive and must report EVERY violated check at once, not just the first.
 *  3. **⚠️ The alias check, which is the FNDDS consequence made mechanical.** The roster declares whether
 *     the enabled datasets carry curated aliases. Today it declares `false` (Foundation and SR Legacy
 *     publish none — U2 measured it), so the reseed leaves `food.aliases` NULL across the whole bulk
 *     catalog and the check stays quiet. The moment somebody flips FNDDS on, the check demands that
 *     aliases actually LAND — so enabling the dataset without teaching the bulk reader USDA's
 *     `food_attribute.csv` fails the reseed loudly instead of quietly seeding alias-less rows.
 */
import { describe, expect, it } from 'vitest';

import type { CanonicalCandidate } from '../../../sources/foodSourceAdapter.js';
import type { BulkSeedResult } from '../bulkSeed.service.js';
import { CATALOG_DATASETS, type CatalogDataset } from '../catalogDatasets.js';
import {
    PRODUCTION_STAGE,
    assertCatalogReseeded,
    decideReseed,
    parseReseedArgs,
    runCatalogReseed,
    type CatalogReseedDeps,
    type ReseedCliOptions,
    type ReseedObservation,
} from '../reseedCli.js';
import type { DatabaseTarget } from '../operatorIntent.js';
import { isCatalogReseedRefusedError, isCatalogReseedUnverifiedError } from '../reseedCli.errors.js';

/** A complete, valid options object; each test overrides only the field it is about. */
/** Where the fake inventory reports its connection landed — the descriptor the guard judges against. */
const RESEED_TARGET: DatabaseTarget = {
    host: '10.1.4.7',
    port: 5432,
    database: 'kitchensink_food',
    user: 'food_app',
};

function makeOptions(overrides: Partial<ReseedCliOptions> = {}): ReseedCliOptions {
    return {
        // PR #91 review: a writing run must name the database it actually opened.
        confirmTarget: 'kitchensink_food@10.1.4.7:5432',
        stage: 'sandbox',
        confirm: 'sandbox',
        allowProd: false,
        dryRun: false,
        dirs: ['/tmp/fdc/sr-legacy'],
        limit: undefined,
        datasets: CATALOG_DATASETS,
        ...overrides,
    };
}

/** A roster entry for the tests that need a roster other than the shipped one. */
function makeDataset(overrides: Partial<CatalogDataset> = {}): CatalogDataset {
    return {
        id: 'foundation',
        dataType: 'foundation_food',
        enabled: true,
        carriesAliases: false,
        why: 'test fixture',
        ...overrides,
    };
}

/** A candidate stub — the reseed command never inspects one, it only counts and forwards them. */
function makeCandidate(externalKey: string): CanonicalCandidate {
    return {
        source: 'usda',
        externalKey,
        name: `Food ${externalKey}`,
        kind: 'generic',
        brandOwner: null,
        brandName: null,
        description: `Food ${externalKey}`,
        barcode: null,
        aliases: [],
        nutrients: [],
        portions: [],
        itemVersion: `bulk:${externalKey}`,
    };
}

/** A complete post-run observation; each test overrides only the field it is about. */
function makeObservation(overrides: Partial<ReseedObservation> = {}): ReseedObservation {
    return {
        foodsBefore: 0,
        foodsAfter: 7793,
        failed: 0,
        foodsNotOriginBulk: 0,
        foodsWithAliases: 0,
        aliasesExpected: false,
        ...overrides,
    };
}

/** Recorded port invocations, in order — the evidence for "a refusal wrote nothing". */
interface Recorder {
    readonly calls: string[];
    readonly deps: CatalogReseedDeps;
}

/**
 * Build recording ports over a per-directory candidate map and a chosen after-state.
 *
 * @param setup - Candidates per directory, the seed tallies, and the inventory numbers.
 * @returns The recorder plus the deps to hand {@link runCatalogReseed}.
 */
function makeRecorder(
    setup: {
        readonly byDir?: Readonly<Record<string, readonly string[]>>;
        readonly seedResult?: Partial<BulkSeedResult>;
        readonly foodsBefore?: number;
        readonly foodsAfter?: number;
        readonly foodsNotOriginBulk?: number;
        readonly foodsWithAliases?: number;
    } = {},
): Recorder {
    const calls: string[] = [];
    const byDir = setup.byDir ?? { '/tmp/fdc/sr-legacy': ['170379', '747447'] };
    let seeded = false;

    return {
        calls,
        deps: {
            source: {
                readCandidates: (dir: string): AsyncIterable<CanonicalCandidate> => {
                    calls.push(`read:${dir}`);

                    return (async function* stream(): AsyncGenerator<CanonicalCandidate> {
                        for (const key of byDir[dir] ?? []) {
                            yield makeCandidate(key);
                        }
                    })();
                },
            },
            seeder: {
                seed: async (candidates: AsyncIterable<CanonicalCandidate>): Promise<BulkSeedResult> => {
                    let total = 0;

                    for await (const _candidate of candidates) {
                        total += 1;
                    }

                    calls.push(`seed:${total}`);
                    seeded = true;

                    return { total, seeded: total, refreshed: 0, unchanged: 0, failed: 0, ...setup.seedResult };
                },
            },
            inventory: {
                describeTarget: async (): Promise<DatabaseTarget> => RESEED_TARGET,
                countFoods: async (): Promise<number> => {
                    calls.push('countFoods');

                    return seeded ? (setup.foodsAfter ?? 2) : (setup.foodsBefore ?? 0);
                },
                countFoodsNotOriginBulk: async (): Promise<number> => {
                    calls.push('countFoodsNotOriginBulk');

                    return setup.foodsNotOriginBulk ?? 0;
                },
                countFoodsWithAliases: async (): Promise<number> => {
                    calls.push('countFoodsWithAliases');

                    return setup.foodsWithAliases ?? 0;
                },
            },
        },
    };
}

describe('parseReseedArgs', () => {
    it('requires a stage — there is deliberately no default for a bulk write', () => {
        expect(() => parseReseedArgs(['--dir', '/tmp/fdc'])).toThrow(/--stage/);
    });

    it('falls back to STAGE when --stage is absent', () => {
        process.env['STAGE'] = 'sandbox';

        try {
            expect(parseReseedArgs(['--dir', '/tmp/fdc']).stage).toBe('sandbox');
        } finally {
            delete process.env['STAGE'];
        }
    });

    it('rejects a blank stage rather than treating it as "unset but present"', () => {
        expect(() => parseReseedArgs(['--stage', '   ', '--dir', '/tmp/fdc'])).toThrow(/--stage/);
    });

    it('requires at least one --dir', () => {
        expect(() => parseReseedArgs(['--stage', 'sandbox'])).toThrow(/--dir/);
    });

    it('accepts --dir more than once — one dataset download per directory', () => {
        const options = parseReseedArgs(['--stage', 'sandbox', '--dir', '/a', '--dir', '/b']);

        expect(options.dirs).toEqual(['/a', '/b']);
    });

    it('falls back to USDA_BULK_DIR when no --dir is given', () => {
        process.env['USDA_BULK_DIR'] = '/tmp/from-env';

        try {
            expect(parseReseedArgs(['--stage', 'sandbox']).dirs).toEqual(['/tmp/from-env']);
        } finally {
            delete process.env['USDA_BULK_DIR'];
        }
    });

    it('rejects a --limit that is not a positive integer (a fat-fingered "1O" seeds nothing silently)', () => {
        expect(() => parseReseedArgs(['--stage', 'sandbox', '--dir', '/a', '--limit', '1O'])).toThrow(/--limit/);
        expect(() => parseReseedArgs(['--stage', 'sandbox', '--dir', '/a', '--limit', '0'])).toThrow(/--limit/);
        expect(() => parseReseedArgs(['--stage', 'sandbox', '--dir', '/a', '--limit', '-3'])).toThrow(/--limit/);
    });

    it('carries the shipped roster so a run is defined by configuration, not by a hardcoded filter', () => {
        expect(parseReseedArgs(['--stage', 'sandbox', '--dir', '/a']).datasets).toEqual(CATALOG_DATASETS);
    });

    it('defaults the flags off and leaves --confirm undefined', () => {
        const options = parseReseedArgs(['--stage', 'sandbox', '--dir', '/a']);

        expect(options).toMatchObject({ allowProd: false, dryRun: false, confirm: undefined, limit: undefined });
    });
});

describe('decideReseed', () => {
    it('reseeds when the stage is confirmed back exactly', () => {
        expect(decideReseed(makeOptions())).toEqual({ kind: 'reseed' });
    });

    it('refuses a write with no --confirm', () => {
        expect(decideReseed(makeOptions({ confirm: undefined }))).toEqual({
            kind: 'refused',
            reason: 'confirmation-missing',
        });
    });

    it('refuses when --confirm names a different stage', () => {
        expect(decideReseed(makeOptions({ confirm: 'prod' }))).toEqual({
            kind: 'refused',
            reason: 'confirmation-mismatch',
        });
    });

    it('refuses production without --allow-prod, even when confirmed', () => {
        expect(decideReseed(makeOptions({ stage: PRODUCTION_STAGE, confirm: PRODUCTION_STAGE }))).toEqual({
            kind: 'refused',
            reason: 'production-requires-flag',
        });
    });

    it('allows production with both the confirmation and the flag', () => {
        expect(
            decideReseed(makeOptions({ stage: PRODUCTION_STAGE, confirm: PRODUCTION_STAGE, allowProd: true })),
        ).toEqual({ kind: 'reseed' });
    });

    it('REJECTS --allow-prod off production rather than ignoring it, so it cannot become a habit', () => {
        expect(decideReseed(makeOptions({ allowProd: true }))).toEqual({
            kind: 'refused',
            reason: 'production-flag-off-production',
        });
    });

    it('rejects --allow-prod off production even on a dry run — the flag is wrong before it is harmless', () => {
        expect(decideReseed(makeOptions({ allowProd: true, dryRun: true }))).toEqual({
            kind: 'refused',
            reason: 'production-flag-off-production',
        });
    });

    it('reports on a dry run with no --confirm — refusing to let an operator LOOK is how they run the write', () => {
        expect(decideReseed(makeOptions({ dryRun: true, confirm: undefined }))).toEqual({ kind: 'report' });
    });

    it('refuses when the roster enables no dataset — a reseed that imports nothing is a misconfiguration', () => {
        expect(decideReseed(makeOptions({ datasets: [makeDataset({ enabled: false })] }))).toEqual({
            kind: 'refused',
            reason: 'no-dataset-enabled',
        });
    });

    it('refuses an empty roster on a DRY RUN too — the report would describe a run that cannot happen', () => {
        expect(decideReseed(makeOptions({ datasets: [], dryRun: true }))).toEqual({
            kind: 'refused',
            reason: 'no-dataset-enabled',
        });
    });
});

describe('assertCatalogReseeded', () => {
    it('passes a clean reseed of a previously empty catalog', () => {
        expect(() => assertCatalogReseeded(makeObservation())).not.toThrow();
    });

    it('fails when the catalog is still empty — a reseed that seeded nothing is not a no-op', () => {
        expect(() => assertCatalogReseeded(makeObservation({ foodsAfter: 0 }))).toThrow(/empty/i);
    });

    it('fails when any candidate failed — a partial import must not read as a completed reseed', () => {
        expect(() => assertCatalogReseeded(makeObservation({ failed: 3 }))).toThrow(/3/);
    });

    it('fails when a reseed from an EMPTY catalog left rows whose origin is not "bulk" (R47)', () => {
        expect(() => assertCatalogReseeded(makeObservation({ foodsNotOriginBulk: 5 }))).toThrow(/origin/i);
    });

    it('does NOT fail on non-bulk rows when the catalog was already populated (a top-up, not a reseed)', () => {
        expect(() => assertCatalogReseeded(makeObservation({ foodsBefore: 12, foodsNotOriginBulk: 12 }))).not.toThrow();
    });

    it('⚠️ fails when the roster promised aliases and none landed (the FNDDS guard rail)', () => {
        expect(() => assertCatalogReseeded(makeObservation({ aliasesExpected: true, foodsWithAliases: 0 }))).toThrow(
            /alias/i,
        );
    });

    it('passes when the roster promised aliases and they landed', () => {
        expect(() =>
            assertCatalogReseeded(makeObservation({ aliasesExpected: true, foodsWithAliases: 5432 })),
        ).not.toThrow();
    });

    it('⚠️ stays quiet about a wholly NULL alias column when the roster promised nothing — TODAY’s state', () => {
        expect(() =>
            assertCatalogReseeded(makeObservation({ aliasesExpected: false, foodsWithAliases: 0 })),
        ).not.toThrow();
    });

    it('reports EVERY violated check at once, because it cannot roll the write back', () => {
        let thrown: unknown;

        try {
            assertCatalogReseeded(makeObservation({ foodsAfter: 0, failed: 2, aliasesExpected: true }));
        } catch (error: unknown) {
            thrown = error;
        }

        expect(isCatalogReseedUnverifiedError(thrown)).toBe(true);
        expect(isCatalogReseedUnverifiedError(thrown) ? thrown.failures : []).toHaveLength(3);
    });
});

describe('runCatalogReseed', () => {
    it('refuses BEFORE touching a port — a guard that refuses after the write is not a guard', async () => {
        const recorder = makeRecorder();

        await expect(runCatalogReseed(recorder.deps, makeOptions({ confirm: undefined }))).rejects.toSatisfy(
            isCatalogReseedRefusedError,
        );
        expect(recorder.calls).toEqual([]);
    });

    it('seeds every configured directory, in order, and reports the merged tallies', async () => {
        const recorder = makeRecorder({
            byDir: { '/a': ['1', '2'], '/b': ['3'] },
            foodsAfter: 3,
        });

        const result = await runCatalogReseed(recorder.deps, makeOptions({ dirs: ['/a', '/b'] }));

        expect(recorder.calls.filter((call) => call.startsWith('read:'))).toEqual(['read:/a', 'read:/b']);
        expect(result).toMatchObject({
            outcome: 'reseeded',
            stage: 'sandbox',
            candidates: 3,
            seeded: 3,
            failed: 0,
            foodsAfter: 3,
            dataTypes: ['foundation_food', 'sr_legacy_food'],
        });
    });

    it('counts the catalog BEFORE the first seed, so the origin check knows it started clean', async () => {
        const recorder = makeRecorder({ foodsBefore: 0, foodsAfter: 2 });

        const result = await runCatalogReseed(recorder.deps, makeOptions());

        expect(recorder.calls.indexOf('countFoods')).toBeLessThan(recorder.calls.indexOf('seed:2'));
        expect(result.foodsBefore).toBe(0);
    });

    it('surfaces a failed candidate as an unverified reseed rather than a completed one', async () => {
        const recorder = makeRecorder({ seedResult: { failed: 1 }, foodsAfter: 2 });

        await expect(runCatalogReseed(recorder.deps, makeOptions())).rejects.toSatisfy(isCatalogReseedUnverifiedError);
    });

    it('surfaces an empty catalog after the run — the "--dir pointed at the wrong extraction" case', async () => {
        const recorder = makeRecorder({ byDir: { '/tmp/fdc/sr-legacy': [] }, foodsAfter: 0 });

        await expect(runCatalogReseed(recorder.deps, makeOptions())).rejects.toSatisfy(isCatalogReseedUnverifiedError);
    });

    describe('--dry-run', () => {
        it('reads and counts candidates but NEVER calls the seeder', async () => {
            const recorder = makeRecorder({ byDir: { '/a': ['1', '2', '3'] } });

            const result = await runCatalogReseed(recorder.deps, makeOptions({ dirs: ['/a'], dryRun: true }));

            expect(recorder.calls.some((call) => call.startsWith('seed:'))).toBe(false);
            expect(result).toMatchObject({ outcome: 'reported', candidates: 3, seeded: 0, wouldProceed: true });
        });

        it('reports wouldProceed=false when the configured directories yield no candidate at all', async () => {
            const recorder = makeRecorder({ byDir: { '/a': [] } });

            const result = await runCatalogReseed(recorder.deps, makeOptions({ dirs: ['/a'], dryRun: true }));

            expect(result.wouldProceed).toBe(false);
        });

        it('leaves the catalog counts untouched in the report (foodsAfter === foodsBefore)', async () => {
            const recorder = makeRecorder({ foodsBefore: 41 });

            const result = await runCatalogReseed(recorder.deps, makeOptions({ dryRun: true }));

            expect(result.foodsAfter).toBe(41);
            expect(result.foodsBefore).toBe(41);
        });

        it('does NOT run the post-condition — a dry run has nothing to verify', async () => {
            const recorder = makeRecorder({ byDir: { '/a': [] }, foodsBefore: 0 });

            await expect(
                runCatalogReseed(recorder.deps, makeOptions({ dirs: ['/a'], dryRun: true })),
            ).resolves.toMatchObject({ outcome: 'reported' });
        });
    });
});
