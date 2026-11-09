/**
 * Component tests for the native `FoodPageView`: the twelve states of the private foods spec on the React Native leaf,
 * the same copy as the web leaf (`foodPageCopy.test.ts` pins the words once), plus what is native-only: the primary
 * action leads on a phone, and the actions are reachable by role.
 */
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { render } from '@commise/ui/testing/tamagui';

import { makeFood, makeOwnState, makeRequest, makeViewProps } from '../__fixtures__/foodPageFixtures.js';
import { FoodPageView } from '../FoodPageView.native.js';
import type { FoodPageState } from '../foodPageState.js';

const windowWidth = vi.hoisted(() => ({ current: 390 }));

vi.mock('react-native', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-native')>();

    return { ...actual, useWindowDimensions: () => ({ ...actual.useWindowDimensions(), width: windowWidth.current }) };
});

afterEach(cleanup);

const view = (state: FoodPageState, handlers = {}) => render(<FoodPageView {...makeViewProps(state, handlers)} />);

describe('FoodPageView (native): states 1 to 4', () => {
    it('1 loading names what loads', () => {
        view({ kind: 'loading' });

        expect(screen.getByText('Loading food')).toBeTruthy();
    });

    it('2 not found leaves through its one way out', () => {
        const onLeave = vi.fn();
        view({ kind: 'notFound' }, { onLeave, leaveLabel: 'Back to Edit recipe' });

        expect(screen.getByText('Food not found')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Back to Edit recipe' }));
        expect(onLeave).toHaveBeenCalledOnce();
    });

    it('3 error retries', () => {
        const onRetry = vi.fn();
        view({ kind: 'error' }, { onRetry });

        fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
        expect(onRetry).toHaveBeenCalledOnce();
    });

    it('4 offline with no copy has no control', () => {
        view({ kind: 'offline' });

        expect(screen.queryByRole('button')).toBeNull();
    });
});

describe('FoodPageView (native): the author states', () => {
    it('5 private: Ask leads (primary on top on a phone), then Edit, then Withdraw set apart', () => {
        view(makeOwnState('private', { request: undefined }));
        const names = screen
            .getAllByRole('button')
            .map((button) => button.getAttribute('aria-label') ?? button.textContent);

        expect(names.indexOf('Ask to make public')).toBeLessThan(names.indexOf('Edit'));
        expect(names.indexOf('Edit')).toBeLessThan(names.indexOf('Withdraw'));
    });

    it('5 Ask calls onAsk', () => {
        const onAsk = vi.fn();
        view(makeOwnState('private', { request: undefined }), { onAsk });

        fireEvent.click(screen.getByRole('button', { name: 'Ask to make public' }));
        expect(onAsk).toHaveBeenCalledOnce();
    });

    it('6 asked has no Ask and shows the date', () => {
        view(makeOwnState('asked', { request: makeRequest({ status: 'pending', declineReason: null }) }));

        expect(screen.queryByRole('button', { name: 'Ask to make public' })).toBeNull();
        expect(screen.getByText(/You asked to make this food public on Nov 9, 2026/u)).toBeTruthy();
    });

    it('7 not approved shows the staff reason and offers Edit, not Ask', () => {
        view(makeOwnState('notApproved'));

        expect(screen.getByText('Their reason: The calories look too low.')).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Ask to make public' })).toBeNull();
        expect(screen.getByRole('button', { name: 'Edit' })).toBeTruthy();
    });

    it('8 public', () => {
        view(makeOwnState('public', { request: undefined }));

        expect(screen.getByText('Anyone can find and use this food.')).toBeTruthy();
    });

    it('9 edit waiting lists only the changed field, as one spoken phrase', () => {
        view(makeOwnState('editWaiting', { request: makeRequest({ status: 'pending', declineReason: null }) }));

        expect(screen.getByText('Your edit')).toBeTruthy();
        expect(screen.getByLabelText('Calories: public 120 kcal, your edit 135 kcal')).toBeTruthy();
        expect(screen.getByText('Nothing else changes.')).toBeTruthy();
    });

    it('10 edit not approved', () => {
        view(makeOwnState('editNotApproved'));

        expect(screen.getByText('Edit not approved')).toBeTruthy();
    });

    it('11 withdrawn has no button at all', () => {
        view(makeOwnState('withdrawn', { request: undefined }));

        expect(screen.queryByRole('button')).toBeNull();
    });

    it('12 another cook’s public food has the facts and no button', () => {
        view({ kind: 'othersPublic', food: makeFood() });

        expect(screen.getByText('Public')).toBeTruthy();
        expect(screen.queryByRole('button')).toBeNull();
    });

    it('a cached copy offline disables the actions', () => {
        view(makeOwnState('private', { request: undefined, actionsDisabled: true }));

        expect(screen.getByRole('button', { name: 'Edit' }).getAttribute('aria-disabled')).toBe('true');
    });

    it('Withdraw opens its confirmation, which names the food', () => {
        const onWithdraw = vi.fn();
        view(makeOwnState('public', { request: undefined }), { onWithdraw });

        fireEvent.click(screen.getByRole('button', { name: 'Withdraw' }));
        expect(onWithdraw).toHaveBeenCalledOnce();
    });

    it('the open confirmation reads the public body and its buttons call back', () => {
        const onWithdrawConfirm = vi.fn();
        const onWithdrawKeep = vi.fn();
        view(makeOwnState('public', { request: undefined }), {
            withdraw: { open: true, busy: false, failed: false },
            onWithdrawConfirm,
            onWithdrawKeep,
        });

        expect(screen.getByText('Withdraw Oat milk?')).toBeTruthy();
        expect(screen.getByText(/No one will be able to find it/u)).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Keep food' }));
        expect(onWithdrawKeep).toHaveBeenCalledOnce();
        fireEvent.click(screen.getByRole('button', { name: 'Withdraw food' }));
        expect(onWithdrawConfirm).toHaveBeenCalledOnce();
    });
});

describe('FoodPageView (native): where the actions sit (spec section 5.3)', () => {
    /** The status panel: the statement's own container. */
    const panelOf = () => screen.getByText(/Only you can see this food/u).parentElement as HTMLElement;

    const at = (width: number) => {
        windowWidth.current = width;
    };

    afterEach(() => at(390));

    it('from 600 dp the actions are inside the status panel, under its text, the primary last', () => {
        at(800);
        view(makeOwnState('private', { request: undefined }));
        const panel = panelOf();
        const buttons = within(panel)
            .getAllByRole('button')
            .map((button) => button.textContent);

        expect(buttons).toEqual(['Edit', 'Ask to make public']);
        // The text comes first, then the actions.
        expect(panel.firstElementChild?.textContent).toMatch(/Only you can see this food/u);
    });

    it('on a phone the actions are outside the panel, stacked with the primary on top', () => {
        at(375);
        view(makeOwnState('private', { request: undefined }));

        expect(within(panelOf()).queryByRole('button')).toBeNull();
        const names = screen.getAllByRole('button').map((button) => button.textContent);

        expect(names.indexOf('Ask to make public')).toBeLessThan(names.indexOf('Edit'));
    });
});
