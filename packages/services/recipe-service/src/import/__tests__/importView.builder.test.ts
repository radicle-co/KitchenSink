/**
 * `ImportViewBuilder` — the import view a `GET`, an `advance`, a cursor move and every other write answers with
 * (ADR-0072 §2, §8, §9). Over fakes for every port.
 *
 * What each case guards:
 *
 *  - **The view is complete and parses against the PUBLISHED contract** (`importViewSchema`), so a field the builder forgets
 *    fails here and not in a client.
 *  - **The allowance state is in the view**, so an `advance` that reached the allowance can answer 200 and the client keeps
 *    the progress it paid for (ADR-0072 §8 as amended).
 *  - **The pause is derived from the live slot count and the unsaved private items, and never stored** (ADR-0073 §8).
 *  - **An item's issue is derived** (`importItemIssueOf`), including the visibility the policy refuses for the label the
 *    statement sets.
 *  - **`version` moves when a verdict lands** (the fingerprint is an input), though no row of the import changed.
 *  - **A page asks for one row more than it returns**, so `nextAfter` is set exactly when more follow.
 */
import { describe, expect, it, vi } from 'vitest';

import { importViewSchema } from '../../recipes/import.schema.js';
import { ImportViewBuilder } from '../importView.builder.js';
import type { PrivateSlotsPort } from '../privateSlots.port.js';
import {
    FAKE_DATABASE,
    makeHeader,
    makeListedItem,
    makePrincipal,
    UNLIMITED_PRIVATE_SLOTS,
} from '../__fixtures__/importFixtures.js';
import type { ListedImportItem } from '../dal/recipeImportItems.dal.js';

const ALLOWANCE = { limit: 1000, used: 7, resetsAt: '2026-10-27T12:00:00.000Z' };
const COUNTS = { total: 3, received: 2, parsing: 0, matched: 1, saved: 0 };

function build(options: {
    readonly items?: readonly ListedImportItem[];
    readonly slots?: PrivateSlotsPort;
    readonly unsavedPrivate?: number;
    readonly verdicts?: { count: number; latest: string | null };
    readonly allowance?: typeof ALLOWANCE;
}) {
    const findPage = vi.fn(async (_importId: string, _after: number | undefined, _limit: number) => [
        ...(options.items ?? []),
    ]);
    const builder = new ImportViewBuilder(
        {
            countsByStage: vi.fn(async () => COUNTS),
            verdictFingerprint: vi.fn(async () => options.verdicts ?? { count: 0, latest: null }),
            countUnsavedPrivate: vi.fn(async () => options.unsavedPrivate ?? 0),
        },
        { findPage },
        { stateOf: vi.fn(async () => options.allowance ?? ALLOWANCE) },
        FAKE_DATABASE,
        options.slots ?? UNLIMITED_PRIVATE_SLOTS,
    );

    return { builder, findPage };
}

const view = (
    options: Parameters<typeof build>[0] = {},
    header = makeHeader(),
    page = { limit: 100 },
    principal = makePrincipal(),
) => build(options).builder.build(principal, header, page);

