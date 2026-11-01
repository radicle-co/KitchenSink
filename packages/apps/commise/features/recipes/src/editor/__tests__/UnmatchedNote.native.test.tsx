/**
 * The quiet note in Photos & publish about ingredient lines with no match (native). Mirrors the web note's
 * `text-caption text-attention`: the sentence carries the meaning, and colour only reinforces it.
 *
 * It draws through the design system's `Text` (ADR-0080): the `caption` role, in `attention` for the scheme it is shown
 * in. Every expected value is read from the tokens, so a scale or palette change moves this test with it.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
import { formatRgb } from 'culori';

import { role, roleDark } from '@commise/ui/colors';
import { nativeTokens } from '@commise/ui/native';
import { renderWithTamagui, resolvedColour } from '@commise/ui/testing/tamagui';

import { UnmatchedNote } from '../UnmatchedNote.native.js';

const TEXT = 'Ready to publish. 2 ingredients have no match, so their nutrition is left out.';

afterEach(cleanup);

describe('UnmatchedNote (native)', () => {
    it('sets the text in the caption role', () => {
        const spec = nativeTokens.type.caption;
        renderWithTamagui(<UnmatchedNote text={TEXT} />, 'light');
        const style = getComputedStyle(screen.getByText(TEXT));

        expect(style.fontFamily).toContain(spec.fontFamily);
        expect(style.fontSize).toBe(`${String(spec.fontSize)}px`);
        expect(style.lineHeight).toBe(`${String(spec.lineHeight)}px`);
    });

    it.each([
        ['light', role.attention],
        ['dark', roleDark.attention],
    ] as const)('paints the text in attention in the %s scheme', (scheme, colour) => {
        renderWithTamagui(<UnmatchedNote text={TEXT} />, scheme);

        expect(resolvedColour(screen.getByText(TEXT), 'color')).toBe(formatRgb(colour));
    });
});
