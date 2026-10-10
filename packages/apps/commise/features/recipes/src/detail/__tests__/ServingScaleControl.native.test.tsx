/**
 * Native component tests for the serving-count control (react-native-web under jsdom).
 *
 * Mirrors the web leaf state for state — own count, above, below, both ends of the range, and an
 * over-cap recipe — so the two platforms cannot drift on which yields a cook can reach.
 *
 * REWRITTEN for F8 (`evaluateFinal.md`): the control is the design system's `Stepper`, as on web, so its steps draw
 * the `minus`/`plus` glyphs (not "−"/"+" text) and its count is Inter in tabular digits.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MAX_SCALED_SERVINGS, MIN_SCALED_SERVINGS } from '@kitchensink/recipe-core/scaling';
import { rgb, rolesFor, systemScheme } from '@commise/ui/testing/system-color-scheme';
import { ServingScaleControl } from '../ServingScaleControl.js';

vi.mock('react-native', async (importOriginal) => {
    const { withSystemScheme } = await import('@commise/ui/testing/system-color-scheme');

    return withSystemScheme(await importOriginal<typeof import('react-native')>());
});

afterEach(() => {
    cleanup();
    systemScheme.current = null;
});

/** What the polite live region says now; the Stepper's `LiveRegion` renews its node per announcement. */
const spokenIn = (container: HTMLElement): string =>
    Array.from(container.querySelectorAll('[aria-live="polite"]'))
        .map((node) => node.textContent)
        .join('');

