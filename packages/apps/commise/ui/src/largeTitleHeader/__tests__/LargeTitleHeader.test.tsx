/**
 * The web LargeTitleHeader (buildSpec §3.3): the page's one H1, its focus target; the avatar action below 840 only;
 * at most one button and one ⋯; the back control, an eyebrow "‹ {parent}" at 840; the segments; and the DOM order
 * back → H1 → action → afterTitle (the floating button) a screen reader depends on.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { LargeTitleHeader } from '../LargeTitleHeader.js';

afterEach(cleanup);

describe('LargeTitleHeader (web)', () => {
    it('renders the title as the one level-1 heading, with its id', () => {
        render(<LargeTitleHeader headingId="recipes-title" title="Recipes" />);

        const heading = screen.getByRole('heading', { level: 1, name: 'Recipes' });

        expect(heading.id).toBe('recipes-title');
        expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    });

    it('shows a subtitle under the title', () => {
        render(<LargeTitleHeader headingId="h" title="Good afternoon" subtitle="Sunday 31 May" />);

        expect(screen.getByText('Sunday 31 May').tagName).toBe('P');
    });

    it('moves focus to the H1 when the focus signal advances', () => {
        const { rerender } = render(<LargeTitleHeader headingId="h" title="Recipes" focusSignal={0} />);

        rerender(<LargeTitleHeader headingId="h" title="Recipes" focusSignal={1} />);

        expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1 }));
    });

    it('puts the avatar action after the H1 in DOM order, and hides it from 840 (the sidebar has it)', () => {
        render(
            <LargeTitleHeader
                headingId="h"
                title="Recipes"
                action={{ kind: 'avatar', avatar: <button type="button">Profile</button> }}
                afterTitle={<button type="button">New recipe</button>}
            />,
        );

        const heading = screen.getByRole('heading', { level: 1 });
        const avatar = screen.getByRole('button', { name: 'Profile' });
        const fab = screen.getByRole('button', { name: 'New recipe' });

        expect(heading.compareDocumentPosition(avatar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(avatar.compareDocumentPosition(fab) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(avatar.parentElement?.className).toContain('nav:hidden');
    });

    it('keeps a controls action at every width', () => {
        render(
            <LargeTitleHeader
                headingId="h"
                title="Weeknight dinners"
                action={{
                    kind: 'controls',
                    button: <button type="button">Add recipes</button>,
                    menu: <button type="button">More</button>,
                }}
            />,
        );

        const group = screen.getByRole('button', { name: 'Add recipes' }).parentElement;

        expect(group?.className).not.toContain('nav:hidden');
        expect(screen.getByRole('button', { name: 'More' }).parentElement).toBe(group);
    });

    it('renders the back control as a link named "Back to {parent}", with the eyebrow text from 840', () => {
        const onPress = vi.fn();
        render(
            <LargeTitleHeader
                headingId="h"
                title="Weeknight dinners"
                back={{ label: 'Back to Collections', parent: 'Collections', href: '/en/collections', onPress }}
            />,
        );

        const link = screen.getByRole('link', { name: 'Back to Collections' });
        fireEvent.click(link);

        expect(onPress).toHaveBeenCalledOnce();
        expect(link.getAttribute('href')).toBe('/en/collections');
        expect(screen.getByText('Collections').className).toContain('nav:inline');
    });

    it('renders the segments under the title', () => {
        render(<LargeTitleHeader headingId="h" title="Recipes" segments={<nav aria-label="Recipes sections" />} />);

        expect(screen.getByRole('navigation', { name: 'Recipes sections' })).toBeTruthy();
    });
});
