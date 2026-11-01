/**
 * The line the native collection detail says when an action failed. Mirrors the web alert's
 * `text-body text-danger-text`; before ADR-0080 the native text set no type role and drew the system face.
 *
 * It draws through the design system's `Text` (ADR-0080): the `body` role, in `dangerText` for the scheme it is shown
 * in. Every expected value is read from the tokens, so a scale or palette change moves this test with it.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, screen } from '@testing-library/react';

import { nativeTokens } from '@commise/ui/native';
import { rgb, rolesFor } from '@commise/ui/testing/system-color-scheme';
import { renderWithTamagui, resolvedColour, resolvedStyle } from '@commise/ui/testing/tamagui';

import { CollectionDetailAlert } from '../CollectionDetailAlert.native.js';

const TEXT = 'We couldn’t make this private.';

afterEach(cleanup);

describe('CollectionDetailAlert (native)', () => {
    it('announces the failure as an alert', () => {
        renderWithTamagui(<CollectionDetailAlert text={TEXT} />, 'light');

        expect(screen.getByRole('alert').textContent).toBe(TEXT);
    });

    it('keeps the space-2 breathing room above and below the line', () => {
        renderWithTamagui(<CollectionDetailAlert text={TEXT} />, 'light');
        const line = screen.getByText(TEXT);

        expect(resolvedStyle(line, 'paddingTop')).toBe(`${String(nativeTokens.spacing[2])}px`);
        expect(resolvedStyle(line, 'paddingBottom')).toBe(`${String(nativeTokens.spacing[2])}px`);
    });

    it('sets the text in the body role', () => {
        const spec = nativeTokens.type.body;
        renderWithTamagui(<CollectionDetailAlert text={TEXT} />, 'light');
        const style = getComputedStyle(screen.getByText(TEXT));

        expect(style.fontFamily).toContain(spec.fontFamily);
        expect(style.fontSize).toBe(`${String(spec.fontSize)}px`);
        expect(style.lineHeight).toBe(`${String(spec.lineHeight)}px`);
    });

    it.each(['light', 'dark'] as const)('paints the text in dangerText in the %s scheme', (scheme) => {
        renderWithTamagui(<CollectionDetailAlert text={TEXT} />, scheme);

        expect(resolvedColour(screen.getByText(TEXT), 'color')).toBe(rgb(rolesFor(scheme).dangerText));
    });
});
