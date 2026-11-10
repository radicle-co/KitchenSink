// @vitest-environment jsdom
/**
 * Component tests for the web `FoodPageView`: each of the twelve states (private foods spec section 5), the actions that
 * belong to it and no others, the Withdraw confirmation, and the ask’s busy and failed lines. The words are pinned in
 * `foodPageCopy.test.ts`; these assert what is on screen and what a press calls.
 */
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { buttonSurfaceClass } from '@commise/ui/button';

import { makeFood, makeOwnState, makeRequest, makeViewProps } from '../__fixtures__/foodPageFixtures.js';
import { FoodPageView } from '../FoodPageView.js';
import type { FoodPageState } from '../foodPageState.js';

afterEach(cleanup);

const view = (state: FoodPageState, handlers = {}) => render(<FoodPageView {...makeViewProps(state, handlers)} />);

describe('FoodPageView (web): states 1 to 4', () => {
    it('1 loading: a status that says what loads', () => {
        view({ kind: 'loading' });

        expect(screen.getByText('Loading food')).toBeTruthy();
    });

    it('2 not found: the notice says nothing about why, and its one way out leaves', async () => {
        const onLeave = vi.fn();
        view({ kind: 'notFound' }, { onLeave });

        expect(screen.getByText('Food not found')).toBeTruthy();
        expect(screen.getAllByText('It was removed, or the link is wrong.').length).toBeGreaterThan(0);
        await userEvent.click(screen.getByRole('button', { name: 'Go to My recipes' }));
        expect(onLeave).toHaveBeenCalledOnce();
    });

    it('3 error: a retry that retries', async () => {
        const onRetry = vi.fn();
        view({ kind: 'error' }, { onRetry });

        expect(screen.getByText('We couldn’t load this food')).toBeTruthy();
        await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
        expect(onRetry).toHaveBeenCalledOnce();
    });

    it('4 offline with no copy: the read-offline notice, with no retry control', () => {
        view({ kind: 'offline' });

        expect(screen.queryByRole('button')).toBeNull();
    });
});

describe('FoodPageView (web): the author states', () => {
    it('5 private: badge, statement, Edit and Ask, and Withdraw set apart; Ask calls onAsk', async () => {
        const onAsk = vi.fn();
        view(makeOwnState('private', { request: undefined }), { onAsk });

        expect(screen.getByText('Private')).toBeTruthy();
        expect(screen.getByText(/Only you can see this food/u)).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Edit' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Withdraw' })).toBeTruthy();
        await userEvent.click(screen.getByRole('button', { name: 'Ask to make public' }));
        expect(onAsk).toHaveBeenCalledOnce();
    });

    it('6 asked: no Ask button, and the date of the ask', () => {
        view(makeOwnState('asked', { request: makeRequest({ status: 'pending', declineReason: null }) }));

        expect(screen.queryByRole('button', { name: 'Ask to make public' })).toBeNull();
        expect(screen.getByText('Waiting for review')).toBeTruthy();
        expect(screen.getByText(/You asked to make this food public on Nov 9, 2026/u)).toBeTruthy();
    });

    it('7 not approved: staff’s reason is on screen, Edit is offered, Ask is not', () => {
        view(makeOwnState('notApproved'));

        expect(screen.getByText('Their reason: The calories look too low.')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Edit' })).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Ask to make public' })).toBeNull();
    });

    it('8 public: the public statement and Edit', () => {
        view(makeOwnState('public', { request: undefined }));

        expect(screen.getByText('Anyone can find and use this food.')).toBeTruthy();
    });

    it('9 edit waiting: "Your edit" lists only the changed field, read as one phrase, and the public figures stay', () => {
        view(makeOwnState('editWaiting', { request: makeRequest({ status: 'pending', declineReason: null }) }));

        expect(screen.getByRole('heading', { name: 'Your edit' })).toBeTruthy();
        expect(screen.getByLabelText('Calories: public 120 kcal, your edit 135 kcal')).toBeTruthy();
        expect(screen.getAllByText('120 kcal').length).toBeGreaterThan(0);
        expect(screen.getByText('Nothing else changes.')).toBeTruthy();
    });

    it('10 edit not approved: the reason, and Edit', () => {
        view(makeOwnState('editNotApproved'));

        expect(screen.getByText('Edit not approved')).toBeTruthy();
        expect(screen.getByText('Their reason: The calories look too low.')).toBeTruthy();
    });

    it('11 withdrawn: facts only, with no action and no Withdraw', () => {
        view(makeOwnState('withdrawn', { request: undefined }));

        expect(screen.getByText('Withdrawn')).toBeTruthy();
        expect(screen.queryByRole('button')).toBeNull();
    });

    it('12 another cook’s public food: the facts and nothing to press', () => {
        view({ kind: 'othersPublic', food: makeFood() });

        expect(screen.getByText('Public')).toBeTruthy();
        expect(screen.queryByRole('button')).toBeNull();
    });

    it('shows the four figures under "Nutrition per 100 g" and the portion', () => {
        view(makeOwnState('public', { request: undefined }));
        const section = screen.getByRole('heading', { name: 'Nutrition per 100 g' }).parentElement!;

        expect(within(section).getByText('120 kcal')).toBeTruthy();
        expect(within(section).getByText('3 g')).toBeTruthy();
        expect(screen.getByText('1 cup · 240 g')).toBeTruthy();
    });

    it('a cached copy offline disables the actions and says why', () => {
        view(makeOwnState('private', { request: undefined, actionsDisabled: true }));

        expect(screen.getAllByText('Editing and asking need a connection.').length).toBeGreaterThan(0);
        expect((screen.getByRole('button', { name: 'Edit' }) as HTMLButtonElement).disabled).toBe(true);
    });

    it('while the ask is in flight the Ask button reads Sending…, and a failed ask says so', () => {
        const { rerender } = view(makeOwnState('private', { request: undefined }), { ask: 'busy' });

        expect(screen.getByRole('button', { name: /Sending…/u })).toBeTruthy();
        rerender(
            <FoodPageView {...makeViewProps(makeOwnState('private', { request: undefined }), { ask: 'failed' })} />,
        );
        expect(screen.getByRole('alert').textContent).toBe('We couldn’t send your ask.');
    });
});

