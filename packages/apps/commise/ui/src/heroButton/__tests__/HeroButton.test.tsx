/**
 * The web hero button (A-014; D12): the recipe page's Back and ⋯ discs over the photo. Back is a REAL link when it
 * has somewhere to go (⌘-click and open-in-new-tab keep working), a button otherwise; both are one 44 px `photoChip`
 * disc with a visible focus ring, named by the caller's label and never by the glyph.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { HERO_DISC_CLASS, HeroButton } from '../HeroButton.js';

afterEach(cleanup);

describe('HeroButton (web)', () => {
    it('is a button named by its label that reports a press from the keyboard', async () => {
        const onPress = vi.fn();
        const user = userEvent.setup();
        render(<HeroButton icon="ellipsis" label="More actions for Lamb" onPress={onPress} />);

        await user.tab();
        expect(screen.getByRole('button', { name: 'More actions for Lamb' })).toBe(document.activeElement);
        await user.keyboard('{Enter}');

        expect(onPress).toHaveBeenCalledTimes(1);
    });

    /**
     * Click `node` and report whether anything cancelled the browser's navigation by the time the event had bubbled
     * to the document. The document listener then cancels it itself, because jsdom cannot navigate.
     */
    function clickReportingCancel(node: HTMLElement, init?: MouseEventInit): boolean {
        let cancelled = false;

        const settle = (event: Event): void => {
            cancelled = event.defaultPrevented;
            event.preventDefault();
        };

        document.addEventListener('click', settle);
        fireEvent.click(node, init);
        document.removeEventListener('click', settle);

        return cancelled;
    }

    it('is a real LINK when it has an address, and a plain click goes to onPress with the navigation cancelled', () => {
        const onPress = vi.fn();
        render(<HeroButton icon="chevronLeft" label="Back to My recipes" href="/en/recipes" onPress={onPress} />);

        const link = screen.getByRole('link', { name: 'Back to My recipes' });
        const cancelled = clickReportingCancel(link);

        expect(link.getAttribute('href')).toBe('/en/recipes');
        expect(onPress).toHaveBeenCalledTimes(1);
        expect(cancelled).toBe(true);
    });

    it('leaves a modified click to the browser, so open-in-new-tab keeps working', () => {
        const onPress = vi.fn();
        render(<HeroButton icon="chevronLeft" label="Back to My recipes" href="/en/recipes" onPress={onPress} />);

        const cancelled = clickReportingCancel(screen.getByRole('link', { name: 'Back to My recipes' }), {
            metaKey: true,
        });

        expect(onPress).not.toHaveBeenCalled();
        expect(cancelled).toBe(false);
    });

    it('is a solid 44 px photoChip disc with no blur and a focus ring', () => {
        render(<HeroButton icon="chevronLeft" label="Back to My recipes" href="/en/recipes" onPress={vi.fn()} />);
        const classes = screen.getByRole('link', { name: 'Back to My recipes' }).className.split(' ');

        expect(classes).toEqual(expect.arrayContaining(['size-11', 'rounded-full', 'bg-photo-chip']));
        expect(classes.some((name) => name.startsWith('backdrop-blur'))).toBe(false);
        expect(classes).toContain('focus-visible:ring-2');
        expect(HERO_DISC_CLASS.split(' ')).toEqual(expect.arrayContaining(['size-11', 'rounded-full']));
    });

    it('hides its glyph from assistive technology', () => {
        render(<HeroButton icon="ellipsis" label="More actions" onPress={vi.fn()} />);

        expect(
            screen.getByRole('button', { name: 'More actions' }).querySelector('svg')?.getAttribute('aria-hidden'),
        ).toBe('true');
    });
});
