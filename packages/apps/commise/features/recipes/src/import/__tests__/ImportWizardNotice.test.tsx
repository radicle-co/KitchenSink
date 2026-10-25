// @vitest-environment jsdom
/**
 * Component tests for `ImportWizardNotice` on the web leaves (board WizardStates): loading names the recipe being read;
 * an error names the recipe, says the choices are saved, and offers Try again and Skip this recipe; offline says the
 * review resumes by itself and offers NO control (there is nothing the cook must do).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ImportWizardNotice } from '../ImportWizardNotice.js';
import { importMessages } from '../messages.js';

const w = importMessages.en.wizard;

afterEach(cleanup);

describe('ImportWizardNotice (web)', () => {
    it('loading: a status named for the recipe being read', () => {
        render(<ImportWizardNotice kind="loading" position={15} total={309} />);

        expect(screen.getByRole('status', { name: 'Reading recipe 15 of 309…' })).toBeTruthy();
    });

    it('error: an alert naming the recipe, saying the choices are saved, with Try again and Skip this recipe', async () => {
        const user = userEvent.setup();
        const onRetry = vi.fn();
        const onSkip = vi.fn();
        render(<ImportWizardNotice kind="error" recipeTitle="Lentil soup" onRetry={onRetry} onSkip={onSkip} />);

        const alert = screen.getByRole('alert');

        expect(alert.textContent).toContain('We couldn’t load Lentil soup');
        expect(alert.textContent).toContain(w.errorBody);

        await user.click(screen.getByRole('button', { name: w.retry }));
        await user.click(screen.getByRole('button', { name: w.skipRecipe }));

        expect(onRetry).toHaveBeenCalledTimes(1);
        expect(onSkip).toHaveBeenCalledTimes(1);
    });

    it('offline: says the review resumes by itself, and offers no control', () => {
        render(<ImportWizardNotice kind="offline" />);

        expect(screen.getByText(w.offline)).toBeTruthy();
        expect(screen.queryByRole('button')).toBeNull();
    });
});
