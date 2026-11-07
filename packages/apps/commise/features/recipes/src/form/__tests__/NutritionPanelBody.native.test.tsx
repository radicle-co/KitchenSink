/**
 * The native nutrition panel's body (the row's status sheet), rendered through react-native-web under jsdom: each
 * sub-state's copy, and its colours in both schemes (D15) — body copy in `ink`, a figure's label and the basis line in
 * `inkMuted`. The web leaf's states are covered by its own suite; this one owns the native paint.
 */
import { LocaleProvider } from '@commise/i18n/react';
import { role, roleDark } from '@commise/ui/colors';
import { rgb, systemScheme } from '@commise/ui/testing/system-color-scheme';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', async (importOriginal) => {
    const { withSystemScheme } = await import('@commise/ui/testing/system-color-scheme');

    return withSystemScheme(await importOriginal<typeof import('react-native')>());
});

import { expectNativeDesignSystemButton } from '../../__tests__/nativeDesignSystemButton.js';
import { recipeFormMessages } from '../messages.js';
import { NutritionPanelBody } from '../NutritionPanelBody.native.js';
import type { NutritionPanelState } from '../nutritionPanel.js';
import { render } from '@commise/ui/testing/tamagui';

const m = recipeFormMessages.en;

afterEach(() => {
    cleanup();
    systemScheme.current = null;
});

const renderBody = (state: NutritionPanelState): void => {
    render(
        <LocaleProvider locale="en">
            <NutritionPanelBody state={state} onRetry={() => undefined} />
        </LocaleProvider>,
    );
};

describe.each(['light', 'dark'] as const)('NutritionPanelBody (native) — the %s scheme', (scheme) => {
    const colours = scheme === 'dark' ? roleDark : role;

    it('says the read is loading, in ink', () => {
        systemScheme.current = scheme;
        renderBody({ kind: 'loading' });

        expect(getComputedStyle(screen.getByText(m.nutritionLoading)).color).toBe(rgb(colours.ink));
    });

    it('labels the basis and each figure in inkMuted, and draws each value in ink', () => {
        systemScheme.current = scheme;
        renderBody({ kind: 'figures', figures: { calories: 120 }, partial: false });

        expect(getComputedStyle(screen.getByText(m.nutritionBasis)).color).toBe(rgb(colours.inkMuted));

        const row = screen.getByLabelText(/^Calories /u);
        const [label, value] = Array.from(row.children);

        if (label === undefined || value === undefined) {
            throw new Error('a figure row holds a label and a value');
        }

        expect(getComputedStyle(label).color).toBe(rgb(colours.inkMuted));
        expect(getComputedStyle(value).color).toBe(rgb(colours.ink));
    });

    it('explains a failed read in ink, beside its retry', () => {
        systemScheme.current = scheme;
        renderBody({ kind: 'failed' });

        expect(getComputedStyle(screen.getByText(m.nutritionLoadFailed)).color).toBe(rgb(colours.ink));
        expect(screen.getByRole('button', { name: m.statusActionRetry })).toBeTruthy();
    });
});

describe('NutritionPanelBody (native) — Try again', () => {
    // `componentFixes.md` §1: Try again is the quiet pill with the refreshCw glyph, and stays pressable after a press.
    // Light only: the helper reads the light `actionText`; the dark repaint is the Button's own suite.
    it('draws Try again as the quiet Button with the retry glyph', () => {
        const onRetry = vi.fn();

        render(
            <LocaleProvider locale="en">
                <NutritionPanelBody state={{ kind: 'failed' }} onRetry={onRetry} />
            </LocaleProvider>,
        );
        const retry = screen.getByRole('button', { name: m.statusActionRetry });

        expectNativeDesignSystemButton(retry, 'quiet', 'refresh-cw');
        fireEvent.click(retry);

        expect(onRetry).toHaveBeenCalledTimes(1);
        expect(retry.getAttribute('aria-disabled')).not.toBe('true');
    });
});
