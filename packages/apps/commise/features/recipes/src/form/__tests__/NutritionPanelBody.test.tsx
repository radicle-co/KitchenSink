/**
 * The web nutrition panel body (the row's status sheet): the failed read offers Try again as the design system's quiet
 * Button (`componentFixes.md` §1), described by the failure it answers. The native leaf has its own suite.
 */
import { LocaleProvider } from '@commise/i18n/react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { expectDesignSystemButton } from '../../__tests__/designSystemButton.js';
import { recipeFormMessages } from '../messages.js';
import { NutritionPanelBody } from '../NutritionPanelBody.js';

const m = recipeFormMessages.en;

afterEach(cleanup);

describe('NutritionPanelBody (web) — a failed read', () => {
    it('draws Try again as the quiet Button, described by the failure, and a press reads again', async () => {
        const user = userEvent.setup();
        const onRetry = vi.fn();

        render(
            <LocaleProvider locale="en">
                <NutritionPanelBody state={{ kind: 'failed' }} onRetry={onRetry} />
            </LocaleProvider>,
        );
        const retry = screen.getByRole('button', { name: m.statusActionRetry });

        expectDesignSystemButton(retry, 'quiet', 'refresh-cw');
        expect(document.getElementById(retry.getAttribute('aria-describedby') ?? '')?.textContent).toBe(
            m.nutritionLoadFailed,
        );

        await user.click(retry);

        expect(onRetry).toHaveBeenCalledTimes(1);
        expect(retry.hasAttribute('disabled')).toBe(false);
        expect(document.activeElement).toBe(retry);
    });
});
