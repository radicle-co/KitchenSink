/**
 * The web CondensedTitleBar (buildSpec §3.3): a fixed bar below 840 on the floating layer, repeating the title for sight
 * only, keeping back one tap away, and inert — no clicks, no focus — while hidden.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { CondensedTitleBar } from '../CondensedTitleBar.js';

afterEach(cleanup);

describe('CondensedTitleBar (web)', () => {
    it('repeats the title hidden from assistive tech, and keeps back one tap away', () => {
        const onPress = vi.fn();
        const { container } = render(
            <CondensedTitleBar
                title="Weeknight dinners"
                visible
                back={{ label: 'Back to Collections', parent: 'Collections', onPress }}
            />,
        );

        expect(screen.getByText('Weeknight dinners').getAttribute('aria-hidden')).toBe('true');
        fireEvent.click(screen.getByRole('button', { name: 'Back to Collections' }));
        expect(onPress).toHaveBeenCalledOnce();
        expect(container.querySelector('[data-material="bar"]')).not.toBeNull();
    });

    it('is inert and transparent while hidden, below 840 only', () => {
        const { container } = render(<CondensedTitleBar title="Weeknight dinners" visible={false} />);
        const bar = container.firstElementChild;

        expect(bar?.hasAttribute('inert')).toBe(true);
        expect(bar?.className).toContain('opacity-0');
        expect(bar?.className).toContain('nav:hidden');
        expect(container.querySelector('[data-material="none"]')).not.toBeNull();
    });
});
