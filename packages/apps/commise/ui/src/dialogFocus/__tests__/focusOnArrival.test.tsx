/**
 * `focusOnArrival` moves focus to content that has just arrived in a dialog, unless the person already put focus
 * somewhere in it. The dialog's title (where the `Sheet` puts focus on open) and the dialog element itself (where
 * Radix leaves focus when the focused control unmounts) do not count as a place the person chose.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { focusOnArrival } from '../focusOnArrival.js';

afterEach(() => {
    cleanup();
});

function renderDialog(): {
    readonly dialog: HTMLElement;
    readonly title: HTMLElement;
    readonly target: HTMLElement;
    readonly close: HTMLElement;
    readonly outside: HTMLElement;
} {
    render(
        <>
            <button type="button">Opener</button>
            <div role="dialog" aria-labelledby="title food" tabIndex={-1}>
                <h2 id="title" tabIndex={-1}>
                    Add details
                </h2>
                <p id="food">beef brisket</p>
                <button type="button">Close details</button>
                <input aria-label="Search 40 options" />
            </div>
        </>,
    );

    return {
        dialog: screen.getByRole('dialog'),
        title: screen.getByRole('heading', { name: 'Add details' }),
        target: screen.getByLabelText('Search 40 options'),
        close: screen.getByRole('button', { name: 'Close details' }),
        outside: screen.getByRole('button', { name: 'Opener' }),
    };
}

describe('focusOnArrival', () => {
    it('takes focus from outside the dialog: content that mounts with the dialog focuses itself', () => {
        const { target, outside } = renderDialog();

        outside.focus();
        focusOnArrival(target);

        expect(document.activeElement).toBe(target);
    });

    it('takes focus from the title, where the Sheet put it while the content loaded', () => {
        const { target, title } = renderDialog();

        title.focus();
        focusOnArrival(target);

        expect(document.activeElement).toBe(target);
    });

    it('takes focus from the dialog element, where Radix leaves it when the focused control unmounts', () => {
        const { target, dialog } = renderDialog();

        dialog.focus();
        focusOnArrival(target);

        expect(document.activeElement).toBe(target);
    });

    it('takes focus when it has fallen to <body>', () => {
        const { target } = renderDialog();

        focusOnArrival(target);

        expect(document.activeElement).toBe(target);
    });

    it('never takes focus from a control the person chose inside the dialog', () => {
        const { target, close } = renderDialog();

        close.focus();
        focusOnArrival(target);

        expect(document.activeElement).toBe(close);
    });

    it('does nothing for a target that is not mounted', () => {
        const { close } = renderDialog();

        close.focus();
        focusOnArrival(null);

        expect(document.activeElement).toBe(close);
    });
});
