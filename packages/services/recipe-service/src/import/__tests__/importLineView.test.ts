/**
 * `ImportLineView` — the Content Enricher that gives a snapshot line its match and its flag, AS THE CALLER (ADR-0072 §4, §6).
 *
 * What each case guards:
 *
 *  - **One projection of a match.** A snapshot line reads exactly as the paste screen would read the same facts: a verdict that
 *    contradicts a lexical proposal makes the line `needsChoice` (ADR-0071 §9), and the verdict is read BY KEY on every view,
 *    never copied.
 *  - **Names at read time, as the caller, in ONE batched read** (ADR-0045). A food that could not be asked is `null`, never a
 *    name taken from storage; the view keeps polling.
 *  - **Flagged is DERIVED from the SAVED line's verdict** (not the proposal's: a line the import bound to its default is judged
 *    under another key), through the one classifier `identityReadingOf` and the third mapping `importFlagOf`.
 *  - **A spent budget is a choice, never "checking" forever** (owner ruling 2026-10-26, ADR-0072 §10). A key whose review the
 *    ceiling refused THIS period reads `reviewBudgetSpent` with the moment the budget comes back, on the match and the flag.
 *  - **The view is total.** An unreadable verdict table degrades to "no verdict yet"; it never fails a poll.
 */
import { describe, expect, it, vi } from 'vitest';

import type { FoodRef, RootArm } from '../../database/schema/foodLookupArm.js';
import type { FoodLookupsDal } from '../../ingredients/dal/foodLookups.dal.js';
import type { FoodRefAnswer } from '../../ingredients/domain/foodRefAnswer.js';
import { canonicalIngredientName } from '../../ingredients/domain/ingredientName.js';
import type { LineVerdictRow } from '../../recipes/dal/lineVerifications.dal.js';
import { CallerToken } from '../../auth/CallerToken.js';
import { makeLine, makePrincipal } from '../__fixtures__/importFixtures.js';
import { ImportLineView } from '../importLineView.js';
import type { ListedLine } from '../dal/recipeImportLines.dal.js';
import { actingPrincipalOf } from '../../auth/principal.js';

const CALLER = CallerToken.fromAuthorizationHeader('Bearer cook-token');
const ACTING = actingPrincipalOf(makePrincipal());
const named = (name: string, rootId: string): FoodRefAnswer => ({
    outcome: 'found',
    name: canonicalIngredientName(name),
    status: 'RESOLVED',
    isPrivate: false,
    rootId,
});
const AGREE: LineVerdictRow = { band: 'verified', certainty: 'high', identityVerdict: 'agree', aspects: ['identity'] };
const DISAGREE: LineVerdictRow = {
    band: 'contradicted',
    certainty: 'high',
    identityVerdict: 'disagree',
    aspects: ['identity'],
};

function build(
    options: {
        readonly answers?: Record<string, FoodRefAnswer>;
        readonly verdicts?: Record<string, LineVerdictRow>;
        readonly exhausted?: readonly string[];
        readonly budgetSpent?: readonly string[];
        readonly verdictsFail?: boolean;
        /** The verdict read never settles, as a stalled database would. */
        readonly verdictsHang?: boolean;
        readonly arms?: Record<string, Pick<RootArm, 'kind' | 'lookupId' | 'foodId'>>;
    } = {},
) {
    const answers = options.answers ?? {
        'root:F-whole': named('Milk, whole', 'F-whole'),
        'root:F-skim': named('Milk, skim', 'F-skim'),
    };
    const resolve = vi.fn(async (_caller: unknown, refs: readonly FoodRef[]) => ({
        answers: new Map(
            refs.map(
                (ref) =>
                    [
                        `${ref.kind}:${ref.id}`,
                        answers[`${ref.kind}:${ref.id}`] ?? ({ outcome: 'unreachable' } as FoodRefAnswer),
                    ] as const,
            ),
        ),
        degraded: false,
    }));
    const findBandsByKeys = vi.fn(async (keys: readonly string[]) => {
        if (options.verdictsFail === true) {
            throw new Error('verdict table down');
        }

        if (options.verdictsHang === true) {
            await new Promise<never>(() => undefined);
        }

        return new Map(
            keys.flatMap((key) =>
                options.verdicts?.[key] === undefined ? [] : [[key, options.verdicts[key]] as const],
            ),
        );
    });
    const findExhaustedKeys = vi.fn(
        async (keys: readonly string[]) => new Set(keys.filter((key) => options.exhausted?.includes(key))),
    );
    const findBudgetSpentKeys = vi.fn(
        async (keys: readonly string[], _period: string) =>
            new Set(keys.filter((key) => options.budgetSpent?.includes(key))),
    );
    const findByIds = vi.fn<FoodLookupsDal['findByIds']>(
        async (ids) =>
            new Map(
                ids.flatMap((id) => {
                    const arm = options.arms?.[id];

                    return arm === undefined
                        ? []
                        : [[id, { ...arm, foodOwnerId: null, createdAt: new Date(0) }] as const];
                }),
            ),
    );
    const view = new ImportLineView(
        { findBandsByKeys, findExhaustedKeys, findBudgetSpentKeys },
        { resolve },
        {
            findByIds,
        },
    );

    return { view, resolve, findBandsByKeys, findExhaustedKeys, findBudgetSpentKeys, findByIds };
}

