/**
 * `applyCatalogPlan` (curated catalog plan U6, KTD-1, KTD-8, KTD-12): the Unit of Work that stages a write set and runs
 * it, set-based, in the one order 0018's keys and triggers admit.
 *
 * A recording session proves ORDER and COUNT, which are what this module owns: each statement carries a
 * `catalogSeed:<step>` marker, so a case asserts the step sequence rather than SQL text. The fake answers each
 * statement's row count with what the apply staged or listed for it, and a case that wants a short count says so.
 * That 0018's triggers and keys accept this order is asserted against a real database in
 * `tests/e2e/catalogSeedApply.e2e.test.ts`.
 */
import { describe, expect, it } from 'vitest';

import {
    makeContent,
    makeContentItem,
    makeContentRoot,
    makeContentVariant,
    makeNutrition,
    makeSnapshot,
} from '../__fixtures__/catalogContent.fixtures.js';
import { makeCatalogChanges } from '../__fixtures__/curatedSeed.fixtures.js';
import { makeRecordingSeedSession, type RecordingSeedSession } from '../__fixtures__/recordingSeedSession.js';
import { applyCatalogPlan } from '../catalogPlanApplier.js';
import { isCatalogApplyError } from '../catalogPlanApplier.errors.js';
import { buildCatalogPlan, type CatalogPlan } from '../catalogPlanBuilder.js';
import { EMPTY_SNAPSHOT, type CatalogContent, type CatalogSnapshot } from '../catalogSnapshot.js';
import { SEEDED_ROOT_COLUMNS, SEEDED_SOURCE_COLUMNS } from '../catalogWriteSet.js';

const NO_CHANGES = makeCatalogChanges({ merges: [], aliases: [], exclusions: [], splits: [] });

const BRISKET = makeContentRoot();
const FLAT = makeContentVariant();
const CHICKEN = makeContentRoot({
    seedKey: 'fdc:200',
    name: 'chicken breast',
    item: 'fdc:200',
    nutrition: makeNutrition('fdc:200'),
});
const BRISKET_ITEM = makeContentItem('fdc:100', {
    portions: [{ label: 'oz', gramWeight: '28.35', source: { source: 'usda', externalKey: '100' } }],
    categories: [{ name: 'Beef Products', source: { source: 'usda', externalKey: '100' } }],
});

/** What a step's statement reports as its row count, given what the apply asked of it. */
type CountOf = (step: string, asked: number) => number;

/**
 * A session whose steps report the row counts a case gives them.
 *
 * @param countOf - Each step's count; by default what it was asked to touch.
 * @returns The session.
 */
function recording(countOf?: CountOf): RecordingSeedSession {
    return makeRecordingSeedSession(countOf === undefined ? {} : { countOf });
}

/**
 * Plan a target against a snapshot.
 *
 * @param target - The seed's content.
 * @param snapshot - The catalog.
 * @returns The plan.
 */
function plan(target: CatalogContent, snapshot: CatalogSnapshot): CatalogPlan {
    return buildCatalogPlan(target, snapshot, NO_CHANGES);
}

/**
 * A minter that names each id `new-<n>`.
 *
 * @returns The minter.
 */
function counter(): () => string {
    let next = 0;

    return () => {
        next += 1;

        return `new-${String(next)}`;
    };
}

/** The steps of a table's staging: create the temp table, then COPY into it. */
const staged = (table: string): string[] => [`stage:${table}`, `copy:${table}`];

