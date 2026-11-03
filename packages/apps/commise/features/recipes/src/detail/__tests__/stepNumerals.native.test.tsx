/**
 * The step numerals on native, at the largest text sizes (designer ruling c10ecadbf, 2026-11-03): the numeral caps at 1.5x,
 * like chrome, and its circle is at least 32 pt and grows to the numeral's height plus 8, so two digits always fit. Both
 * the cook's step row and the editor's step header draw one. The fit on real font metrics is
 * `format/__tests__/discGeometry.fit.test.ts`; this pins that the components follow it.
 */
import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LocaleProvider } from '@commise/i18n/react';
import { renderWithTamagui, resolvedStyle } from '@commise/ui/testing/tamagui';

import { RecipeInstructionsFields } from '../../form/RecipeInstructionsFields.native.js';
import { defaultRecipeFormValues } from '../../form/values.js';
import { StepRow } from '../StepRow.native.js';

/** The OS font scale the components read through `useWindowDimensions`. */
const fontScale = vi.hoisted(() => ({ current: 1 }));

vi.mock('react-native', async (importOriginal) => {
    const { withSystemScheme } = await import('@commise/ui/testing/system-color-scheme');
    const actual = await importOriginal<typeof import('react-native')>();

    return {
        ...withSystemScheme(actual),
        useWindowDimensions: () => ({ ...actual.useWindowDimensions(), fontScale: fontScale.current }),
    };
});

afterEach(() => {
    cleanup();
    fontScale.current = 1;
});

const STEP = { stepNumber: 12, instruction: 'Stir.' } as const;

const stepRow = (scale: number) => {
    fontScale.current = scale;
    renderWithTamagui(
        <LocaleProvider locale="en">
            <StepRow step={STEP} current={false} onToggle={vi.fn()} />
        </LocaleProvider>,
        'light',
        scale,
    );
};

const instructions = (scale: number) => {
    fontScale.current = scale;
    renderWithTamagui(
        <LocaleProvider locale="en">
            <RecipeInstructionsFields
                values={{ ...defaultRecipeFormValues(), steps: [{ instruction: 'Stir.' }] }}
                onChange={vi.fn()}
            />
        </LocaleProvider>,
        'light',
        scale,
    );
};

describe.each([
    ["the cook's step row", stepRow, '12'],
    ["the editor's step header", instructions, '1'],
] as const)('%s', (_name, draw, numeral) => {
    it.each([
        [1, '14px', '32px'],
        [1.5, '21px', '38px'],
        [2, '21px', '38px'],
        [3.1, '21px', '38px'],
    ] as const)('at system scale %fx draws the numeral at %s in a circle of at least %s', (scale, size, disc) => {
        draw(scale);
        const text = screen.getByText(numeral);

        expect(resolvedStyle(text, 'fontSize')).toBe(size);
        expect(resolvedStyle(text.parentElement as HTMLElement, 'minWidth')).toBe(disc);
        expect(resolvedStyle(text.parentElement as HTMLElement, 'minHeight')).toBe(disc);
    });

    it('sets no fixed height on the circle, so it can only grow', () => {
        draw(2);

        expect(resolvedStyle(screen.getByText(numeral).parentElement as HTMLElement, 'height')).not.toBe('32px');
    });
});