describe('FoodPageView (web): Withdraw', () => {
    it('Withdraw opens the confirmation through onWithdraw', async () => {
        const onWithdraw = vi.fn();
        view(makeOwnState('private', { request: undefined }), { onWithdraw });

        await userEvent.click(screen.getByRole('button', { name: 'Withdraw' }));
        expect(onWithdraw).toHaveBeenCalledOnce();
    });

    it('the confirmation names the food and uses the state’s body; Keep keeps, confirm withdraws', async () => {
        const onWithdrawConfirm = vi.fn();
        const onWithdrawKeep = vi.fn();
        view(makeOwnState('asked', { request: makeRequest({ status: 'pending', declineReason: null }) }), {
            withdraw: { open: true, busy: false, failed: false },
            onWithdrawConfirm,
            onWithdrawKeep,
        });
        const dialog = screen.getByRole('alertdialog', { name: 'Withdraw Oat milk?' });

        expect(within(dialog).getByText(/Your ask to make it public is cancelled/u)).toBeTruthy();
        await userEvent.click(within(dialog).getByRole('button', { name: 'Keep food' }));
        expect(onWithdrawKeep).toHaveBeenCalledOnce();
        await userEvent.click(within(dialog).getByRole('button', { name: 'Withdraw food' }));
        expect(onWithdrawConfirm).toHaveBeenCalledOnce();
    });

    it('a failed withdraw shows its error inside the dialog', () => {
        view(makeOwnState('public', { request: undefined }), { withdraw: { open: true, busy: false, failed: true } });

        expect(screen.getByText('We couldn’t withdraw this food.')).toBeTruthy();
    });
});

describe('FoodPageView (web): where the actions sit (spec section 5.3)', () => {
    /** jsdom applies no stylesheet, so the layout is asserted through the classes that carry it. */
    const group = () => screen.getByRole('button', { name: 'Edit' }).closest('[data-actions]') as HTMLElement;

    it('the actions are inside the status panel, under its text, so from 600 they read as part of it', () => {
        view(makeOwnState('private', { request: undefined }));
        const panel = screen.getByText(/Only you can see this food/u).closest('section') as HTMLElement;

        expect(within(panel).getByRole('button', { name: 'Edit' })).toBeTruthy();
        expect(within(panel).getByRole('button', { name: 'Ask to make public' })).toBeTruthy();
    });

    it('on a phone they stack full width with the primary on top; from 600 they are a row with the primary last', () => {
        view(makeOwnState('private', { request: undefined }));
        const classes = group().className;

        expect(classes).toContain('flex-col-reverse');
        expect(classes).toContain('@regular/main:flex-row');
        expect(classes).toContain('@regular/main:justify-end');

        // Each action is a full-width cell on a phone and its content's width from 600.
        for (const name of ['Edit', 'Ask to make public']) {
            expect(screen.getByRole('button', { name }).closest('[data-action]')?.className).toContain(
                'w-full @regular/main:w-auto',
            );
        }
    });

    it('draws the actions at the large size, 52 px tall', () => {
        view(makeOwnState('private', { request: undefined }));
        const ask = screen.getByRole('button', { name: 'Ask to make public' });

        expect(ask.className).toContain(buttonSurfaceClass('primary', { size: 'lg' }));
        expect(screen.getByRole('button', { name: 'Edit' }).className).toContain(
            buttonSurfaceClass('secondary', { size: 'lg' }),
        );
    });

    it('inside the panel the text comes first from 600: nothing is ordered above the statement', () => {
        view(makeOwnState('private', { request: undefined }));
        const statement = screen.getByText(/Only you can see this food/u).parentElement as HTMLElement;
        const actions = group();

        // The order classes that move the actions to the end of a phone page are reset together from 600, so the DOM order
        // (statement, then actions) is the reading and the visual order in the panel.
        expect(statement.className).toContain('@regular/main:order-none');
        expect(actions.className).toContain('@regular/main:order-none');
        expect(statement.nextElementSibling).toBe(actions);
    });
});

describe('FoodPageView (web): the phone and tablet split uses the house container variant', () => {
    it('switches on @regular/main: (600 on the content width), never the viewport sm: (640)', () => {
        const { container } = render(
            <FoodPageView {...makeViewProps(makeOwnState('private', { request: undefined }))} />,
        );
        const classes = Array.from(container.querySelectorAll('[class]'))
            .map((node) => node.getAttribute('class'))
            .join(' ');

        expect(classes).toContain('@regular/main:flex-row');
        expect(classes).not.toMatch(/(^|\s)sm:/u);
    });
});
