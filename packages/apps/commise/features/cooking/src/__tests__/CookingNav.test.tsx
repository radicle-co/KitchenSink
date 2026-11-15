import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { CookingNav } from '../CookingNav.js';
import type { CookingNavProps } from '../cookingViewProps.js';
import { NARROW_ROW } from '../cookingLayout.js';
import { htmlElementOf } from '../__fixtures__/htmlElementOf.js';

/**
 * The web Back / forward pair. The strings are inputs, so these
 * tests assert structure: names, order, which control is filled, and the disabled state. Copy is asserted where it is
 * made, in the CookingScreen tests.
 */
function props(over: Partial<CookingNavProps> = {}): CookingNavProps {
    return {
        back: { label: 'Back', accessibilityLabel: 'Back to step 1', onPress: vi.fn() },
        forward: { label: 'Next step', accessibilityLabel: 'Next step, step 3', onPress: vi.fn(), tone: 'quiet' },
        disabled: false,
        ...over,
    };
}

const buttons = (): HTMLElement[] => within(screen.getByRole('navigation')).getAllByRole('button');

describe('CookingNav', () => {
    it('names each control by its accessible name, and keeps the visible label inside it', () => {
        render(<CookingNav {...props()} />);

        const back = screen.getByRole('button', { name: 'Back to step 1' });
        const next = screen.getByRole('button', { name: 'Next step, step 3' });

        expect(back.textContent).toContain('Back');
        expect(next.textContent).toContain('Next step');
    });

    it('puts forward on the right and last in reading order', () => {
        render(<CookingNav {...props()} />);

        expect(buttons().map((button) => button.getAttribute('aria-label'))).toEqual([
            'Back to step 1',
            'Next step, step 3',
        ]);
    });

    it('draws the pair as two equal halves of one row', () => {
        render(<CookingNav {...props()} />);
        const row = htmlElementOf(screen.getByRole('navigation').firstElementChild);

        expect(row.className).toContain('grid-cols-2');
    });

    it('hides both chevrons under 360, never the labels', () => {
        render(<CookingNav {...props()} />);
        const row = htmlElementOf(screen.getByRole('navigation').firstElementChild);

        expect(row.className).toContain(NARROW_ROW.navWebClassName);
        expect(buttons()[0]?.querySelector('svg')).not.toBeNull();
        expect(buttons()[1]?.querySelector('svg')).not.toBeNull();
    });

    it('fills neither control while forward is quiet', () => {
        render(<CookingNav {...props()} />);

        expect(buttons().filter((button) => button.className.includes('bg-action'))).toHaveLength(0);
    });

    it('fills only the forward control when it is the action now', () => {
        render(<CookingNav {...props({ forward: { label: 'Start step 3', onPress: vi.fn(), tone: 'filled' } })} />);

        const filled = buttons().filter((button) => button.className.includes('bg-action'));

        expect(filled).toHaveLength(1);
        expect(filled[0]?.textContent).toContain('Start step 3');
    });

    it('calls the right handler for each control', () => {
        const back = vi.fn();
        const forward = vi.fn();
        render(
            <CookingNav
                {...props({
                    back: { label: 'Back', onPress: back },
                    forward: { label: 'Finish', onPress: forward, tone: 'quiet' },
                })}
            />,
        );

        fireEvent.click(screen.getByRole('button', { name: 'Finish' }));
        expect(forward).toHaveBeenCalledTimes(1);
        expect(back).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: 'Back' }));
        expect(back).toHaveBeenCalledTimes(1);
    });

    it('draws both controls disabled while the recipe loads, and presses nothing', () => {
        const back = vi.fn();
        const forward = vi.fn();
        render(
            <CookingNav
                {...props({
                    back: { label: 'Back', onPress: back },
                    forward: { label: 'Next step', onPress: forward, tone: 'quiet' },
                    disabled: true,
                })}
            />,
        );

        for (const button of buttons()) {
            expect(button.hasAttribute('disabled') || button.getAttribute('aria-disabled') === 'true').toBe(true);
            fireEvent.click(button);
        }

        expect(back).not.toHaveBeenCalled();
        expect(forward).not.toHaveBeenCalled();
    });
});
