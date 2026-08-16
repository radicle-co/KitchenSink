/**
 * Native component tests for {@link TimerBadge} (FR-034), rendered through react-native-web under jsdom.
 *
 * Deliberately mirrors the web spec state-for-state — the two platforms ship in the same release
 * (CLAUDE.md cross-platform rule), so the same three mutation lenses are asserted here: the no-timer gate
 * is structural, `timerSeconds` is read as SECONDS (90s is `1:30`, never `90:00`), and start reports the
 * EXACT step it was rendered for.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { LocaleProvider } from '@commise/i18n/react';
import type { RecipeStepView } from '@kitchensink/recipe-core';

// Explicit `.native` specifier — `tsc` and the native config's resolver both map it to the native leaf.
import { TimerBadge } from '../TimerBadge.native';

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

describe('TimerBadge (native)', () => {
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
