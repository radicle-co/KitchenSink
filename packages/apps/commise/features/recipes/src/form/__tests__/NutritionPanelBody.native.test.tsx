/**
 * The native nutrition panel's body (the row's status sheet), rendered through react-native-web under jsdom: each
 * sub-state's copy, and its colours in both schemes (D15) — body copy in `ink`, a figure's label and the basis line in
 * `inkMuted`. The web leaf's states are covered by its own suite; this one owns the native paint.
 */
import { LocaleProvider } from '@commise/i18n/react';
import { role, roleDark } from '@commise/ui/colors';
import { rgb, systemScheme } from '@commise/ui/testing/system-color-scheme';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', async (importOriginal) => {
    const { withSystemScheme } = await import('@commise/ui/testing/system-color-scheme');

    return withSystemScheme(await importOriginal<typeof import('react-native')>());
});

import { recipeFormMessages } from '../messages.js';
import { NutritionPanelBody } from '../NutritionPanelBody.native.js';
import type { NutritionPanelState } from '../nutritionPanel.js';

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