describe('applyCatalogPlan — the write order', () => {
    it('writes nothing for an empty plan', async () => {
        const session = recording();
        const empty = plan(makeContent([BRISKET]), makeSnapshot(makeContent([BRISKET])));

        await applyCatalogPlan(session, empty, makeSnapshot(makeContent([BRISKET])).ids, counter());

        expect(session.ran).toEqual([]);
    });

    it('writes an empty catalog’s seed parents first, then children, then nothing to delete', async () => {
        const session = recording();
        const target = makeContent([BRISKET], [FLAT], [BRISKET_ITEM]);

        await applyCatalogPlan(session, plan(target, EMPTY_SNAPSHOT), EMPTY_SNAPSHOT.ids, counter());

        expect(session.steps).toEqual([
            ...staged('nutrient'),
            'nutrientInsert',
            ...staged('category'),
            'categoryInsert',
            ...staged('item'),
            'itemInsert',
            ...staged('root'),
            'rootInsert',
            ...staged('variant'),
            'variantInsert',
            'childPortionDelete',
            'childProvenanceDelete',
            'childCategoryDelete',
            'childSourceDelete',
            'nutritionDelete',
            'partDelete',
            ...staged('source'),
            'sourceInsert',
            ...staged('header'),
            'headerInsert',
            ...staged('citation'),
            'citationInsert',
            ...staged('value'),
            'valueInsert',
            ...staged('source_portion'),
            'sourcePortionInsert',
            ...staged('category_assignment'),
            'categoryAssignmentInsert',
            ...staged('part'),
            'partInsert',
        ]);
    });

    it('frees every name and key before it writes the seed’s own rows, and forwards last', async () => {
        const session = recording((step, asked) => (step === 'itemReownAfter' ? 0 : asked));
        const absorbed = makeContentVariant({ item: 'fdc:200', nutrition: makeNutrition('fdc:200') });
        const snapshot = makeSnapshot(makeContent([BRISKET, CHICKEN], [FLAT]), {
            liveNames: new Map([['beef brisket, whole', 'live-1']]),
            liveSourceHolders: new Map([['usda\u0000300', { foodId: 'live-2', authored: false, retired: false }]]),
        });
        const target = makeContent(
            [
                { ...BRISKET, name: 'beef brisket, whole' },
                makeContentRoot({ seedKey: 'fdc:300', name: 'veal', item: 'fdc:300', nutrition: null }),
            ],
            [absorbed],
        );

        await applyCatalogPlan(session, plan(target, snapshot), snapshot.ids, counter());

        const steps = session.steps.filter((step) => !step.startsWith('stage:') && !step.startsWith('copy:'));

        expect(steps).toEqual([
            'nutrientInsert',
            'claimRetire',
            'releaseProvenanceDelete',
            'releaseCategoryDelete',
            'releasePortionDelete',
            'releaseSourceDelete',
            'rootDelete',
            'itemInsert',
            'itemReownBefore',
            'variantRetire',
            'rootTempName',
            'rootUpdate',
            'itemReownAfter',
            'rootInsert',
            'variantInsert',
            'childPortionDelete',
            'childProvenanceDelete',
            'childCategoryDelete',
            'childSourceDelete',
            'nutritionDelete',
            'partDelete',
            'sourceInsert',
            'headerInsert',
            'citationInsert',
            'valueInsert',
            'partInsert',
            'forwardInsert',
        ]);
    });

    it('deletes the forwards it restores before it inserts the rows that reuse their ids', async () => {
        const session = recording();
        const snapshot = makeSnapshot(makeContent([BRISKET]), {
            forwards: [
                {
                    sourceId: 'chicken-root',
                    sourceKind: 'root',
                    sourceKey: 'fdc:200',
                    target: { kind: 'root', id: 'id:fdc:100' },
                },
            ],
        });

        await applyCatalogPlan(session, plan(makeContent([BRISKET, CHICKEN]), snapshot), snapshot.ids, counter());

        expect(session.steps.indexOf('forwardDelete')).toBeGreaterThanOrEqual(0);
        expect(session.steps.indexOf('forwardDelete')).toBeLessThan(session.steps.indexOf('rootInsert'));
        expect(session.ran.find((statement) => statement.step === 'forwardDelete')?.values).toEqual([['chicken-root']]);
    });

    it('retires a root before it renames another onto the name the first one held', async () => {
        const session = recording();
        const snapshot = makeSnapshot(makeContent([BRISKET, CHICKEN], [FLAT]));

        // Brisket and its variant retire; chicken takes brisket's old name.
        await applyCatalogPlan(
            session,
            plan(makeContent([{ ...CHICKEN, name: 'beef brisket' }]), snapshot),
            snapshot.ids,
            counter(),
        );

        const at = (step: string): number => session.steps.indexOf(step);

        expect(at('rootRetire')).toBeGreaterThanOrEqual(0);
        expect(at('rootRetire')).toBeLessThan(at('rootTempName'));
        expect(at('rootTempName')).toBeLessThan(at('rootUpdate'));
    });

    it('deletes an item only after the root that owned it has moved to another item', async () => {
        const session = recording();
        const saffron = makeContentRoot({
            seedKey: 'curated:saffron',
            name: 'saffron',
            item: 'curated:saffron',
            nutrition: null,
        });
        const snapshot = makeSnapshot(makeContent([saffron, CHICKEN]));

        // Saffron gains chicken's USDA item; chicken is displaced and its old sourceless item is left with no owner.
        await applyCatalogPlan(
            session,
            plan(makeContent([{ ...saffron, item: 'fdc:200', nutrition: makeNutrition('fdc:200') }]), snapshot),
            snapshot.ids,
            counter(),
        );

        const at = (step: string): number => session.steps.indexOf(step);

        expect(at('rootDelete')).toBeLessThan(at('rootUpdate'));
        expect(at('rootUpdate')).toBeLessThan(at('itemDelete'));
        expect(session.ran.find((statement) => statement.step === 'itemDelete')?.values).toEqual([
            ['id:curated:saffron'],
        ]);
    });
});

