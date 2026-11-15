/**
 * The native Back / Next pair: a navigation landmark of two
 * equal 52 pt buttons, Back first and Next last in reading order, each named by its own accessible name, which contains
 * its visible label (WCAG 2.5.3). Next is filled only when the screen hands it the action now (Start step n, or Finish
 * once every line is ticked). The labels and names are resolved by the screen; this leaf only draws them.
 *
 * Props are the shared contract's (`cookingViewProps.ts`) plus native's `narrow`, which the screen reads, because a leaf never reads the device. Every case of the old
 * suite is kept, rewritten from `forward.filled` and `chevrons`.
 */
import { BUTTON_VISUAL_HEIGHT } from '@commise/ui/button';
import { render } from '@commise/ui/testing/tamagui';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CookingNav, type NativeCookingNavProps } from '../CookingNav.native.js';
import { glyphCount, pillOf } from './utils/buttonPill.js';

afterEach(cleanup);

function navProps(overrides: Partial<NativeCookingNavProps> = {}): NativeCookingNavProps {
    return {
        back: { label: 'Back', accessibilityLabel: 'Back to step 1', onPress: vi.fn() },
        forward: { label: 'Next step', accessibilityLabel: 'Next step, step 3', tone: 'quiet', onPress: vi.fn() },
        disabled: false,
        narrow: false,
        ...overrides,
    };
}

describe('CookingNav (native)', () => {
    it('is a navigation landmark holding Back then Next', () => {
        render(<CookingNav {...navProps()} />);

        const nav = screen.getByRole('navigation');

        expect(nav.contains(screen.getByRole('button', { name: 'Back to step 1' }))).toBe(true);
        expect(nav.contains(screen.getByRole('button', { name: 'Next step, step 3' }))).toBe(true);
    });

    it('draws Back then Next, each named by its accessible name, which contains its visible label', () => {
        render(<CookingNav {...navProps()} />);

        const buttons = screen.getAllByRole('button');
        const back = screen.getByRole('button', { name: 'Back to step 1' });
        const next = screen.getByRole('button', { name: 'Next step, step 3' });

        expect(buttons.indexOf(back)).toBeLessThan(buttons.indexOf(next));
        expect(back.textContent).toContain('Back');
        expect(next.textContent).toContain('Next step');
    });

    it('reports a press of each to its own handler', () => {
        const props = navProps();
        render(<CookingNav {...props} />);

        fireEvent.click(screen.getByRole('button', { name: 'Back to step 1' }));
        expect(props.back.onPress).toHaveBeenCalledTimes(1);
        expect(props.forward.onPress).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: 'Next step, step 3' }));
        expect(props.forward.onPress).toHaveBeenCalledTimes(1);
    });

    // On step 1 Back stays enabled and leaves to the recipe, so the way out is always the same control.
    it('keeps Back enabled on step 1, named for the recipe', () => {
        render(
            <CookingNav
                {...navProps({
                    back: { label: 'Back', accessibilityLabel: 'Back to the recipe', onPress: vi.fn() },
                })}
            />,
        );

        const back = screen.getByRole('button', { name: 'Back to the recipe' });

        expect(back.getAttribute('aria-disabled')).not.toBe('true');
    });

    it('draws both at the lg height (52), never a new size', () => {
        render(<CookingNav {...navProps()} />);

        for (const name of ['Back to step 1', 'Next step, step 3']) {
            expect(getComputedStyle(pillOf(screen.getByRole('button', { name }))).minHeight).toBe(
                `${String(BUTTON_VISUAL_HEIGHT.lg)}px`,
            );
        }
    });

    // C2: Next is quiet unless it is the action now. The filled button is the primary tier, the quiet one the secondary.
    it('fills Next only when its tone is filled', () => {
        const { unmount } = render(<CookingNav {...navProps()} />);
        const quiet = getComputedStyle(
            pillOf(screen.getByRole('button', { name: 'Next step, step 3' })),
        ).backgroundColor;
        const back = getComputedStyle(pillOf(screen.getByRole('button', { name: 'Back to step 1' }))).backgroundColor;
        unmount();

        render(
            <CookingNav
                {...navProps({
                    forward: {
                        label: 'Start step 3',
                        accessibilityLabel: 'Start step 3',
                        tone: 'filled',
                        onPress: vi.fn(),
                    },
                })}
            />,
        );
        const filled = getComputedStyle(pillOf(screen.getByRole('button', { name: 'Start step 3' }))).backgroundColor;

        expect(quiet).toBe(back);
        expect(filled).not.toBe(quiet);
    });

    // While the recipe loads the pair is drawn but disabled, so nothing shifts when it arrives.
    it('disables both while loading', () => {
        render(<CookingNav {...navProps({ disabled: true })} />);

        for (const name of ['Back to step 1', 'Next step, step 3']) {
            expect(screen.getByRole('button', { name }).getAttribute('aria-disabled')).toBe('true');
        }
    });

    // Under 360 wide the chevrons hide so each label keeps one line; neither label is shortened.
    it('draws a chevron on each quiet button when wide, and none when narrow', () => {
        const { unmount } = render(<CookingNav {...navProps()} />);
        expect(glyphCount(screen.getByRole('button', { name: 'Back to step 1' }))).toBe(1);
        expect(glyphCount(screen.getByRole('button', { name: 'Next step, step 3' }))).toBe(1);
        unmount();

        render(<CookingNav {...navProps({ narrow: true })} />);
        expect(glyphCount(screen.getByRole('button', { name: 'Back to step 1' }))).toBe(0);
        expect(glyphCount(screen.getByRole('button', { name: 'Next step, step 3' }))).toBe(0);
        expect(screen.getByRole('button', { name: 'Next step, step 3' }).textContent).toContain('Next step');
    });
});
