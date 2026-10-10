/**
 * REWRITTEN for plan 002 S7.8: component tests for the web `CandidatesPanelBody`, rows 6 and 7's panel body
 * (SPECIFY.1), presentational: it draws the view `shortlistPanelOf` derives from the progressive food search (built
 * here with the real function, from frame sequences), and hands each press to its host
 * (`docs/design/rowEditorOpenDecisions.md`, S7 list contract P5, P6, P8 and P12).
 */
import type { ProgressiveFrame } from '@kitchensink/food-service-client';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    COMPLETE_FRAME,
    FRAME_SEQUENCES,
    answerOf,
    catalogResult,
    databaseFrame,
    remoteItem,
    sourceAnswered,
    sourceBusy,
} from '../../__fixtures__/progressiveFrames.js';
import { entrySearchViewOf, type EntrySearchView } from '../../hooks/foodSuggestions.model.js';
import { recipeMessages } from '../../messages.js';
import { CandidatesPanelBody } from '../CandidatesPanelBody.js';
import { recipeFormMessages } from '../messages.js';
import { shortlistPanelOf, type ShortlistPanelInput } from '../shortlistPanel.model.js';

afterEach(cleanup);

const en = recipeFormMessages.en;
const remote = recipeMessages.en.ingredientRemoteSearch;
const READ_OFFLINE = 'You’re offline. This will load when you’re back online.';
const KALE = catalogResult('food_kale', 'Kale, raw');
const CURLY = {
    ...catalogResult('food_curly', 'Kale'),
    variant: { id: 'var_curly', parts: [{ attribute: 'variety' as const, text: 'curly' }] },
};
const LACINATO = remoteItem('Kale, lacinato', 'sealed.l');

const viewOf = (frames: readonly ProgressiveFrame[], kind: 'asking' | 'ended' = 'ended'): EntrySearchView =>
    entrySearchViewOf({
        trimmed: 'kale',
        debouncedTrimmed: 'kale',
        read: { kind, answer: answerOf(...frames), resumed: false },
    });

const panelView = (view: EntrySearchView, over: Partial<ShortlistPanelInput> = {}) =>
    shortlistPanelOf(
        {
            view,
            reason: 'unresolved',
            food: 'Kale',
            inFlight: undefined,
            lastPick: undefined,
            limitRefusals: 0,
            sourceName: (source) => (source === 'usda' ? 'USDA' : undefined),
            formatTime: () => '3:05 PM',
            formatList: (items) => items.join(', '),
            ...over,
        },
        { form: en, remote, readOffline: READ_OFFLINE },
    ).view;

const LISTED = viewOf([databaseFrame({ catalog: [KALE, CURLY] }), sourceAnswered('usda', LACINATO), COMPLETE_FRAME]);

const renderBody = (view: EntrySearchView, over: Partial<ShortlistPanelInput> = {}) => {
    const on = { onPick: vi.fn(), onRetryRead: vi.fn(), onNoneOfThese: vi.fn() };
    const rendered = render(<CandidatesPanelBody view={panelView(view, over)} {...on} />);

    return { ...on, ...rendered };
};

/** How many assertive regions say `text`. */
const said = (text: string): number =>
    screen.getAllByRole('alert').filter((region) => region.textContent === text).length;