describe('applyCatalogPlan — what each statement writes', () => {
    it('stages every value of every staged table in the COPY text format', async () => {
        const session = recording();
        const target = makeContent(
            [
                {
                    ...BRISKET,
                    synonyms: ['brisket', 'tab\there'],
                    nutrition: {
                        ...makeNutrition('fdc:100'),
                        values: [{ name: 'Fiber, total dietary', unit: 'g', amount: null }],
                    },
                },
            ],
            [],
            [BRISKET_ITEM],
        );

        await applyCatalogPlan(session, plan(target, EMPTY_SNAPSHOT), EMPTY_SNAPSHOT.ids, counter());

        expect(session.copied.get('root')).toBe(
            'new-2\tfdc:100\tnew-1\tbeef brisket\tbeef brisket\tbrisket; tab\\there\n',
        );
        expect(session.copied.get('value')).toBe('new-5\tnew-6\tFiber, total dietary\tg\t\\N\tt\n');
        expect(session.copied.get('source')).toBe('new-3\tnew-1\tusda\t100\t\\N\n');
    });

    it('writes every seeded root and source row with the columns the seed does not state', async () => {
        const session = recording();

        await applyCatalogPlan(session, plan(makeContent([BRISKET]), EMPTY_SNAPSHOT), EMPTY_SNAPSHOT.ids, counter());

        expect(session.ran.find((statement) => statement.step === 'rootInsert')?.values).toEqual([
            SEEDED_ROOT_COLUMNS.status,
            SEEDED_ROOT_COLUMNS.kind,
            SEEDED_ROOT_COLUMNS.visibility,
        ]);
        expect(session.ran.find((statement) => statement.step === 'sourceInsert')?.values).toEqual([
            SEEDED_SOURCE_COLUMNS.fetchState,
            SEEDED_SOURCE_COLUMNS.itemVersion,
        ]);
    });

    it('qualifies every relation it names, so a temp table of the same name can never take a read or a write', async () => {
        const session = recording((step, asked) => (step === 'itemReownAfter' ? 0 : asked));
        const absorbed = makeContentVariant({ item: 'fdc:200', nutrition: makeNutrition('fdc:200') });
        const snapshot = makeSnapshot(makeContent([BRISKET, CHICKEN], [FLAT]));

        await applyCatalogPlan(
            session,
            plan(makeContent([BRISKET], [absorbed, FLAT]), snapshot),
            snapshot.ids,
            counter(),
        );

        for (const { sql } of session.ran) {
            const relations = [
                ...sql.matchAll(/\b(?:FROM|JOIN|INTO|UPDATE|USING|TABLE)\s+(?!unnest\b|STDIN\b)([a-z_."]+)/giu),
            ].map((match) => match[1] ?? '');

            expect(relations.filter((relation) => !/^(?:public|pg_temp)\./u.test(relation))).toEqual([]);
        }
    });
});

describe('applyCatalogPlan — a statement that writes a different count than staged', () => {
    it('refuses, naming the step, and runs nothing after it', async () => {
        const session = recording((step, asked) => (step === 'valueInsert' ? asked - 1 : asked));

        const outcome = applyCatalogPlan(
            session,
            plan(makeContent([BRISKET], [], [BRISKET_ITEM]), EMPTY_SNAPSHOT),
            EMPTY_SNAPSHOT.ids,
            counter(),
        );

        await expect(outcome).rejects.toSatisfy(
            (error: unknown) =>
                isCatalogApplyError(error) && error.rule === 'rowCountMismatch' && error.where === 'valueInsert',
        );
        expect(session.steps.at(-1)).toBe('valueInsert');
    });

    it('refuses a claim whose food is no longer live and unauthored', async () => {
        const session = recording((step, asked) => (step === 'claimRetire' ? 0 : asked));
        const snapshot = makeSnapshot(makeContent([]), { liveNames: new Map([['beef brisket', 'live-1']]) });

        await expect(
            applyCatalogPlan(session, plan(makeContent([BRISKET]), snapshot), snapshot.ids, counter()),
        ).rejects.toSatisfy((error: unknown) => isCatalogApplyError(error) && error.where === 'claimRetire');
    });

    it('refuses owner kinds that the two passes did not flip exactly once each', async () => {
        const absorbed = makeContentVariant({ item: 'fdc:200', nutrition: makeNutrition('fdc:200') });
        const snapshot = makeSnapshot(makeContent([BRISKET, CHICKEN]));
        const target = makeContent([BRISKET], [absorbed]);

        for (const countOf of [
            (step: string, asked: number) => (step.startsWith('itemReown') ? 0 : asked),
            (_step: string, asked: number) => asked,
        ] satisfies CountOf[]) {
            const session = recording(countOf);

            await expect(applyCatalogPlan(session, plan(target, snapshot), snapshot.ids, counter())).rejects.toSatisfy(
                (error: unknown) => isCatalogApplyError(error) && error.where === 'itemReownAfter',
            );
        }

        const once = recording((step, asked) => (step === 'itemReownAfter' ? 0 : asked));

        await expect(applyCatalogPlan(once, plan(target, snapshot), snapshot.ids, counter())).resolves.toBeDefined();
    });
});
