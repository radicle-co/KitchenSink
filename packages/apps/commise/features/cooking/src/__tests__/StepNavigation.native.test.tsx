/**
 * Native component tests for the {@link StepNavigation} leaf (FR-033, NFR-003, NFR-004), rendered through
 * react-native-web under jsdom, plus the pure swipe rules of {@link stepNavigationModel}.
 *
 * Mirrors the web suite state-for-state so the two platforms cannot drift on where a boundary is, and adds
 * the native-only SWIPE affordance. The boundary mechanism differs by platform on purpose and the tests say
 * so: web marks the previous control `aria-disabled` and withholds the handler, while native hands `disabled`
 * to `PressScale`'s `Pressable`, which both announces the state and refuses the press. Deleting
 * `disabled={atFirst}` therefore turns the "does NOT call onPrevious" case red here, exactly as deleting the
 * web guard does there.
 *
 * Swipe boundary/threshold behaviour is proven against the pure {@link swipeNavigation} the leaf delegates
 * to. Whether a real thumb produces that displacement is a device concern (Maestro / on-device), not
 * something jsdom's synthetic responder events can honestly assert.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';

import { LocaleProvider } from '@commise/i18n/react';
import { palette } from '@commise/ui/tokens/colors';

// Explicit `.native` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { StepNavigation } from '../StepNavigation.native';
import { SWIPE_THRESHOLD_PX, swipeIntent, swipeNavigation, type StepNavigationProps } from '../stepNavigationModel';

afterEach(cleanup);

const noop = () => undefined;

function renderNavigation(overrides: Partial<StepNavigationProps> = {}) {
    const props: StepNavigationProps = {
        currentStep: 1,
        totalSteps: 3,
        onPrevious: noop,
        onNext: noop,
        onFinish: noop,
        ...overrides,
    };
    const { container } = render(
        <LocaleProvider locale="en">
            <StepNavigation {...props} />
        </LocaleProvider>,
    );

    return container;
}

/** `#RRGGBB` in the shared palette → the `rgb(r, g, b)` notation jsdom reports back. */
const asRgb = (hex: string): string => {
    const value = Number.parseInt(hex.slice(1), 16);

    return `rgb(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255})`;
};

/**
 * The decorative dots, read back through the `progressbar` that names the row. react-native-web compiles
 * each style object to atomic CSS, which jsdom computes — so the tone is read as a real colour and mapped
 * back through the shared palette (re-theming a token moves both halves together).
 */
const dotToneOf = (name: string): readonly string[] => {
    const tones = new Map([
        [asRgb(palette.seafoam), 'completed'],
        [asRgb(palette.charcoal), 'current'],
        [asRgb(palette.mist), 'upcoming'],
    ]);

    return [...screen.getByRole('progressbar', { name }).children].map(
        (dot) => tones.get(window.getComputedStyle(dot).backgroundColor) ?? 'unknown',
    );
};

describe('StepNavigation (native) — middle step, both directions live', () => {
    it('offers an accessibly named previous AND next control', () => {
        renderNavigation({ currentStep: 1, totalSteps: 3 });

        expect(screen.getByRole('button', { name: 'Previous step' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Next step' })).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Finish cooking' })).toBeNull();
    });

    it('neither control is marked unavailable, and no boundary is announced', () => {
        renderNavigation({ currentStep: 1, totalSteps: 3 });

        expect(screen.getByRole('button', { name: 'Previous step' }).getAttribute('aria-disabled')).toBeNull();
        expect(screen.queryAllByRole('status')).toHaveLength(0);
    });

    it('reports a backward intent through onPrevious ONLY', () => {
        const onPrevious = vi.fn();
        const onNext = vi.fn();
        const onFinish = vi.fn();
        renderNavigation({ currentStep: 1, totalSteps: 3, onPrevious, onNext, onFinish });

        fireEvent.click(screen.getByRole('button', { name: 'Previous step' }));

        expect(onPrevious).toHaveBeenCalledTimes(1);
        expect(onNext).not.toHaveBeenCalled();
        expect(onFinish).not.toHaveBeenCalled();
    });

    it('reports a forward intent through onNext ONLY', () => {
        const onPrevious = vi.fn();
        const onNext = vi.fn();
        const onFinish = vi.fn();
        renderNavigation({ currentStep: 1, totalSteps: 3, onPrevious, onNext, onFinish });

        fireEvent.click(screen.getByRole('button', { name: 'Next step' }));

        expect(onNext).toHaveBeenCalledTimes(1);
        expect(onPrevious).not.toHaveBeenCalled();
        expect(onFinish).not.toHaveBeenCalled();
    });

    it('gives both tap zones a ≥48dp touch target (WCAG 2.5.5, kitchen-grade)', () => {
        renderNavigation({ currentStep: 1, totalSteps: 3 });

        // The Pressable is the accessible control; the styled surface it wraps carries the target size.
        for (const name of ['Previous step', 'Next step']) {
            const surface = screen.getByRole('button', { name }).firstElementChild as Element;
            const style = window.getComputedStyle(surface);

            expect(Number.parseFloat(style.minHeight)).toBeGreaterThanOrEqual(48);
            expect(Number.parseFloat(style.minWidth)).toBeGreaterThanOrEqual(48);
        }
    });
});

