/**
 * The native two-column layout (L2, L3): the ingredients column on the left in its own 300 wide scrolling slot, and the
 * step column in the rest, at most 680 wide and centred. Pure layout, so nothing is mocked: the slots are plain text.
 */
import { nativeTokens } from '@commise/ui/native';
import { rgb, rolesFor } from '@commise/ui/testing/system-color-scheme';
import { render, resolvedColour, resolvedStyle } from '@commise/ui/testing/tamagui';
import { cleanup, screen } from '@testing-library/react';
import { Text } from '@commise/ui/text';
import { afterEach, describe, expect, it } from 'vitest';

import { CookingTwoColumnLayout } from '../CookingTwoColumnLayout.native.js';

afterEach(cleanup);

const layout = () =>
    render(
        <CookingTwoColumnLayout column={<Text>Ingredients here</Text>}>
            <Text>Step here</Text>
        </CookingTwoColumnLayout>,
    );

describe('CookingTwoColumnLayout (native)', () => {
    it('draws the ingredients column before the step column, each once', () => {
        layout();

        const column = screen.getByText('Ingredients here');
        const step = screen.getByText('Step here');

        expect(column.compareDocumentPosition(step) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('puts the ingredients in a 300 wide slot that scrolls on its own, and the step outside it', () => {
        layout();

        const slot = screen.getByTestId('cooking-ingredients-slot');

        expect(slot.contains(screen.getByText('Ingredients here'))).toBe(true);
        expect(slot.contains(screen.getByText('Step here'))).toBe(false);
        expect(getComputedStyle(slot).width).toBe('300px');
        expect(getComputedStyle(screen.getByTestId('cooking-ingredients-scroll')).overflowY).toBe('auto');
        expect(getComputedStyle(screen.getByTestId('cooking-columns')).flexDirection).toBe('row');
        expect(screen.getByTestId('cooking-ingredients-scroll').contains(screen.getByText('Ingredients here'))).toBe(
            true,
        );
    });

    it('centres the step in the rest, at most 680 wide', () => {
        layout();

        const step = screen.getByTestId('cooking-step-slot');

        expect(step.contains(screen.getByText('Step here'))).toBe(true);
        expect(getComputedStyle(step).maxWidth).toBe('680px');
        expect(getComputedStyle(screen.getByTestId('cooking-step-area')).alignItems).toBe('center');
    });

    it('insets the column content 16 on every side, inside the scroll, on the canvas', () => {
        layout();

        const slot = screen.getByTestId('cooking-ingredients-slot');
        const inset = screen.getByTestId('cooking-ingredients-inset');

        expect(inset.contains(screen.getByText('Ingredients here'))).toBe(true);
        expect(screen.getByTestId('cooking-ingredients-scroll').contains(inset)).toBe(true);

        const edge = `${String(nativeTokens.spacing[4])}px`;

        for (const side of ['paddingTop', 'paddingBottom', 'paddingLeft', 'paddingRight'] as const) {
            expect(resolvedStyle(inset, side)).toBe(edge);
        }

        expect(resolvedColour(slot, 'backgroundColor')).toBe(rgb(rolesFor('light').canvas));
    });
});
