/**
 * REWRITTEN for plan 002 S7.8: what rows 6 and 7's panel shows (`docs/design/ingredientStatusExplanation.md` SPECIFY.1
 * rows 6 and 7; `docs/design/rowEditorOpenDecisions.md`, S7 list contract P12). The owner ruled on 2026-10-02 that
 * every place a cook picks a food shows remote foods, so BOTH rows search the line's own words through the ONE
 * progressive answer: database foods first, then each source's foods under `From {source}`, added at the end, with a
 * waiting line after them while the answer runs. One pick binds one line (owner ruling 2026-10-02). Every search state
 * is pinned here once; both platform leaves render the one view.
 */
import type { ProgressiveFrame } from '@kitchensink/food-service-client';
import { describe, expect, it } from 'vitest';

import {
    COMPLETE_FRAME,
    answerOf,
    authoredResult,
    catalogResult,
    databaseFrame,
    remoteItem,
    sourceAnswered,
    sourceBusy,
} from '../../__fixtures__/progressiveFrames.js';
import { entrySearchViewOf, type EntrySearchView } from '../../hooks/foodSuggestions.model.js';
import type { IngredientPick, LineCommitOutcome } from '../../hooks/lineCommit.js';
import type { SettledRowCommit } from '../../hooks/useIngredientRowEditor.js';
import { recipeMessages } from '../../messages.js';
import { seedLineKey } from '../lineKey.js';
import { recipeFormMessages } from '../messages.js';
import {
    shortlistPanelOf,
    shortlistSettledAt,
    type ShortlistPanelCopy,
    type ShortlistPanelInput,
} from '../shortlistPanel.model.js';

const form = recipeFormMessages.en;
const remote = recipeMessages.en.ingredientRemoteSearch;
const COPY: ShortlistPanelCopy = { form, remote, readOffline: 'Waiting for a connection. This loads on its own.' };

const MINE = authoredResult('food_mine', 'apple sauce, homemade');
const PLAIN = catalogResult('food_sauce', 'Applesauce');
const UNSWEETENED = {
    ...catalogResult('food_sauce_root', 'Applesauce'),
    variant: { id: 'var_unsweetened', parts: [{ attribute: 'sweetener' as const, text: 'unsweetened' }] },
};
const BOTH = databaseFrame({ authored: [MINE], catalog: [PLAIN, UNSWEETENED] });
const STEWED = remoteItem('Apples, stewed', 'sealed.s');

/** The panel's search view for `frames`, the answer still running or ended. */
const viewOf = (frames: readonly ProgressiveFrame[], kind: 'asking' | 'ended' = 'ended'): EntrySearchView =>
    entrySearchViewOf({
        trimmed: 'apple sauce',
        debouncedTrimmed: 'apple sauce',
        read: { kind, answer: answerOf(...frames), resumed: false },
    });

const panelOf = (view: EntrySearchView, over: Partial<ShortlistPanelInput> = {}) =>
    shortlistPanelOf(
        {
            view,
            reason: 'ambiguous',
            food: 'apple sauce',
            inFlight: undefined,
            lastPick: undefined,
            limitRefusals: 0,
            sourceName: (source) => (source === 'usda' ? 'USDA' : undefined),
            formatTime: () => '3:05 PM',
            formatList: (items) => items.join(', '),
            ...over,
        },
        COPY,
    );

const LABEL = 'Which “apple sauce” did you mean?';

describe('shortlistPanelOf — why the row needs the cook', () => {
    it.each<['ambiguous' | 'unresolved', string]>([
        ['ambiguous', form.statusExplainAmbiguous],
        ['unresolved', form.statusExplainUnresolved],
    ])('a %s line explains itself in its own words', (reason, explanation) => {
        expect(panelOf(viewOf([BOTH]), { reason }).view.explanation).toBe(explanation);
    });
});