describe('ImportLineView.matchesOf', () => {
    it('projects a snapshot line through the paste projection, with names resolved as the caller', async () => {
        const { view } = build();
        const line = makeLine({ id: 'L1' });
        const matches = await view.matchesOf(ACTING, CALLER, [line]);

        expect(matches.get('L1')).toMatchObject({
            state: 'checking',
            reason: 'awaitingReview',
            proposed: { kind: 'root', id: 'F-whole', name: 'Milk, whole' },
            candidates: [{ kind: 'root', id: 'F-whole', name: 'Milk, whole', isDefault: false }],
        });
    });

    it('⛔ reads the verdict by key on every view: a contradiction makes the proposal a choice the cook makes', async () => {
        const { view } = build({ verdicts: { 'v1:proposal': DISAGREE } });
        const matches = await view.matchesOf(ACTING, CALLER, [makeLine({ id: 'L1' })]);

        expect(matches.get('L1')).toMatchObject({ state: 'needsChoice', reason: 'reviewContradicted', proposed: null });
    });

    it('a verified exact-name proposal is confident', async () => {
        const { view } = build({ verdicts: { 'v1:proposal': AGREE } });
        const matches = await view.matchesOf(ACTING, CALLER, [makeLine({ id: 'L1' })]);

        expect(matches.get('L1')).toMatchObject({ state: 'confident', reason: 'reviewVerified' });
    });

    it('a refused review is a choice, an exhausted one too', async () => {
        const refused = makeLine({ id: 'L1', review: 'refused', verificationKey: null });
        const exhausted = makeLine({ id: 'L2', lineIndex: 1, verificationKey: 'v1:gave-up' });
        const matches = await build({ exhausted: ['v1:gave-up'] }).view.matchesOf(ACTING, CALLER, [refused, exhausted]);

        expect(matches.get('L1')).toMatchObject({ state: 'needsChoice', reason: 'reviewRefused' });
        expect(matches.get('L2')).toMatchObject({ state: 'needsChoice', reason: 'reviewUnchecked' });
    });

    it('⛔ a review the ceiling refused this period is a choice with the moment the budget comes back', async () => {
        const { view, findBudgetSpentKeys } = build({ budgetSpent: ['v1:proposal'] });
        const matches = await view.matchesOf(ACTING, CALLER, [makeLine({ id: 'L1' })]);

        expect(matches.get('L1')).toMatchObject({ state: 'needsChoice', reason: 'reviewBudgetSpent' });
        expect(matches.get('L1')).toHaveProperty('reviewResetsAt');
        // ONE period, the current one, for every key of the read.
        expect(findBudgetSpentKeys).toHaveBeenCalledWith(['v1:proposal'], expect.stringMatching(/^\d{4}-\d{2}$/u));
    });

    it('⛔ is null for a line whose foods food could not be asked about (never a name from storage)', async () => {
        const { view } = build({ answers: {} });
        const matches = await view.matchesOf(ACTING, CALLER, [makeLine({ id: 'L1' })]);

        expect(matches.get('L1')).toBeNull();
    });

    it('asks food once for every line’s foods, and not at all for no lines', async () => {
        const { view, resolve } = build();

        await view.matchesOf(ACTING, CALLER, [makeLine({ id: 'L1' }), makeLine({ id: 'L2', lineIndex: 1 })]);
        expect(resolve).toHaveBeenCalledTimes(1);

        resolve.mockClear();
        expect((await view.matchesOf(ACTING, CALLER, [])).size).toBe(0);
        expect(resolve).not.toHaveBeenCalled();
    });

    it('degrades an unreadable verdict table to "no verdict yet" instead of failing the view', async () => {
        const { view } = build({ verdictsFail: true });
        const matches = await view.matchesOf(ACTING, CALLER, [makeLine({ id: 'L1' })]);

        expect(matches.get('L1')).toMatchObject({ state: 'checking' });
    });

    it('⛔ ends a stalled verdict read at the request’s deadline: "no verdict yet", as the paste view does', async () => {
        const { view } = build({ verdictsHang: true });
        const deadline = AbortSignal.timeout(20);
        const matches = await view.matchesOf(ACTING, CALLER, [makeLine({ id: 'L1' })], deadline);

        expect(matches.get('L1')).toMatchObject({ state: 'checking', reason: 'awaitingReview' });
    });

    it('a contained test principal’s review is never sent, so it reads a choice and not “checking” forever', async () => {
        const contained = actingPrincipalOf(makePrincipal({ principalKind: 'test', containment: 'enforce' }));
        const matches = await build().view.matchesOf(contained, CALLER, [makeLine({ id: 'L1' })]);

        expect(matches.get('L1')).toMatchObject({ state: 'needsChoice', reason: 'reviewNotAsked' });
    });
});