describe('ServingScaleControl (native)', () => {
    it('shows the serving count it was given', () => {
        render(<ServingScaleControl servings={6} baseServings={4} onServingsChange={vi.fn()} />);

        expect(screen.getByText('6')).toBeTruthy();
    });

    it('adds one serving when the increase control is pressed', async () => {
        const onServingsChange = vi.fn();
        render(<ServingScaleControl servings={4} baseServings={4} onServingsChange={onServingsChange} />);

        await userEvent.click(screen.getByRole('button', { name: 'More servings' }));

        expect(onServingsChange).toHaveBeenCalledWith(5);
    });

    it('removes one serving when the decrease control is pressed', async () => {
        const onServingsChange = vi.fn();
        render(<ServingScaleControl servings={4} baseServings={4} onServingsChange={onServingsChange} />);

        await userEvent.click(screen.getByRole('button', { name: 'Fewer servings' }));

        expect(onServingsChange).toHaveBeenCalledWith(3);
    });

    it('does not step below the minimum', () => {
        render(<ServingScaleControl servings={MIN_SCALED_SERVINGS} baseServings={4} onServingsChange={vi.fn()} />);

        // Disabled, not merely a no-op handler: a control that looks pressable and does nothing is worse
        // than one that reads as unavailable. `aria-disabled` is what react-native-web projects into the DOM
        // and what assistive tech announces; it is also why `userEvent` refuses to click it at all.
        expect(screen.getByRole('button', { name: 'Fewer servings' }).getAttribute('aria-disabled')).toBe('true');
        expect(screen.getByRole('button', { name: 'More servings' }).getAttribute('aria-disabled')).not.toBe('true');
    });

    it('does not step above the maximum', () => {
        render(<ServingScaleControl servings={MAX_SCALED_SERVINGS} baseServings={4} onServingsChange={vi.fn()} />);

        expect(screen.getByRole('button', { name: 'More servings' }).getAttribute('aria-disabled')).toBe('true');
        expect(screen.getByRole('button', { name: 'Fewer servings' }).getAttribute('aria-disabled')).not.toBe('true');
    });

    it('lets a recipe authored beyond the display cap scale down from its own yield', async () => {
        const onServingsChange = vi.fn();
        const huge = MAX_SCALED_SERVINGS + 150;
        render(<ServingScaleControl servings={huge} baseServings={huge} onServingsChange={onServingsChange} />);

        await userEvent.click(screen.getByRole('button', { name: 'Fewer servings' }));

        expect(onServingsChange).toHaveBeenCalledWith(huge - 1);
    });

    /**
     * ⛔ A press changed a bare number nobody was focused on, so VoiceOver/TalkBack said nothing (staff-ux-engineer).
     * A visually hidden `LiveRegion` speaks the count — NOT one adjustable row, which would hide the two buttons from
     * iOS Voice Control ("tap More servings") and from Maestro's `servingScale.yaml`. The buttons and the visible
     * count stay exactly as they were. Silent on open (the iOS announcement fires on mount for non-empty text).
     */
    it('⛔ is silent on open, then speaks the count after a step', async () => {
        const { container, rerender } = render(
            <ServingScaleControl servings={4} baseServings={4} onServingsChange={vi.fn()} />,
        );
        expect(spokenIn(container)).toBe('');

        await userEvent.click(screen.getByRole('button', { name: 'More servings' }));
        rerender(<ServingScaleControl servings={5} baseServings={4} onServingsChange={vi.fn()} />);

        expect(spokenIn(container)).toBe('5 servings');
        // The visible count is still the bare number Maestro asserts on.
        expect(screen.getByText('5')).toBeTruthy();
    });

    it('names the limit when a step reaches the end, and says nothing for a refused press', async () => {
        const { container, rerender } = render(
            <ServingScaleControl servings={MAX_SCALED_SERVINGS - 1} baseServings={4} onServingsChange={vi.fn()} />,
        );

        await userEvent.click(screen.getByRole('button', { name: 'More servings' }));
        rerender(<ServingScaleControl servings={MAX_SCALED_SERVINGS} baseServings={4} onServingsChange={vi.fn()} />);
        expect(spokenIn(container)).toBe(`${MAX_SCALED_SERVINGS} servings, maximum`);

        cleanup();
        const fresh = render(
            <ServingScaleControl servings={MAX_SCALED_SERVINGS} baseServings={4} onServingsChange={vi.fn()} />,
        );
        // A disabled native button blocks pointer events; skip that check so the press is really attempted.
        await userEvent.setup({ pointerEventsCheck: 0 }).click(screen.getByRole('button', { name: 'More servings' }));
        expect(spokenIn(fresh.container)).toBe('');
    });

    it('names the count by a hidden "Servings" label and sets it in Inter tabular digits (F8)', () => {
        render(<ServingScaleControl servings={4} baseServings={4} onServingsChange={vi.fn()} />);

        const count = getComputedStyle(screen.getByText('4'));

        expect(screen.getByRole('group', { name: 'Servings' })).toBeTruthy();
        expect(count.fontFamily).toMatch(/Inter/u);
        expect(count.fontVariant).toMatch(/tabular-nums/u);
    });

    it('clears the 44pt touch floor on every control', () => {
        render(<ServingScaleControl servings={4} baseServings={4} onServingsChange={vi.fn()} />);

        for (const name of ['Fewer servings', 'More servings']) {
            const style = getComputedStyle(screen.getByRole('button', { name }));

            expect(Number.parseFloat(style.minWidth)).toBeGreaterThanOrEqual(44);
            expect(Number.parseFloat(style.minHeight)).toBeGreaterThanOrEqual(44);
        }
    });
});

/** D15: the stepper paints from colour roles at render — `ink` figures inside a `lineControl` control edge, as on web. */
describe.each(['light', 'dark'] as const)('ServingScaleControl (native) — the %s scheme', (scheme) => {
    it('draws each step in ink inside a lineControl edge, and the count in ink', () => {
        systemScheme.current = scheme;
        const colours = rolesFor(scheme);
        render(<ServingScaleControl servings={4} baseServings={4} onServingsChange={vi.fn()} />);
        const more = screen.getByRole('button', { name: 'More servings' });

        expect(getComputedStyle(more).borderTopColor).toBe(rgb(colours.lineControl));
        expect(more.querySelector('[data-commise-stub="icon"]')?.getAttribute('data-icon-name')).toBe('plus');
        expect(getComputedStyle(screen.getByText('4')).color).toBe(rgb(colours.ink));
    });
});