describe('shortlistPanelOf — the shortlist, from the progressive answer', () => {
    it.each<[string, EntrySearchView, unknown]>([
        ['no frame yet', viewOf([], 'asking'), { kind: 'loading', text: form.candidatesLoading }],
        ['held offline', { kind: 'offline' }, { kind: 'offline', text: COPY.readOffline }],
        ['a name too short to search', { kind: 'tooShort', minimum: 3 }, { kind: 'empty', text: form.candidatesEmpty }],
        ['no name to search', { kind: 'idle' }, { kind: 'empty', text: form.candidatesEmpty }],
        ['nothing arrived', viewOf([]), { kind: 'failed', text: form.candidatesLoadFailed }],
        [
            'every part failed',
            viewOf([databaseFrame({ authored: 'unavailable', catalog: 'unavailable' }), COMPLETE_FRAME]),
            { kind: 'failed', text: form.candidatesLoadFailed },
        ],
        [
            'everything answered with nothing',
            viewOf([databaseFrame(), sourceAnswered('usda'), COMPLETE_FRAME]),
            { kind: 'empty', text: form.candidatesEmpty },
        ],
    ])('%s', (_case, view, body) => {
        expect(panelOf(view).view.body).toEqual(body);
    });

    it('running: the database foods named for the row, then a waiting line after them (P12)', () => {
        expect(panelOf(viewOf([BOTH], 'asking')).view.body).toEqual({
            kind: 'list',
            groups: [
                {
                    key: 'database',
                    label: LABEL,
                    heading: false,
                    options: [
                        {
                            candidateId: 'authored:food_mine',
                            name: 'apple sauce, homemade',
                            summary: undefined,
                            accessibleName: undefined,
                            busy: false,
                            blocked: false,
                        },
                        {
                            candidateId: 'catalog:food_sauce',
                            name: 'Applesauce',
                            summary: undefined,
                            accessibleName: undefined,
                            busy: false,
                            blocked: false,
                        },
                        {
                            candidateId: 'catalog:food_sauce_root',
                            name: 'Applesauce',
                            summary: 'unsweetened',
                            accessibleName: undefined,
                            busy: false,
                            blocked: false,
                        },
                    ],
                },
            ],
            notes: [],
            waiting: remote.stillSearching,
        });
    });

    it('a source’s foods come after, under `From {source}`, each named with its source (P5, P12)', () => {
        const { body } = panelOf(viewOf([BOTH, sourceAnswered('usda', STEWED), COMPLETE_FRAME])).view;

        expect(body.kind === 'list' ? body.groups.at(-1) : undefined).toEqual({
            key: 'remote:usda',
            label: 'From USDA',
            heading: true,
            options: [
                {
                    candidateId: 'remote:usda:sealed.s',
                    name: 'Apples, stewed',
                    summary: undefined,
                    accessibleName: 'Apples, stewed, from USDA',
                    busy: false,
                    blocked: false,
                },
            ],
        });
        expect(body.kind === 'list' ? body.waiting : 'not a list').toBeUndefined();
    });

    it('says, under the list, what could not be searched, each source’s note, and that it did not finish', () => {
        const { body } = panelOf(
            viewOf([databaseFrame({ authored: [MINE], catalog: 'unavailable' }), sourceBusy('usda', 1)]),
        ).view;

        expect(body.kind === 'list' ? body.notes : []).toEqual([
            form.ingredientCatalogUnavailable,
            'We couldn’t search USDA just now. Try again later.',
            remote.incomplete,
        ]);
    });

    it('a group that failed with the rest empty is still a list that says what was not searched, never “no options”', () => {
        const { body } = panelOf(viewOf([databaseFrame({ catalog: 'unavailable' }), COMPLETE_FRAME])).view;

        expect(body).toEqual({
            kind: 'list',
            groups: [],
            notes: [form.ingredientCatalogUnavailable],
            waiting: undefined,
        });
    });
});

