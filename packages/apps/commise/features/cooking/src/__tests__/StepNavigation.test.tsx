// @vitest-environment jsdom
/**
 * Component tests for the WEB {@link StepNavigation} leaf (FR-033, NFR-003, NFR-004), plus the pure
 * position/boundary/dot rules of {@link stepNavigationModel} that both platforms share.
 *
 * Written to the mutation lens: the boundary assertions do NOT stop at "the control looks disabled" — they
 * dispatch a real click at the boundary and assert the callback was NOT invoked, so deleting the
 * `atFirst ? undefined : onPrevious` guard turns this suite red. That is only meaningful because the leaf
 * marks the control `aria-disabled` rather than `disabled`: a `disabled` button would swallow the click in
 * jsdom and the assertion would pass for the wrong reason (and would also hide the control from the tab
 * order, which is precisely what the "perceivable and announced" requirement forbids).
 *
 * Queried by role and accessible name only; the one place the tests reach past the accessibility tree is the
 * DECORATIVE dot row, which is `aria-hidden` by design and has no name to query — it is read back through
 * the `progressbar` that names it, mirroring how the recipe-rating suite drills into its labelled star row.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { LocaleProvider } from '@commise/i18n/react';

import { formatStepPosition as formatDisplayPosition } from '../stepPosition';
import { StepNavigation } from '../StepNavigation';
import {
    formatStepPosition,
    hasSteps,
    isAtFirstStep,
    isAtLastStep,
    stepDotStates,
    stepNumber,
    type StepNavigationProps,
} from '../stepNavigationModel';

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

/** The decorative dots, read back through the `progressbar` that names the row (they carry no name of their own). */
const dotToneOf = (name: string): readonly string[] =>
    [...screen.getByRole('progressbar', { name }).children].map((dot) => {
        const classes = dot.getAttribute('class') ?? '';

        if (classes.includes('bg-seafoam')) {
            return 'completed';
        }

        return classes.includes('bg-mist') ? 'upcoming' : 'current';
    });

describe('StepNavigation (web) — middle step, both directions live', () => {
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

    it('reports a backward intent through onPrevious ONLY', async () => {
        const user = userEvent.setup();
        const onPrevious = vi.fn();
        const onNext = vi.fn();
        const onFinish = vi.fn();
        renderNavigation({ currentStep: 1, totalSteps: 3, onPrevious, onNext, onFinish });

        await user.click(screen.getByRole('button', { name: 'Previous step' }));

        expect(onPrevious).toHaveBeenCalledTimes(1);
        expect(onNext).not.toHaveBeenCalled();
        expect(onFinish).not.toHaveBeenCalled();
    });

    it('reports a forward intent through onNext ONLY', async () => {
        const user = userEvent.setup();
        const onPrevious = vi.fn();
        const onNext = vi.fn();
        const onFinish = vi.fn();
        renderNavigation({ currentStep: 1, totalSteps: 3, onPrevious, onNext, onFinish });

        await user.click(screen.getByRole('button', { name: 'Next step' }));

        expect(onNext).toHaveBeenCalledTimes(1);
        expect(onPrevious).not.toHaveBeenCalled();
        expect(onFinish).not.toHaveBeenCalled();
    });

    it('gives both tap zones a ≥48px touch target (WCAG 2.5.5, kitchen-grade)', () => {
        renderNavigation({ currentStep: 1, totalSteps: 3 });

        for (const name of ['Previous step', 'Next step']) {
            expect(screen.getByRole('button', { name }).getAttribute('class')).toContain('min-h-12');
        }
    });
});

describe('StepNavigation (web) — first step boundary', () => {
    it('keeps the previous control MOUNTED and announces that it is unavailable', () => {
        renderNavigation({ currentStep: 0, totalSteps: 3 });

        const previous = screen.getByRole('button', { name: 'Previous step' });

        // Perceivable and announced — not silently omitted, and not removed from the tab order.
        expect(previous.getAttribute('aria-disabled')).toBe('true');
        expect(previous.hasAttribute('disabled')).toBe(false);
        expect(screen.getByText('You are on the first step')).toBeTruthy();
    });

    it('describes the unavailable control with the reason it is unavailable', () => {
        renderNavigation({ currentStep: 0, totalSteps: 3 });

        const previous = screen.getByRole('button', { name: 'Previous step' });
        const describedBy = previous.getAttribute('aria-describedby');

        expect(describedBy).toBeTruthy();
        expect(document.getElementById(describedBy as string)?.textContent).toBe('You are on the first step');
    });

    it('does NOT call onPrevious when the disabled control is activated (mutation lens: the guard is real)', async () => {
        const user = userEvent.setup();
        const onPrevious = vi.fn();
        renderNavigation({ currentStep: 0, totalSteps: 3, onPrevious });

        await user.click(screen.getByRole('button', { name: 'Previous step' }));

        expect(onPrevious).not.toHaveBeenCalled();
    });

    it('still advances forward from the first step', async () => {
        const user = userEvent.setup();
        const onNext = vi.fn();
        renderNavigation({ currentStep: 0, totalSteps: 3, onNext });

        await user.click(screen.getByRole('button', { name: 'Next step' }));

        expect(onNext).toHaveBeenCalledTimes(1);
    });
});

