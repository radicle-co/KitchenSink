// @vitest-environment jsdom
/**
 * The owner's "Needs review" control (web). Designer a11y ruling: the pill and its chevron are ONE accessible element —
 * one link, one full name, one focus stop — so a screen reader hears one control and Tab moves past it in one press.
 *
 * What these prove: the link carries the whole name ("Needs review: {food}"), nothing inside it is a second focus stop or
 * a second named element (the chevron is decorative), and it is the only tabbable thing in its row.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';

import { ReviewLineLink } from '../ReviewLineLink.js';

afterEach(cleanup);

describe('ReviewLineLink (web)', () => {
    it('is one link with one full name, holding the pill and the chevron', () => {
        render(<ReviewLineLink href="/en/recipes/r/edit#ingredients/3.1" food="Smoked Paprika" />);
        const link = screen.getByRole('link', { name: 'Needs review: Smoked Paprika' });

        expect(link.getAttribute('href')).toBe('/en/recipes/r/edit#ingredients/3.1');
        expect(screen.getAllByRole('link')).toHaveLength(1);
        // The chevron is decorative: no second named or focusable element inside the control.
        expect(link.querySelectorAll('a, button, [tabindex], [role="img"], img')).toHaveLength(0);
        expect(link.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    });

    it('is a single focus stop: one Tab lands on it, the next leaves it', async () => {
        const user = userEvent.setup();

        render(
            <div>
                <ReviewLineLink href="/edit#ingredients/3.1" food="Smoked Paprika" />
                <button type="button">after</button>
            </div>,
        );

        await user.tab();
        expect(document.activeElement).toBe(screen.getByRole('link', { name: 'Needs review: Smoked Paprika' }));
        await user.tab();
        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'after' }));
    });
});
