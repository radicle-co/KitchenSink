/**
 * `focusIfLost` moves focus only when doing so cannot take it from somewhere the person put it: when focus has
 * fallen to <body> (the control holding it was removed), or is still inside the region that owns the move.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { focusIfLost } from '../focusIfLost.js';

afterEach(() => {
    cleanup();
});

function renderRegion(): { readonly target: HTMLElement; readonly region: HTMLElement; readonly outside: HTMLElement } {
    render(
        <>
            <section aria-label="Picker">
                <input aria-label="Search" />
                <button type="button">Inside</button>
            </section>
            <button type="button">Outside</button>
        </>,
    );

    return {
        target: screen.getByLabelText('Search'),
        region: screen.getByRole('region', { name: 'Picker' }),
        outside: screen.getByRole('button', { name: 'Outside' }),
    };
}

describe('focusIfLost', () => {
    it('takes focus when it has fallen to <body>', () => {
        const { target } = renderRegion();

        focusIfLost(target);

        expect(document.activeElement).toBe(target);
    });

    it('takes focus from inside the owning region', () => {
        const { target, region } = renderRegion();
        screen.getByRole('button', { name: 'Inside' }).focus();

        focusIfLost(target, region);

        expect(document.activeElement).toBe(target);
    });

    it('⛔ leaves focus where the person put it, outside the owning region', () => {
        const { target, region, outside } = renderRegion();
        outside.focus();

        focusIfLost(target, region);

        expect(document.activeElement).toBe(outside);
    });

    it('with no region, leaves any focus that is not on <body> alone', () => {
        const { target, outside } = renderRegion();
        outside.focus();

        focusIfLost(target);

        expect(document.activeElement).toBe(outside);
    });

    it('does nothing for a target that is not mounted', () => {
        renderRegion();

        expect(() => focusIfLost(null)).not.toThrow();
        expect(document.activeElement).toBe(document.body);
    });
});
