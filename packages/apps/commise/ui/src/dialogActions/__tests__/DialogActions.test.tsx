import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { DialogActions } from '../DialogActions.js';
import { dialogActionSlotClass } from '../dialogActionsClass.js';

afterEach(cleanup);

const tokensOf = (element: Element): string[] => (element.getAttribute('class') ?? '').split(/\s+/u).filter(Boolean);

const pair = (
    <>
        <button type="button">Keep</button>
        <button type="button">Do it</button>
    </>
);

/**
 * `DialogActions` (web): the one layout rule for a dialog or sheet's action row. jsdom evaluates no container query, so
 * the tests pin the literal classes the stylesheet answers to (Tailwind reads them as literals), and the order the
 * buttons are in the DOM, which is the focus order.
 */
describe('DialogActions (web)', () => {
    it('stacks the buttons, the main action on top, until the row is wide enough', () => {
        render(<DialogActions sideBySideFrom={400}>{pair}</DialogActions>);

        const row = screen.getByRole('button', { name: 'Keep' }).parentElement as HTMLElement;

        expect(tokensOf(row)).toContain('flex-col-reverse');
        expect(tokensOf(row)).not.toContain('flex-row');
    });

    it('sets them side by side from 400, end-aligned', () => {
        render(<DialogActions sideBySideFrom={400}>{pair}</DialogActions>);

        const row = screen.getByRole('button', { name: 'Keep' }).parentElement as HTMLElement;

        expect(tokensOf(row)).toEqual(
            expect.arrayContaining(['@[25rem]/dialog:flex-row', '@[25rem]/dialog:justify-end']),
        );
    });

    it('sets them side by side from 600, and from nowhere else', () => {
        render(<DialogActions sideBySideFrom={600}>{pair}</DialogActions>);

        const row = screen.getByRole('button', { name: 'Keep' }).parentElement as HTMLElement;
        const classes = tokensOf(row);

        expect(classes).toEqual(
            expect.arrayContaining(['@[37.5rem]/dialog:flex-row', '@[37.5rem]/dialog:justify-end']),
        );
        expect(classes.some((token) => token.includes('25rem'))).toBe(false);
    });

    it('measures its own box: the wrapper is the named container and the row is its child', () => {
        render(<DialogActions sideBySideFrom={400}>{pair}</DialogActions>);

        const row = screen.getByRole('button', { name: 'Keep' }).parentElement as HTMLElement;

        expect(tokensOf(row.parentElement as HTMLElement)).toEqual(
            expect.arrayContaining(['@container/dialog', 'w-full']),
        );
    });

    it('keeps the buttons in source order, dismiss first, so focus order does not depend on the layout', () => {
        render(<DialogActions sideBySideFrom={600}>{pair}</DialogActions>);

        const row = screen.getByRole('button', { name: 'Keep' }).parentElement as HTMLElement;

        expect([...row.querySelectorAll('button')].map((button) => button.textContent)).toStrictEqual([
            'Keep',
            'Do it',
        ]);
    });

    it('never fixes the width with nowrap', () => {
        render(<DialogActions sideBySideFrom={600}>{pair}</DialogActions>);

        const row = screen.getByRole('button', { name: 'Keep' }).parentElement as HTMLElement;

        expect(tokensOf(row)).not.toContain('flex-nowrap');
        expect(tokensOf(row)).not.toContain('whitespace-nowrap');
    });
});

describe('dialogActionSlotClass', () => {
    it('fills the stacked row and returns to its own width at the same threshold the row uses', () => {
        expect(dialogActionSlotClass(400)).toBe('w-full @[25rem]/dialog:w-auto');
        expect(dialogActionSlotClass(600)).toBe('w-full @[37.5rem]/dialog:w-auto');
    });
});
