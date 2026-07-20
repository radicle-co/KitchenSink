// @vitest-environment jsdom
/**
 * Hook tests for {@link useCookingProgress} (W2 Task 2.4). The load-bearing assertion is the plan's
 * acceptance criterion — a cook's checked items SURVIVE the detail view unmounting and remounting (the
 * "tap a tag and come back mid-cook" flow) — which only holds because the state lives in the session store,
 * not in component-local React state. Also pins re-render-on-toggle and per-recipe scoping.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';

import { resetCookingProgress } from '../cookingProgress.js';
import { useCookingProgress } from '../useCookingProgress.js';

afterEach(() => {
    cleanup();
    resetCookingProgress();
});

/** A tiny probe that surfaces the hook's state + a control to toggle step 1, for a given recipe id. */
function Probe({ recipeId }: { readonly recipeId: string }) {
    const { checkedSteps, toggleStep } = useCookingProgress(recipeId);

    return (
        <button type="button" aria-pressed={checkedSteps.has(1)} onClick={() => toggleStep(1)}>
            step-1
        </button>
    );
}

describe('useCookingProgress', () => {
    it('re-renders the consumer when a tracked value toggles', async () => {
        render(<Probe recipeId="rec_1" />);
        const button = screen.getByRole('button', { name: 'step-1' });
        expect(button.getAttribute('aria-pressed')).toBe('false');

        await act(async () => button.click());

        expect(button.getAttribute('aria-pressed')).toBe('true');
    });

    it('preserves checked items across an unmount + remount (survives navigate-away-and-back)', async () => {
        const first = render(<Probe recipeId="rec_1" />);
        await act(async () => screen.getByRole('button', { name: 'step-1' }).click());
        expect(screen.getByRole('button', { name: 'step-1' }).getAttribute('aria-pressed')).toBe('true');

        first.unmount();

        render(<Probe recipeId="rec_1" />);
        expect(screen.getByRole('button', { name: 'step-1' }).getAttribute('aria-pressed')).toBe('true');
    });

    it('does not leak progress from one recipe to another', async () => {
        const first = render(<Probe recipeId="rec_1" />);
        await act(async () => screen.getByRole('button', { name: 'step-1' }).click());
        first.unmount();

        render(<Probe recipeId="rec_2" />);
        expect(screen.getByRole('button', { name: 'step-1' }).getAttribute('aria-pressed')).toBe('false');
    });
});
