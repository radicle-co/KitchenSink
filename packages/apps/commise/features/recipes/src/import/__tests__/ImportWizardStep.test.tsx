// @vitest-environment jsdom
/**
 * Component tests for the web `ImportWizardStep` (board WizardStep): the recipe as the page's heading, "Recipe N of M ·
 * K lines to choose" in words and as a progress bar, Save and leave, the recipe's lines, and Back, Skip and Next in the
 * step's action bar — pinned to the bottom below the wide class (thumb reach), in flow beside the rail at it.
 *
 * The progress bar is "Review progress" with the recipe's place as its value (review finding m2: "Recipes reviewed" at
 * recipe 1 claimed one was reviewed). A checking line is counted on its own (the design authority's count rule).
 *
 * The focus case is new (review finding M4, staff-ux 2026-10-25): when the cook's pick leaves nothing open, the host
 * sends focus to Next recipe (`pickFocusOf` answers `done`), through the house `ControlFocus`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ImportWizardStep } from '../ImportWizardStep.js';
import { importMessages } from '../messages.js';
import type { ImportWizardStepProps } from '../props.js';

const w = importMessages.en.wizard;

afterEach(cleanup);

function renderStep(overrides: Partial<ImportWizardStepProps> = {}) {
    const handlers = { onBack: vi.fn(), onSkip: vi.fn(), onNext: vi.fn(), onSaveAndLeave: vi.fn() };
    render(
        <ImportWizardStep
            recipeTitle="Lemon drizzle cake"
            position={14}
            total={309}
            openLines={3}
            checkingLines={0}
            nextFocus={{ requested: false, onHandled: vi.fn() }}
            {...handlers}
            {...overrides}
        >
            <p>the lines</p>
        </ImportWizardStep>,
    );

    return handlers;
}

describe('ImportWizardStep (web)', () => {
    it('heads the page with the recipe, and says where the review is in words and as a bar', () => {
        renderStep();

        expect(screen.getByRole('heading', { level: 1, name: 'Lemon drizzle cake' })).toBeTruthy();
        expect(screen.getByText('Recipe 14 of 309 · 3 lines to choose')).toBeTruthy();

        const bar = screen.getByRole('progressbar', { name: 'Review progress' });

        expect(bar.getAttribute('aria-valuenow')).toBe('14');
        expect(bar.getAttribute('aria-valuemax')).toBe('309');
    });

    it('counts one line in the singular, and drops the count when nothing is left to choose', () => {
        renderStep({ openLines: 1 });
        expect(screen.getByText('Recipe 14 of 309 · 1 line to choose')).toBeTruthy();
        cleanup();

        renderStep({ openLines: 0 });
        expect(screen.getByText('Recipe 14 of 309')).toBeTruthy();
    });

    it('counts a line still being checked on its own, never as one to choose', () => {
        renderStep({ openLines: 2, checkingLines: 1 });
        expect(screen.getByText('Recipe 14 of 309 · 2 lines to choose · 1 being checked')).toBeTruthy();
        cleanup();

        renderStep({ openLines: 0, checkingLines: 1 });
        expect(screen.getByText('Recipe 14 of 309 · 1 being checked')).toBeTruthy();
    });

    it('draws the recipe’s lines', () => {
        renderStep();

        expect(screen.getByText('the lines')).toBeTruthy();
    });

    it('Back (named for the recipe it returns to), Skip and Next recipe, in that order, each reporting', async () => {
        const user = userEvent.setup();
        const { onBack, onSkip, onNext } = renderStep();

        const bar = screen.getByRole('group', { name: w.actionsLabel });
        const buttons = within(bar).getAllByRole('button');

        expect(buttons).toEqual([
            within(bar).getByRole('button', { name: 'Back to recipe 13' }),
            within(bar).getByRole('button', { name: w.skip }),
            within(bar).getByRole('button', { name: w.next }),
        ]);

        for (const button of buttons) {
            await user.click(button);
        }

        expect([onBack, onSkip, onNext].map((handler) => handler.mock.calls.length)).toEqual([1, 1, 1]);
    });

    it('has no Back on the first recipe', () => {
        renderStep({ position: 1 });

        expect(screen.queryByRole('button', { name: /^Back/u })).toBeNull();
        expect(screen.getByRole('button', { name: w.next })).toBeTruthy();
    });

    it('offers Save and leave', async () => {
        const user = userEvent.setup();
        const { onSaveAndLeave } = renderStep();

        await user.click(screen.getByRole('button', { name: w.saveLeave }));

        expect(onSaveAndLeave).toHaveBeenCalledTimes(1);
    });

    it('pins the action bar to the bottom below the wide class, and lets it sit in flow at it', () => {
        renderStep();

        const bar = screen.getByRole('group', { name: w.actionsLabel });

        expect(bar.className.split(' ')).toEqual(expect.arrayContaining(['sticky', 'bottom-0', '@wide/main:static']));
    });

    it('draws the rail only at the wide class, and nothing for it without one', () => {
        renderStep({ rail: <nav aria-label="Recipes to review" /> });

        const rail = screen.getByRole('navigation', { name: 'Recipes to review' });

        expect(rail.parentElement?.className.split(' ')).toEqual(
            expect.arrayContaining(['hidden', '@wide/main:block']),
        );
        cleanup();

        renderStep();
        expect(screen.queryByRole('navigation')).toBeNull();
    });

    it('⛔ a focus request moves focus to Next recipe, and is acknowledged', () => {
        const onHandled = vi.fn();

        renderStep({ nextFocus: { requested: true, onHandled } });

        expect(document.activeElement).toBe(screen.getByRole('button', { name: w.next }));
        expect(onHandled).toHaveBeenCalledTimes(1);
    });

    it('takes no focus while none is asked for', () => {
        renderStep();

        expect(document.activeElement).toBe(document.body);
    });
});