describe('ImportViewBuilder', () => {
    it('answers a view that parses against the published contract', async () => {
        const answered = await view({
            items: [
                makeListedItem({
                    ordinal: 0,
                    title: 'Soup',
                    stage: 'saved',
                    statementKind: 'authored',
                    recipeId: '66666666-6666-4666-8666-0000000000a1',
                    savedAt: new Date(),
                }),
                makeListedItem({ ordinal: 1, title: 'Stew' }),
            ],
        });

        expect(importViewSchema.parse(answered)).toEqual(answered);
    });

    it('carries the header, the counts and the allowance the view was built from', async () => {
        const answered = await view(
            {},
            makeHeader({ matchMode: 'review', visibility: 'private', expectedTotal: 9, cursorOrdinal: 2 }),
        );

        expect(answered).toMatchObject({
            id: makeHeader().id,
            matchMode: 'review',
            visibility: 'private',
            expectedTotal: 9,
            cursorOrdinal: 2,
            reviewClosed: false,
            counts: COUNTS,
            allowance: ALLOWANCE,
        });
    });

    it('reads a cursor at the count as done (null) and a Save-and-leave header as closed', async () => {
        const answered = await view({}, makeHeader({ expectedTotal: 3, cursorOrdinal: 3, reviewClosedAt: new Date() }));

        expect(answered.cursorOrdinal).toBeNull();
        expect(answered.reviewClosed).toBe(true);
    });

    describe('paging', () => {
        it('asks for one row more than the page, and sets nextAfter exactly when more follow', async () => {
            const items = [0, 1, 2].map((ordinal) => makeListedItem({ ordinal }));
            const { builder, findPage } = build({ items });
            const first = await builder.build(makePrincipal(), makeHeader(), { limit: 2 });

            expect(findPage).toHaveBeenCalledWith(makeHeader().id, undefined, 3);
            expect(first.items.map((item) => item.ordinal)).toEqual([0, 1]);
            expect(first.nextAfter).toBe(1);

            const last = await build({ items: items.slice(0, 2) }).builder.build(makePrincipal(), makeHeader(), {
                limit: 2,
            });

            expect(last.nextAfter).toBeNull();
        });

        it('passes the cursor through', async () => {
            const { builder, findPage } = build({ items: [] });

            await builder.build(makePrincipal(), makeHeader(), { after: 7, limit: 50 });

            expect(findPage).toHaveBeenCalledWith(makeHeader().id, 7, 51);
        });
    });

    describe('the pause (ADR-0073 §8): derived, never stored', () => {
        const noSlots: PrivateSlotsPort = { hasAvailable: async () => false };

        it('is outOfSlots when no slot is free and an unsaved item would be private', async () => {
            expect((await view({ slots: noSlots, unsavedPrivate: 2 })).pause).toEqual({ reason: 'outOfSlots' });
        });

        it('is none while a slot is free', async () => {
            expect((await view({ unsavedPrivate: 2 })).pause).toBeNull();
        });

        it('is none when nothing unsaved is private (the import is not stuck on slots)', async () => {
            expect((await view({ slots: noSlots, unsavedPrivate: 0 })).pause).toBeNull();
        });
    });

    describe('an item’s issue', () => {
        it('⛔ names a matched item whose file states no cuisine and the cook gave none (ADR-0072 §3 as amended 2026-11-11)', async () => {
            const answered = await view({
                items: [
                    makeListedItem({
                        stage: 'matched',
                        matchedAt: new Date(),
                        statementKind: 'authored',
                        publishFacts: { fileCuisine: null, ingredientLineCount: 2, stepCount: 1 },
                    }),
                ],
            });

            expect(answered.items[0]?.issue).toEqual({ reason: 'needsCuisine' });
        });

        it("reads the cook's cuisine over a file that states none, so a given cuisine clears the issue", async () => {
            const answered = await view({
                items: [
                    makeListedItem({
                        stage: 'matched',
                        matchedAt: new Date(),
                        statementKind: 'authored',
                        cuisine: 'Thai',
                        publishFacts: { fileCuisine: null, ingredientLineCount: 2, stepCount: 1 },
                    }),
                ],
            });

            expect(answered.items[0]?.issue).toBeNull();
        });

        // REWRITTEN for ADR-0089: a web statement makes a web copy, which needs a cuisine. The old test lifted the cuisine
        // issue for it, as if it were the curator's public-domain text.
        it('names a recipe with no step, and asks a web import for a cuisine as Publish does', async () => {
            const noSteps = await view({
                items: [
                    makeListedItem({
                        stage: 'matched',
                        matchedAt: new Date(),
                        statementKind: 'authored',
                        publishFacts: { fileCuisine: 'Thai', ingredientLineCount: 2, stepCount: 0 },
                    }),
                ],
            });
            const webCopy = await view({
                items: [
                    makeListedItem({
                        stage: 'matched',
                        matchedAt: new Date(),
                        statementKind: 'source',
                        sourceKind: 'public_web',
                        citation: 'https://example.org/r',
                        // Private: a web copy asked to be public is refused first, which hides the cuisine issue.
                        visibility: 'private',
                        publishFacts: { fileCuisine: null, ingredientLineCount: 2, stepCount: 1 },
                    }),
                ],
            });

            expect(noSteps.items[0]?.issue).toEqual({ reason: 'needsSteps' });
            expect(webCopy.items[0]?.issue).toEqual({ reason: 'needsCuisine' });
        });

        it('names a matched item with no statement', async () => {
            const answered = await view({ items: [makeListedItem({ stage: 'matched', matchedAt: new Date() })] });

            expect(answered.items[0]?.issue).toEqual({ reason: 'needsStatement' });
        });

        it('⛔ names a visibility the policy refuses for the label the statement sets: a book recipe asked to be public', async () => {
            const answered = await view(
                {
                    items: [
                        makeListedItem({
                            stage: 'matched',
                            matchedAt: new Date(),
                            statementKind: 'source',
                            sourceKind: 'book',
                            citation: 'Joy, p. 12',
                            visibility: 'public',
                        }),
                    ],
                },
                makeHeader({ visibility: 'public' }),
            );

            expect(answered.items[0]?.issue).toEqual({ reason: 'visibilityRefused' });
        });

        it('uses the item’s own visibility over the import’s', async () => {
            const book = {
                stage: 'matched' as const,
                matchedAt: new Date(),
                statementKind: 'source',
                sourceKind: 'book',
                citation: 'x',
            };
            const answered = await view(
                { items: [makeListedItem({ ...book, visibility: 'private' })] },
                makeHeader({ visibility: 'public' }),
            );

            expect(answered.items[0]?.issue).toBeNull();
        });

        it('names an item that waits for the allowance once the day is spent', async () => {
            const answered = await view({
                items: [makeListedItem({ stage: 'received' })],
                allowance: { limit: 1000, used: 1000, resetsAt: '2026-10-27T12:00:00.000Z' },
            });

            expect(answered.items[0]?.issue).toEqual({ reason: 'waitingForAllowance' });
        });

        it('names a private matched item that is paused for want of a slot', async () => {
            const answered = await view(
                {
                    slots: { hasAvailable: async () => false },
                    unsavedPrivate: 1,
                    items: [
                        makeListedItem({
                            stage: 'matched',
                            matchedAt: new Date(),
                            statementKind: 'source',
                            sourceKind: 'book',
                            citation: 'x',
                        }),
                    ],
                },
                makeHeader({ visibility: 'private' }),
            );

            expect(answered.items[0]?.issue).toEqual({ reason: 'outOfSlots' });
        });
    });

    describe('the item as the list shows it', () => {
        it('shows the statement in the wire shape, the recipe and the visibility override', async () => {
            const answered = await view({
                items: [
                    makeListedItem({
                        ordinal: 4,
                        stage: 'saved',
                        savedAt: new Date(),
                        recipeId: '66666666-6666-4666-8666-0000000000a1',
                        statementKind: 'source',
                        sourceKind: 'public_web',
                        citation: 'https://example.com/r',
                        visibility: 'public',
                        review: 'skipped',
                    }),
                ],
            });

            expect(answered.items[0]).toEqual({
                ordinal: 4,
                title: 'Soup',
                stage: 'saved',
                review: 'skipped',
                statement: { kind: 'public_web', citation: 'https://example.com/r' },
                visibility: 'public',
                recipeId: '66666666-6666-4666-8666-0000000000a1',
                issue: null,
            });
        });

        it('shows no statement as null', async () => {
            expect((await view({ items: [makeListedItem()] })).items[0]?.statement).toBeNull();
        });
    });

    describe('version', () => {
        it('is the same for the same facts and moves when a verdict lands (no row of the import changed)', async () => {
            const before = await view({ verdicts: { count: 1, latest: '2026-10-26T12:00:00.000000Z' } });
            const same = await view({ verdicts: { count: 1, latest: '2026-10-26T12:00:00.000000Z' } });
            const after = await view({ verdicts: { count: 2, latest: '2026-10-26T12:00:09.000000Z' } });

            expect(same.version).toBe(before.version);
            expect(after.version).not.toBe(before.version);
        });

        // Every advance now moves the import's activity clock (ADR-0072 §9's purge clock). The view does not show that clock,
        // so an advance that changed nothing the cook can see must answer the version the client already holds.
        it('⛔ does not move when only the activity clock does', async () => {
            const a = await view({}, makeHeader({ updatedAt: new Date('2026-10-26T12:00:00.000Z') }));
            const b = await view({}, makeHeader({ updatedAt: new Date('2026-10-26T12:05:00.000Z') }));

            expect(b.version).toBe(a.version);
        });

        it('moves when the allowance does, so a paused import is seen to resume', async () => {
            const a = await view({});
            const b = await view({ allowance: { ...ALLOWANCE, used: 8 } });

            expect(b.version).not.toBe(a.version);
        });
    });
});