describe('shortlistPanelOf — a pick binds THIS line, through the commit route', () => {
    const VIEW = viewOf([BOTH, sourceAnswered('usda', STEWED), COMPLETE_FRAME]);

    it('each option picks its food as the entry does: a root as the food, a matched variant, a remote food by reference', () => {
        const panel = panelOf(VIEW);

        expect(panel.pickOf('authored:food_mine')).toEqual({
            kind: 'catalogFood',
            foodId: 'food_mine',
            name: 'apple sauce, homemade',
        });
        expect(panel.pickOf('catalog:food_sauce_root')).toEqual({
            kind: 'catalogVariant',
            foodVariantId: 'var_unsweetened',
        });
        expect(panel.pickOf('remote:usda:sealed.s')).toEqual({
            kind: 'remoteFood',
            reference: 'sealed.s',
            name: 'Apples, stewed',
            source: 'usda',
        });
        expect(panel.pickOf('catalog:gone')).toBeUndefined();
    });

    it('while one pick runs, its option reads busy and the others do nothing, a remote one told apart by reference', () => {
        const { body } = panelOf(
            viewOf([BOTH, sourceAnswered('usda', remoteItem('Apples, stewed', 'sealed.t'), STEWED), COMPLETE_FRAME]),
            { inFlight: { kind: 'remoteFood', reference: 'sealed.s', name: 'Apples, stewed', source: 'usda' } },
        ).view;
        const options = body.kind === 'list' ? body.groups.flatMap((group) => group.options) : [];

        expect(options.map((option) => [option.busy, option.blocked])).toEqual([
            [false, true],
            [false, true],
            [false, true],
            [false, true],
            [true, false],
        ]);
    });

    it.each<[string, IngredientPick, LineCommitOutcome, string]>([
        [
            'a database pick that failed',
            { kind: 'catalogFood', foodId: 'food_sauce', name: 'Applesauce' },
            { kind: 'failed' },
            form.candidatePickFailed,
        ],
        [
            'a remote pick that failed',
            { kind: 'remoteFood', reference: 'sealed.s', name: 'Apples, stewed', source: 'usda' },
            { kind: 'failed' },
            'We couldn’t add Apples, stewed from USDA. Try again, or choose another food.',
        ],
        [
            'a remote pick food refused',
            { kind: 'remoteFood', reference: 'sealed.s', name: 'Apples, stewed', source: 'usda' },
            { kind: 'remoteGone' },
            'Apples, stewed isn’t available any more. Choose another food.',
        ],
    ])('%s is said assertively, and the list stays to choose again (P8)', (_case, pick, outcome, alert) => {
        const panel = panelOf(VIEW, { lastPick: { pick, outcome } });

        expect(panel.view.alert).toBe(alert);
        expect(panel.view.body.kind).toBe('list');
    });

    it('the cook’s limit is said again at each refused press (item 10, R8)', () => {
        const panel = panelOf(VIEW, {
            lastPick: {
                pick: { kind: 'remoteFood', reference: 'sealed.s', name: 'Apples, stewed', source: 'usda' },
                outcome: { kind: 'limited', retryAt: 0 },
            },
            limitRefusals: 3,
        });

        expect(panel.view).toMatchObject({
            alert: 'You’ve reached your limit for food lookups. You can try again at 3:05 PM.',
            alertOccurrence: 3,
        });
    });

    it('nothing failed: nothing said', () => {
        expect(panelOf(VIEW).view).toMatchObject({ alert: '', alertOccurrence: 0 });
    });
});

describe('shortlistSettledAt — the last pick this row’s panel made, once it settled', () => {
    const KEY = seedLineKey(1, 0);
    const OTHER = seedLineKey(1, 1);
    const PICK: IngredientPick = { kind: 'catalogFood', foodId: 'food_sauce', name: 'Applesauce' };
    const settled = (over: Partial<SettledRowCommit>): SettledRowCommit => ({
        origin: { kind: 'shortlist' },
        pick: PICK,
        target: { kind: 'line', key: KEY },
        outcome: { kind: 'failed' },
        ...over,
    });

    it('only a panel pick, only on this row', () => {
        expect(shortlistSettledAt(settled({}), KEY)).toEqual({ pick: PICK, outcome: { kind: 'failed' } });
        expect(shortlistSettledAt(settled({}), OTHER)).toBeUndefined();
        expect(shortlistSettledAt(settled({ origin: { kind: 'entry' } }), KEY)).toBeUndefined();
        expect(shortlistSettledAt(settled({ target: { kind: 'newLine' } }), KEY)).toBeUndefined();
        expect(shortlistSettledAt(undefined, KEY)).toBeUndefined();
    });
});
