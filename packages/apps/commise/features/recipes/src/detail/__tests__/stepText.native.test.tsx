/**
 * The step's instruction text on native draws through the design-system `Text`, not a plain React Native `Text`.
 *
 * Why this is pinned: on iOS a plain `Text` that sets its size and leading from a style sheet while still honouring the
 * system text scale measures and paints with different metrics, so a line that fits the measure by a hair paints one
 * unwrapped line clipped at the frame while a second line stays reserved (QA batch 4, 2e8b83005: step 11, "Step number
 * 11: do the next thing carefully, then check it."). The design-system `Text` turns system scaling off and draws the
 * size and leading itself, so the two agree. jsdom cannot lay out text; this pins the property that makes them agree.
 */
import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LocaleProvider } from '@commise/i18n/react';
import { renderWithTamagui, resolvedStyle } from '@commise/ui/testing/tamagui';

import { StepRow } from '../StepRow.native.js';

afterEach(cleanup);

const INSTRUCTION = 'Step number 11: do the next thing carefully, then check it.';

describe('the native step row text', () => {
    it('is set by the design-system Text at the reading role', () => {
        renderWithTamagui(
            <LocaleProvider locale="en">
                <StepRow step={{ stepNumber: 11, instruction: INSTRUCTION }} current={false} onToggle={vi.fn()} />
            </LocaleProvider>,
            'light',
            1,
        );
        const text = screen.getByText(INSTRUCTION);

        expect(text.className).toContain('is_Text');
        expect(resolvedStyle(text, 'fontSize')).toBe('18px');
        expect(resolvedStyle(text, 'lineHeight')).toBe('28px');
    });

    it('sets the timer chip text through the design-system Text too', () => {
        renderWithTamagui(
            <LocaleProvider locale="en">
                <StepRow
                    step={{ stepNumber: 1, instruction: 'Bake.', timerSeconds: 600 }}
                    current={false}
                    onToggle={vi.fn()}
                />
            </LocaleProvider>,
            'light',
            1,
        );

        expect(screen.getByText('10 min').className).toContain('is_Text');
    });
});
