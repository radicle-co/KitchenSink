/**
 * The notice a failed save of the library's grid/list choice shows (native, react-native-web under jsdom). Mirrors
 * `ViewSaveFailedNotice.test.tsx`.
 *
 * It draws through the design system's `Text` (ADR-0080): the `meta` role, in `dangerText` for the scheme it is shown
 * in. Every expected value is read from the tokens, so a scale or palette change moves this test with it.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
import { formatRgb } from 'culori';

import { role, roleDark } from '@commise/ui/colors';
import { nativeTokens } from '@commise/ui/native';
import { renderWithTamagui, resolvedColour } from '@commise/ui/testing/tamagui';

import { ViewSaveFailedNotice } from '../ViewSaveFailedNotice.native.js';

const MESSAGE = 'We couldn’t save your view. Try choosing it again.';

afterEach(cleanup);

describe('ViewSaveFailedNotice (native)', () => {
    it('announces that the choice was not saved, as an alert', () => {
        renderWithTamagui(<ViewSaveFailedNotice />, 'light');

        expect(screen.getByRole('alert').textContent).toBe(MESSAGE);
    });

    it('sets the message in the meta role', () => {
        const { meta } = nativeTokens.type;
        renderWithTamagui(<ViewSaveFailedNotice />, 'light');
        const style = getComputedStyle(screen.getByText(MESSAGE));

        expect(style.fontFamily).toContain(meta.fontFamily);
        expect(style.fontSize).toBe(`${String(meta.fontSize)}px`);
        expect(style.lineHeight).toBe(`${String(meta.lineHeight)}px`);
    });

    it.each([
        ['light', role.dangerText],
        ['dark', roleDark.dangerText],
    ] as const)('paints the message in dangerText in the %s scheme', (scheme, colour) => {
        renderWithTamagui(<ViewSaveFailedNotice />, scheme);

        expect(resolvedColour(screen.getByText(MESSAGE), 'color')).toBe(formatRgb(colour));
    });
});
