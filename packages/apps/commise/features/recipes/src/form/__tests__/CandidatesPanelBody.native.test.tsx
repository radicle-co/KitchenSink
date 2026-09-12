/**
 * REWRITTEN for plan 002 S7.8: component tests for the native `CandidatesPanelBody`, rows 6 and 7's panel body
 * (SPECIFY.1), presentational and the web body's twin: it draws the view `shortlistPanelOf` derives from the progressive
 * food search (built here with the real function, from frame sequences), and hands each press to its host
 * (`docs/design/rowEditorOpenDecisions.md`, S7 list contract P5, P6, P8, P10 and P12).
 */
import type { ProgressiveFrame } from '@kitchensink/food-service-client';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { createElement } from 'react';
import type { ViewProps } from 'react-native';
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
import { CandidatesPanelBody } from '../CandidatesPanelBody.native.js';
import { recipeFormMessages } from '../messages.js';
import { shortlistPanelOf, type ShortlistPanelInput } from '../shortlistPanel.js';

// Every `View`'s props, recorded: React Native 0.86 flattens a View that only lays out its children out of Android's
// native tree, label and all (`ViewShadowNode.cpp`), and react-native-web, which renders every View, cannot show that.
const views = vi.hoisted(() => ({ rendered: [] as ViewProps[] }));
vi.mock('react-native', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-native')>();

    return {
        ...actual,
        View: (props: ViewProps) => {
            views.rendered.push(props);

            return createElement(actual.View, props);
        },
    };
});

afterEach(() => {
    cleanup();
    views.rendered.length = 0;
});

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

/** The texts of the assertive regions, in order. */
const assertive = (): readonly (string | null)[] =>
    Array.from(document.querySelectorAll('[aria-live="assertive"]')).map((region) => region.textContent);

/** The food buttons, in order, None of these left out. */
const foodButtons = (): HTMLElement[] =>
    screen.queryAllByRole('button').filter((button) => button.textContent !== en.statusActionNoneOfThese);