describe('StepNavigation (web) — last step boundary', () => {
    it('REPLACES the next control with the finish affordance', () => {
        renderNavigation({ currentStep: 2, totalSteps: 3 });

        expect(screen.getByRole('button', { name: 'Finish cooking' })).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Next step' })).toBeNull();
        expect(screen.getByText('You are on the last step')).toBeTruthy();
    });

    it('reports finishing through onFinish, never through onNext', async () => {
        const user = userEvent.setup();
        const onNext = vi.fn();
        const onFinish = vi.fn();
        renderNavigation({ currentStep: 2, totalSteps: 3, onNext, onFinish });

        await user.click(screen.getByRole('button', { name: 'Finish cooking' }));

        expect(onFinish).toHaveBeenCalledTimes(1);
        expect(onNext).not.toHaveBeenCalled();
    });

    it('still steps backward from the last step', async () => {
        const user = userEvent.setup();
        const onPrevious = vi.fn();
        renderNavigation({ currentStep: 2, totalSteps: 3, onPrevious });

        await user.click(screen.getByRole('button', { name: 'Previous step' }));

        expect(onPrevious).toHaveBeenCalledTimes(1);
    });
});

describe('StepNavigation (web) — a single-step recipe holds BOTH boundaries at once', () => {
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

    it('fires neither navigation callback, only finish', async () => {
        const user = userEvent.setup();
        const onPrevious = vi.fn();
        const onNext = vi.fn();
        const onFinish = vi.fn();
        renderNavigation({ currentStep: 0, totalSteps: 1, onPrevious, onNext, onFinish });

        await user.click(screen.getByRole('button', { name: 'Previous step' }));
        await user.click(screen.getByRole('button', { name: 'Finish cooking' }));

        expect(onPrevious).not.toHaveBeenCalled();
        expect(onNext).not.toHaveBeenCalled();
        expect(onFinish).toHaveBeenCalledTimes(1);
    });

    it('renders a single dot, marked current', () => {
        renderNavigation({ currentStep: 0, totalSteps: 1 });

        expect(dotToneOf('Step 1 of 1')).toEqual(['current']);
    });
});

describe('StepNavigation (web) — progress row', () => {
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

        // The visible paragraph — distinct from the progressbar's accessible name.
        const visible = screen
            .getAllByText('Step 3 of 4')
            .filter((node) => node.getAttribute('role') !== 'progressbar');

        expect(visible).toHaveLength(1);
    });
});

describe('StepNavigation (web) — nothing to navigate', () => {
    it('renders nothing for a recipe with no steps (the screen owns that empty state)', () => {
        const container = renderNavigation({ currentStep: 0, totalSteps: 0 });

        expect(container.innerHTML).toBe('');
    });
});

describe('stepNavigationModel — the shared boundary/position rules', () => {
    it('reports whether there is anything to navigate', () => {
        expect(hasSteps(0)).toBe(false);
        expect(hasSteps(-3)).toBe(false);
        expect(hasSteps(1)).toBe(true);
    });

    it('places the first and last boundaries exactly', () => {
        expect(isAtFirstStep(0, 3)).toBe(true);
        expect(isAtFirstStep(1, 3)).toBe(false);
        expect(isAtLastStep(1, 3)).toBe(false);
        expect(isAtLastStep(2, 3)).toBe(true);
    });

    it('holds both boundaries for a single-step recipe', () => {
        expect(isAtFirstStep(0, 1)).toBe(true);
        expect(isAtLastStep(0, 1)).toBe(true);
    });

    it('clamps an out-of-range index rather than rendering an impossible position', () => {
        expect(stepNumber(-5, 3)).toBe(1);
        expect(stepNumber(99, 3)).toBe(3);
        expect(formatStepPosition('Step {current} of {total}', 99, 3, 'en')).toBe('Step 3 of 3');
        expect(formatStepPosition('Step {current} of {total}', Number.NaN, 3, 'en')).toBe('Step 1 of 3');
    });

    it('fills both placeholders of the localized template', () => {
        expect(formatStepPosition('Étape {current} sur {total}', 1, 4, 'en')).toBe('Étape 2 sur 4');
    });

    it('renders numerals through the ACTIVE locale, matching the step-display surface', () => {
        // Guards the defect this formatter was consolidated to remove: navigation used String() while
        // the step display used Intl.NumberFormat, so a non-Latin numbering system showed the same
        // position twice, in two different scripts, on one screen.
        expect(formatStepPosition('Step {current} of {total}', 2, 8, 'ar')).toBe(
            formatDisplayPosition('Step {current} of {total}', { current: 3, total: 8 }, 'ar'),
        );
    });

    it('derives one dot state per step', () => {
        expect(stepDotStates(0, 3)).toEqual(['current', 'upcoming', 'upcoming']);
        expect(stepDotStates(1, 3)).toEqual(['completed', 'current', 'upcoming']);
        expect(stepDotStates(2, 3)).toEqual(['completed', 'completed', 'current']);
        expect(stepDotStates(0, 0)).toEqual([]);
    });
});
