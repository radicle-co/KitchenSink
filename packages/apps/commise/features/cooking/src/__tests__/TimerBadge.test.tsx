/**
 * Component tests for the web {@link TimerBadge} (FR-034) — the per-step timer affordance.
 *
 * Three mutation lenses drive these assertions:
 *  1. **The gate is structural.** A step with no (or a zero-length) `timerSeconds` renders NOTHING — a
 *     badge that fell through to `0:00` with a live start control would fail here.
 *  2. **The unit is SECONDS.** `timerSeconds: 90` must read `1:30`, not `90:00`; the seconds-as-minutes
 *     confusion is a 60x error and this is where it is caught.
 *  3. **Intent carries the step.** Start reports the EXACT step it was rendered for, so the orchestrator
 *     cannot build a timer for the wrong instruction.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { LocaleProvider } from '@commise/i18n/react';
import type { RecipeStepView } from '@kitchensink/recipe-core';

import { TimerBadge } from '../TimerBadge';

afterEach(cleanup);

const noop = () => undefined;

function makeStep(overrides: Partial<RecipeStepView> = {}): RecipeStepView {
    return { stepNumber: 3, instruction: 'Simmer the sauce', ...overrides };
}

function renderBadge(step: RecipeStepView, onStart: (step: RecipeStepView) => void = noop) {
    render(
        <LocaleProvider locale="en">
            <TimerBadge step={step} onStart={onStart} />
        </LocaleProvider>,
    );
}

describe('TimerBadge (web)', () => {
    it('renders the step duration and a start control when the step declares a timer', () => {
        renderBadge(makeStep({ timerSeconds: 1500 }));

        expect(screen.getByText('25:00')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Start timer' })).toBeTruthy();
    });

    it('reads timerSeconds as SECONDS (mutation lens: 90s is 1:30, never 90:00)', () => {
        renderBadge(makeStep({ timerSeconds: 90 }));

        expect(screen.getByText('1:30')).toBeTruthy();
        expect(screen.queryByText('90:00')).toBeNull();
    });

    it('zero-pads the seconds so a short timer reads 0:09, not 0:9', () => {
        renderBadge(makeStep({ timerSeconds: 9 }));

        expect(screen.getByText('0:09')).toBeTruthy();
    });

    it('renders NOTHING for a step with no timer (mutation lens: the gate is structural)', () => {
        renderBadge(makeStep({ timerSeconds: undefined }));

        expect(screen.queryByRole('button')).toBeNull();
        expect(screen.queryByText('0:00')).toBeNull();
    });

    it('renders NOTHING for a zero-length timer, rather than a control that completes instantly', () => {
        renderBadge(makeStep({ timerSeconds: 0 }));

        expect(screen.queryByRole('button')).toBeNull();
        expect(screen.queryByText('0:00')).toBeNull();
    });

    it('reports the EXACT step upward when started (mutation lens: not a neighbouring step)', () => {
        const onStart = vi.fn();
        const step = makeStep({ stepNumber: 7, instruction: 'Rest the dough', timerSeconds: 1800 });
        renderBadge(step, onStart);

        fireEvent.click(screen.getByRole('button', { name: 'Start timer' }));

        expect(onStart).toHaveBeenCalledTimes(1);
        expect(onStart).toHaveBeenCalledWith(step);
    });

    it('does not fire the start intent on render (mutation lens: the badge is inert until pressed)', () => {
        const onStart = vi.fn();
        renderBadge(makeStep({ timerSeconds: 1500 }), onStart);

        expect(onStart).not.toHaveBeenCalled();
    });
});
