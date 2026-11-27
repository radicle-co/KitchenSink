/**
 * The native editor header at large text sizes (designer ruling "fixed frames that hold scaled text", 2026-11-02):
 * only the bar's title may truncate, because the page's H1 repeats it. The save status shows nowhere else, so it wraps
 * to a second line and the bar grows to hold it.
 */
import { renderWithTamagui } from '@commise/ui/testing/tamagui';
import { nativeTokens } from '@commise/ui/native';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EditorHeader } from '../EditorHeader.native.js';

const STATUS = 'Saved on Monday, 2 November 2026 at 3:41 PM';

/** The largest system text scale the app is held to (the iOS accessibility cap, designer shot Title_light_cap). */
const CAP_SCALE = 3.1;

const drawHeader = (scale = 1): void => {
    renderWithTamagui(
        <EditorHeader title="Edit recipe" status={STATUS} closeLabel="Close editor" onClose={() => undefined} />,
        'light',
        scale,
    );
};

describe('EditorHeader.native: scaled text', () => {
    afterEach(cleanup);

    it('lets the save status wrap: it carries no line clamp and no ellipsis', () => {
        drawHeader();

        const status = screen.getByText(STATUS);

        expect(getComputedStyle(status).textOverflow).not.toBe('ellipsis');
        expect(getComputedStyle(status).whiteSpace).not.toBe('nowrap');
    });

    it('still lets the bar title truncate, because the H1 repeats it', () => {
        drawHeader();

        const title = screen.getByRole('heading', { name: 'Edit recipe' });

        expect(getComputedStyle(title).textOverflow).toBe('ellipsis');
    });

    it('draws the status as bar chrome at the cap: no larger than the bar title, and at most 1.5x of meta', () => {
        drawHeader(CAP_SCALE);

        const status = Number.parseFloat(getComputedStyle(screen.getByText(STATUS)).fontSize);
        const title = Number.parseFloat(
            getComputedStyle(screen.getByRole('heading', { name: 'Edit recipe' })).fontSize,
        );

        expect(status).toBe(nativeTokens.type.meta.fontSize * 1.5);
        expect(status).toBeLessThanOrEqual(title);
    });

    it('gives the bar a minimum height and no fixed one, so a second line grows it', () => {
        drawHeader();

        // TEST-CHANGE (decisions/0118 addendum 1): the bar is the nearest ancestor of the close button that holds the
        // title, so the row does not depend on how deep the icon button nests its button.
        const heading = screen.getByRole('heading', { name: 'Edit recipe' });
        let bar = screen.getByRole('button', { name: 'Close editor' }).parentElement;

        while (bar !== null && !bar.contains(heading)) {
            bar = bar.parentElement;
        }

        if (bar === null) {
            throw new Error('No ancestor of the close button holds the title.');
        }

        expect(bar.className).toMatch(/r-minHeight-/);
        expect(bar.className).not.toMatch(/r-height-/);
        expect(bar.getAttribute('style') ?? '').not.toMatch(/(^|[^-])height:\s*\d/);
    });
});

describe('EditorHeader.native: the close control', () => {
    afterEach(cleanup);

    // CL-ICONBTN: × is the shared icon button: a 24 glyph in ink, and one press reports once.
    it('is the shared icon button, and reports a press once', () => {
        const onClose = vi.fn();
        renderWithTamagui(
            <EditorHeader title="Edit recipe" status={STATUS} closeLabel="Close editor" onClose={onClose} />,
            'light',
        );
        const glyph = document.querySelector<HTMLElement>('[data-commise-stub="icon"]');

        fireEvent.click(screen.getByRole('button', { name: 'Close editor' }));

        expect(onClose).toHaveBeenCalledTimes(1);
        expect(glyph?.dataset['iconSize']).toBe('24');

        const circle = screen.getByRole('button', { name: 'Close editor' }).firstElementChild?.firstElementChild;

        expect(circle === undefined || circle === null ? '' : getComputedStyle(circle).width).toBe('44px');
    });
});