describe('StepNavigation (native) — first step boundary', () => {
    it('keeps the previous control MOUNTED and announces that it is unavailable', () => {
        renderNavigation({ currentStep: 0, totalSteps: 3 });

        expect(screen.getByRole('button', { name: 'Previous step' }).getAttribute('aria-disabled')).toBe('true');
        expect(screen.getByText('You are on the first step')).toBeTruthy();
    });

    it('does NOT call onPrevious when the disabled control is activated (mutation lens: the guard is real)', () => {
        const onPrevious = vi.fn();
        renderNavigation({ currentStep: 0, totalSteps: 3, onPrevious });

        fireEvent.click(screen.getByRole('button', { name: 'Previous step' }));

        expect(onPrevious).not.toHaveBeenCalled();
    });

    it('still advances forward from the first step', () => {
        const onNext = vi.fn();
        renderNavigation({ currentStep: 0, totalSteps: 3, onNext });

        fireEvent.click(screen.getByRole('button', { name: 'Next step' }));

        expect(onNext).toHaveBeenCalledTimes(1);
    });
});

describe('StepNavigation (native) — last step boundary', () => {
    it('REPLACES the next control with the finish affordance', () => {
        renderNavigation({ currentStep: 2, totalSteps: 3 });

        expect(screen.getByRole('button', { name: 'Finish cooking' })).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Next step' })).toBeNull();
        expect(screen.getByText('You are on the last step')).toBeTruthy();
    });

    it('reports finishing through onFinish, never through onNext', () => {
        const onNext = vi.fn();
        const onFinish = vi.fn();
        renderNavigation({ currentStep: 2, totalSteps: 3, onNext, onFinish });

        fireEvent.click(screen.getByRole('button', { name: 'Finish cooking' }));

        expect(onFinish).toHaveBeenCalledTimes(1);
        expect(onNext).not.toHaveBeenCalled();
    });

    it('still steps backward from the last step', () => {
        const onPrevious = vi.fn();
        renderNavigation({ currentStep: 2, totalSteps: 3, onPrevious });

        fireEvent.click(screen.getByRole('button', { name: 'Previous step' }));

        expect(onPrevious).toHaveBeenCalledTimes(1);
    });
});

describe('StepNavigation (native) — a single-step recipe holds BOTH boundaries at once', () => {
    it('offers a disabled previous control and the finish affordance, and no next control', () => {
        renderNavigation({ currentStep: 0, totalSteps: 1 });

        expect(screen.getByRole('button', { name: 'Previous step' }).getAttribute('aria-disabled')).toBe('true');
        expect(screen.getByRole('button', { name: 'Finish cooking' })).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Next step' })).toBeNull();
    });

    it('announces both boundaries', () => {
        renderNavigation({ currentStep: 0, totalSteps: 1 });

        expect(screen.queryAllByRole('status').map((node) => node.textContent)).toEqual([
            'You are on the first step',
            'You are on the last step',
        ]);
    });

    it('fires neither navigation callback, only finish', () => {
        const onPrevious = vi.fn();
        const onNext = vi.fn();
        const onFinish = vi.fn();
        renderNavigation({ currentStep: 0, totalSteps: 1, onPrevious, onNext, onFinish });

        fireEvent.click(screen.getByRole('button', { name: 'Previous step' }));
        fireEvent.click(screen.getByRole('button', { name: 'Finish cooking' }));

        expect(onPrevious).not.toHaveBeenCalled();
        expect(onNext).not.toHaveBeenCalled();
        expect(onFinish).toHaveBeenCalledTimes(1);
    });

    it('renders a single dot, marked current', () => {
        renderNavigation({ currentStep: 0, totalSteps: 1 });

        expect(dotToneOf('Step 1 of 1')).toEqual(['current']);
    });
});