describe('CandidatesPanelBody (web)', () => {
    it('explains the row, lists our database’s foods with their hints, and a press picks that one', async () => {
        const user = userEvent.setup();
        const { onPick } = renderBody(LISTED);
        const list = screen.getByRole('list', { name: 'Which “Kale” did you mean?' });

        expect(screen.getByText(en.statusExplainUnresolved)).toBeTruthy();
        expect(within(list).getAllByRole('button')[1]?.textContent).toContain('curly');
        await user.click(within(list).getByRole('button', { name: 'Kale, raw' }));

        expect(onPick).toHaveBeenCalledExactlyOnceWith('catalog:food_kale');
    });

    it('a source’s foods come after, under a visible `From {source}`, each named with its source (P5, P12)', async () => {
        const user = userEvent.setup();
        const { onPick } = renderBody(LISTED);
        const usda = screen.getByRole('list', { name: 'From USDA' });

        expect(screen.getByText('From USDA')).toBeTruthy();
        await user.click(within(usda).getByRole('button', { name: 'Kale, lacinato, from USDA' }));

        expect(onPick).toHaveBeenCalledExactlyOnceWith('remote:usda:sealed.l');
    });

    it('while the answer runs, the waiting line comes after the options and is polite (P12)', () => {
        renderBody(viewOf([databaseFrame({ catalog: [KALE] })], 'asking'));
        const waiting = screen.getByText(remote.stillSearching);

        expect(waiting.getAttribute('role')).toBe('status');
        expect(
            screen.getByRole('button', { name: 'Kale, raw' }).compareDocumentPosition(waiting) &
                Node.DOCUMENT_POSITION_FOLLOWING,
        ).not.toBe(0);
    });

    it('at the end, the same polite line says what could not be searched and each source’s note', () => {
        renderBody(
            viewOf([
                databaseFrame({ catalog: [KALE], authored: 'unavailable' }),
                sourceBusy('usda', 1),
                COMPLETE_FRAME,
            ]),
        );

        expect(screen.getByRole('status').textContent).toBe(
            `${en.ingredientAuthoredUnavailable} We couldn’t search USDA just now. Try again later.`,
        );
    });

    // P2: "No frame moves an option that is on screen. Every frame adds at the end."
    it.each(FRAME_SEQUENCES)('nothing already shown moves as frames arrive: $name', ({ frames }) => {
        const on = { onPick: vi.fn(), onRetryRead: vi.fn(), onNoneOfThese: vi.fn() };
        const { rerender } = render(
            <CandidatesPanelBody view={panelView(viewOf(frames.slice(0, 1), 'asking'))} {...on} />,
        );
        let shown = screen
            .queryAllByRole('button')
            .filter((button) => button.textContent !== en.statusActionNoneOfThese);

        frames.slice(1).forEach((_frame, index) => {
            rerender(<CandidatesPanelBody view={panelView(viewOf(frames.slice(0, index + 2), 'asking'))} {...on} />);
            const now = screen
                .queryAllByRole('button')
                .filter((button) => button.textContent !== en.statusActionNoneOfThese);

            expect(now.slice(0, shown.length)).toEqual(shown);
            shown = now;
        });
    });

    it('a pick in flight: the pressed food reads busy and refuses a press, and the others are unavailable', async () => {
        const user = userEvent.setup();
        const { onPick } = renderBody(LISTED, {
            inFlight: { kind: 'remoteFood', reference: 'sealed.l', name: 'Kale, lacinato', source: 'usda' },
        });
        const pressed = screen.getByRole('button', { name: 'Kale, lacinato, from USDA' });

        expect(pressed.getAttribute('aria-busy')).toBe('true');
        expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Kale, raw' }).disabled).toBe(true);
        await user.click(pressed);
        expect(onPick).not.toHaveBeenCalled();
    });

    it.each<[string, EntrySearchView, string, string | null]>([
        ['loading', viewOf([], 'asking'), en.candidatesLoading, 'status'],
        ['parked offline', { kind: 'offline' }, READ_OFFLINE, 'status'],
        ['empty', viewOf([databaseFrame(), COMPLETE_FRAME]), en.candidatesEmpty, null],
    ])('%s: says so, and None of these is still the way on', (_case, view, text, role) => {
        renderBody(view);

        expect(screen.getByText(text).getAttribute('role')).toBe(role);
        expect(screen.getByRole('button', { name: en.statusActionNoneOfThese })).toBeTruthy();
    });

    it('a failed read says so assertively, and Try again reads again', async () => {
        const user = userEvent.setup();
        const { onRetryRead } = renderBody(viewOf([]));

        expect(said(en.candidatesLoadFailed)).toBe(1);
        await user.click(screen.getByRole('button', { name: en.statusActionRetry }));

        expect(onRetryRead).toHaveBeenCalledTimes(1);
    });

    it('a remote pick food refused is said assertively, and the list stays to choose again (P8)', () => {
        renderBody(LISTED, {
            lastPick: {
                pick: { kind: 'remoteFood', reference: 'sealed.l', name: 'Kale, lacinato', source: 'usda' },
                outcome: { kind: 'remoteGone' },
            },
        });

        expect(said('Kale, lacinato isn’t available any more. Choose another food.')).toBe(1);
        expect(screen.getByRole('list', { name: 'Which “Kale” did you mean?' })).toBeTruthy();
    });

    it('the cook’s limit is said again at each refused press: it moves to the other region (R8)', () => {
        const on = { onPick: vi.fn(), onRetryRead: vi.fn(), onNoneOfThese: vi.fn() };
        const LIMIT = 'You’ve reached your limit for food lookups. You can try again at 3:05 PM.';
        const limited = (limitRefusals: number) =>
            panelView(LISTED, {
                lastPick: {
                    pick: { kind: 'remoteFood', reference: 'sealed.l', name: 'Kale, lacinato', source: 'usda' },
                    outcome: { kind: 'limited', retryAt: 0 },
                },
                limitRefusals,
            });
        const { rerender } = render(<CandidatesPanelBody view={limited(1)} {...on} />);
        const holder = (): number => screen.getAllByRole('alert').findIndex((region) => region.textContent === LIMIT);
        const first = holder();

        rerender(<CandidatesPanelBody view={limited(2)} {...on} />);

        expect(first).not.toBe(-1);
        expect(holder()).not.toBe(-1);
        expect(holder()).not.toBe(first);
    });

    it('None of these hands the row back to the host and picks nothing', async () => {
        const user = userEvent.setup();
        const { onPick, onNoneOfThese } = renderBody(LISTED);

        await user.click(screen.getByRole('button', { name: en.statusActionNoneOfThese }));

        expect(onNoneOfThese).toHaveBeenCalledTimes(1);
        expect(onPick).not.toHaveBeenCalled();
    });
});