describe('CandidatesPanelBody (native)', () => {
    it('explains the row, lists our database’s foods with their hints, and a press picks that one', () => {
        const { onPick } = renderBody(LISTED);
        const list = screen.getByLabelText('Which “Kale” did you mean?');

        expect(screen.getByText(en.statusExplainUnresolved)).toBeTruthy();
        expect(within(list).getAllByRole('button')[1]?.textContent).toContain('curly');
        fireEvent.click(within(list).getByRole('button', { name: 'Kale, raw' }));

        expect(onPick).toHaveBeenCalledExactlyOnceWith('catalog:food_kale');
    });

    it('a source’s foods come after, under a header naming the source, each named with its source (P5, P10)', () => {
        const { onPick } = renderBody(LISTED);

        expect(screen.getByRole('heading', { name: 'From USDA' })).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Kale, lacinato, from USDA' }));

        expect(onPick).toHaveBeenCalledExactlyOnceWith('remote:usda:sealed.l');
    });

    it('while the answer runs, the waiting line comes after the options and is polite (P12)', () => {
        renderBody(viewOf([databaseFrame({ catalog: [KALE] })], 'asking'));
        const waiting = screen.getByText(remote.stillSearching);

        expect(waiting.getAttribute('aria-live')).toBe('polite');
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

        expect(
            screen
                .getByText(`${en.ingredientAuthoredUnavailable} We couldn’t search USDA just now. Try again later.`)
                .getAttribute('aria-live'),
        ).toBe('polite');
    });

    // P2, P10: "append in the page, which keeps its scroll position".
    it.each(FRAME_SEQUENCES)('nothing already shown moves as frames arrive: $name', ({ frames }) => {
        const on = { onPick: vi.fn(), onRetryRead: vi.fn(), onNoneOfThese: vi.fn() };
        const { rerender } = render(
            <CandidatesPanelBody view={panelView(viewOf(frames.slice(0, 1), 'asking'))} {...on} />,
        );
        let shown = foodButtons();

        frames.slice(1).forEach((_frame, index) => {
            rerender(<CandidatesPanelBody view={panelView(viewOf(frames.slice(0, index + 2), 'asking'))} {...on} />);
            const now = foodButtons();

            expect(now.slice(0, shown.length)).toEqual(shown);
            shown = now;
        });
    });

    it('a pick in flight: the pressed food reads busy and refuses a press, and the others are unavailable', () => {
        const { onPick } = renderBody(LISTED, {
            inFlight: { kind: 'remoteFood', reference: 'sealed.l', name: 'Kale, lacinato', source: 'usda' },
        });
        const pressed = screen.getByRole('button', { name: 'Kale, lacinato, from USDA' });

        expect(pressed.getAttribute('aria-busy')).toBe('true');
        expect(screen.getByRole('button', { name: 'Kale, raw' }).getAttribute('aria-disabled')).toBe('true');
        fireEvent.click(pressed);
        expect(onPick).not.toHaveBeenCalled();
    });

    it.each<[string, EntrySearchView, string, string | null]>([
        ['loading', viewOf([], 'asking'), en.candidatesLoading, 'polite'],
        ['parked offline', { kind: 'offline' }, READ_OFFLINE, 'polite'],
        ['empty', viewOf([databaseFrame(), COMPLETE_FRAME]), en.candidatesEmpty, null],
    ])('%s: says so, and None of these is still the way on', (_case, view, text, live) => {
        renderBody(view);

        expect(screen.getByText(text).getAttribute('aria-live')).toBe(live);
        expect(screen.getByRole('button', { name: en.statusActionNoneOfThese })).toBeTruthy();
    });

    it('a failed read says so assertively, and Try again reads again', () => {
        const { onRetryRead } = renderBody(viewOf([]));

        expect(assertive()).toContain(en.candidatesLoadFailed);
        fireEvent.click(screen.getByRole('button', { name: en.statusActionRetry }));

        expect(onRetryRead).toHaveBeenCalledTimes(1);
    });

    it('a remote pick food refused is said assertively, and the list stays to choose again (P8)', () => {
        renderBody(LISTED, {
            lastPick: {
                pick: { kind: 'remoteFood', reference: 'sealed.l', name: 'Kale, lacinato', source: 'usda' },
                outcome: { kind: 'remoteGone' },
            },
        });

        expect(assertive()).toContain('Kale, lacinato isn’t available any more. Choose another food.');
        expect(screen.getByLabelText('Which “Kale” did you mean?')).toBeTruthy();
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
        const first = assertive().indexOf(LIMIT);

        rerender(<CandidatesPanelBody view={limited(2)} {...on} />);

        expect(first).not.toBe(-1);
        expect(assertive().indexOf(LIMIT)).not.toBe(-1);
        expect(assertive().indexOf(LIMIT)).not.toBe(first);
    });

    it('None of these hands the row back to the host and picks nothing', () => {
        const { onPick, onNoneOfThese } = renderBody(LISTED);

        fireEvent.click(screen.getByRole('button', { name: en.statusActionNoneOfThese }));

        expect(onNoneOfThese).toHaveBeenCalledTimes(1);
        expect(onPick).not.toHaveBeenCalled();
    });
});

/**
 * `docs/design/nativeContainerNames.md` N1 on the panel's groups. No text in our database's group says its name, so the
 * group carries it (rules 1 and 5), and a named View keeps its node so Android does not flatten the name away (N0, N3).
 * A source's group has a header naming the source, so the header carries the name and the group none (rule 2, N4).
 */
describe('CandidatesPanelBody (native) — N1: each group’s name is said once', () => {
    it('names our database’s group by its label, which no text in it says, and keeps that group’s node', () => {
        renderBody(LISTED);

        const name = 'Which “Kale” did you mean?';
        expect(screen.getAllByLabelText(name)).toHaveLength(1);
        expect(screen.queryAllByRole('heading', { name })).toEqual([]);
        const labelled = views.rendered.filter((props) => props.accessibilityLabel === name);
        expect(labelled).not.toEqual([]);
        expect(labelled.every((props) => props.collapsable === false)).toBe(true);
    });

    it('names a source’s group through its header alone, and labels no node with it', () => {
        renderBody(LISTED);

        expect(screen.getAllByRole('heading', { name: 'From USDA' })).toHaveLength(1);
        expect(screen.queryAllByLabelText('From USDA')).toEqual([]);
    });
});