describe('StepNavigation (native) — progress row', () => {
    it('exposes the position as a named progressbar (NFR-003)', () => {
        renderNavigation({ currentStep: 2, totalSteps: 4 });

        const progress = screen.getByRole('progressbar', { name: 'Step 3 of 4' });

        // Mutation lens: a zero-based or off-by-one `aria-valuenow` fails here.
        expect(progress.getAttribute('aria-valuenow')).toBe('3');
        expect(progress.getAttribute('aria-valuemin')).toBe('1');
        expect(progress.getAttribute('aria-valuemax')).toBe('4');
        expect(progress.getAttribute('aria-valuetext')).toBe('Step 3 of 4');
    });

    it('renders one dot per step, split into completed / current / upcoming', () => {
        renderNavigation({ currentStep: 2, totalSteps: 4 });

        expect(dotToneOf('Step 3 of 4')).toEqual(['completed', 'completed', 'current', 'upcoming']);
    });

    it('leaves no dot completed on the first step, and all but one completed on the last', () => {
        renderNavigation({ currentStep: 0, totalSteps: 3 });
        expect(dotToneOf('Step 1 of 3')).toEqual(['current', 'upcoming', 'upcoming']);

        cleanup();

        renderNavigation({ currentStep: 2, totalSteps: 3 });
        expect(dotToneOf('Step 3 of 3')).toEqual(['completed', 'completed', 'current']);
    });

    it('states the position in TEXT as well, so the dots are never the sole conveyor (NFR-004)', () => {
        renderNavigation({ currentStep: 2, totalSteps: 4 });

        const visible = screen
            .getAllByText('Step 3 of 4')
            .filter((node) => node.getAttribute('role') !== 'progressbar');

        expect(visible).toHaveLength(1);
    });
});

describe('StepNavigation (native) — nothing to navigate', () => {
    it('renders nothing for a recipe with no steps (the screen owns that empty state)', () => {
        const container = renderNavigation({ currentStep: 0, totalSteps: 0 });

        expect(container.innerHTML).toBe('');
    });
});

describe('stepNavigationModel — the swipe rules the native leaf delegates to', () => {
    it('reads a swipe LEFT past the threshold as "advance"', () => {
        expect(swipeIntent(-(SWIPE_THRESHOLD_PX + 1), 0)).toBe('next');
    });

    it('reads a swipe RIGHT past the threshold as "go back"', () => {
        expect(swipeIntent(SWIPE_THRESHOLD_PX + 1, 0)).toBe('previous');
    });

    it('treats the threshold as EXCLUSIVE, so a nudge is never a step change (HAZ-006)', () => {
        expect(swipeIntent(-SWIPE_THRESHOLD_PX, 0)).toBe('none');
        expect(swipeIntent(SWIPE_THRESHOLD_PX, 0)).toBe('none');
        expect(swipeIntent(-(SWIPE_THRESHOLD_PX - 1), 0)).toBe('none');
        expect(swipeIntent(0, 0)).toBe('none');
    });

    it('ignores a drag whose vertical travel dominates (a scroll is not a step change)', () => {
        expect(swipeIntent(-60, 90)).toBe('none');
        expect(swipeIntent(60, 90)).toBe('none');
        expect(swipeIntent(-60, 10)).toBe('next');
    });

    it('applies the SAME boundary rules the tap zones obey', () => {
        // Backward swipe on the first step, forward swipe on the last: both no-ops.
        expect(swipeNavigation(80, 0, 0, 3)).toBe('none');
        expect(swipeNavigation(-80, 0, 2, 3)).toBe('none');
        // …and both live in the middle.
        expect(swipeNavigation(80, 0, 1, 3)).toBe('previous');
        expect(swipeNavigation(-80, 0, 1, 3)).toBe('next');
    });

    it('never finishes the session by swipe — ending a cook stays a deliberate press (HAZ-006)', () => {
        expect(swipeNavigation(-500, 0, 0, 1)).toBe('none');
        expect(swipeNavigation(-500, 0, 2, 3)).toBe('none');
    });
});