describe('ImportLineView.flagsOf', () => {
    const listed = (overrides: Partial<ListedLine> = {}): ListedLine => ({
        line: makeLine({
            id: 'L1',
            candidates: [
                { kind: 'root', id: 'F-whole', rung: 'head', isDefault: false },
                { kind: 'root', id: 'F-skim', rung: 'default', isDefault: true },
            ],
        }),
        title: 'Soup',
        ingredientId: 'ING-1',
        recipeId: 'R-1',
        sortOrder: 0,
        boundBy: 'autoBest',
        foodLookupId: 'LK-1',
        savedVerificationKey: 'v1:saved',
        ...overrides,
    });
    const arms = { 'LK-1': { kind: 'root' as const, lookupId: 'LK-1', foodId: 'F-whole' } };

    it('is clear when the gate agrees with the saved line', async () => {
        const { view } = build({ arms, verdicts: { 'v1:saved': AGREE } });
        const flags = await view.flagsOf(ACTING, CALLER, [listed()]);

        expect(flags.get('L1')).toEqual({
            bound: { kind: 'root', id: 'F-whole', name: 'Milk, whole' },
            flag: { state: 'clear' },
        });
    });

    it('⛔ is flagged when the gate contradicts it, suggesting the DEFAULT candidate by name', async () => {
        const { view } = build({ arms, verdicts: { 'v1:saved': DISAGREE } });
        const flags = await view.flagsOf(ACTING, CALLER, [listed()]);

        expect(flags.get('L1')?.flag).toEqual({
            state: 'flagged',
            suggestion: { kind: 'root', id: 'F-skim', name: 'Milk, skim' },
        });
    });

    it('finds the default by its RUNG, the fact the stored flag was derived from, not by a stored flag', async () => {
        const { view } = build({ arms, verdicts: { 'v1:saved': DISAGREE } });
        const line = makeLine({
            id: 'L1',
            candidates: [
                { kind: 'root', id: 'F-whole', rung: 'head' },
                { kind: 'root', id: 'F-skim', rung: 'default' },
            ],
        });
        const flags = await view.flagsOf(ACTING, CALLER, [listed({ line })]);

        expect(flags.get('L1')?.flag).toEqual({
            state: 'flagged',
            suggestion: { kind: 'root', id: 'F-skim', name: 'Milk, skim' },
        });
    });

    it('is checking while the review is still owed, and flagged once it gave up (never “checking” forever)', async () => {
        const waiting = await build({ arms }).view.flagsOf(ACTING, CALLER, [listed()]);
        const gaveUp = await build({ arms, exhausted: ['v1:saved'] }).view.flagsOf(ACTING, CALLER, [listed()]);

        expect(waiting.get('L1')?.flag).toEqual({ state: 'checking' });
        expect(gaveUp.get('L1')?.flag).toMatchObject({ state: 'flagged' });
    });

    it('⛔ is flagged, not checking, when the ceiling refused the saved line’s review this period', async () => {
        const flags = await build({ arms, budgetSpent: ['v1:saved'] }).view.flagsOf(ACTING, CALLER, [listed()]);

        expect(flags.get('L1')?.flag).toMatchObject({ state: 'flagged' });
    });

    it('a line with no saved key was never judged: flagged, not checking', async () => {
        const flags = await build({ arms }).view.flagsOf(ACTING, CALLER, [listed({ savedVerificationKey: null })]);

        expect(flags.get('L1')?.flag).toMatchObject({ state: 'flagged' });
    });

    it('suggests nothing for a line already bound to the default', async () => {
        const skimArms = { 'LK-1': { kind: 'root' as const, lookupId: 'LK-1', foodId: 'F-skim' } };
        const flags = await build({ arms: skimArms, verdicts: { 'v1:saved': DISAGREE } }).view.flagsOf(ACTING, CALLER, [
            listed(),
        ]);

        expect(flags.get('L1')?.flag).toEqual({ state: 'flagged', suggestion: null });
    });

    it('names the bound food as food says now, and `null` when food could not be asked', async () => {
        const down = await build({ arms, answers: {}, verdicts: { 'v1:saved': DISAGREE } }).view.flagsOf(
            ACTING,
            CALLER,
            [listed()],
        );

        expect(down.get('L1')?.bound).toEqual({ kind: 'root', id: 'F-whole', name: null });
        // The suggestion is still a food by id, with no name: the contract has no place for a name taken from storage.
        expect(down.get('L1')?.flag).toEqual({
            state: 'flagged',
            suggestion: { kind: 'root', id: 'F-skim', name: null },
        });
    });

    it('reads a line whose binding is gone as unbound: no entry, so the list drops it', async () => {
        const flags = await build({ arms: {} }).view.flagsOf(ACTING, CALLER, [listed()]);

        expect(flags.has('L1')).toBe(false);
    });
});
