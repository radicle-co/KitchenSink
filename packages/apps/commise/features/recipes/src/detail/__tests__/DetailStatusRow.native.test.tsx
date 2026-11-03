/**
 * The status row (designer ruling, `RecipeDetailAndroid384` item 4): "Public" and "Version history" sit in a wrapping row 16
 * apart in both directions, with NO separator glyph. A "·" cannot be told from layout when the pair wraps at 2x text, and
 * measuring for it needed layout state, so the glyph is gone. REPLACES the layout-reporting tests of 14df344d0.
 */
import { cleanup, screen } from '@testing-library/react';
import { nativeTokens } from '@commise/ui/native';
import { renderWithTamagui, resolvedStyle } from '@commise/ui/testing/tamagui';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DetailStatusRow } from '../DetailStatusRow.native.js';

afterEach(cleanup);

const draw = (): HTMLElement => {
    renderWithTamagui(
        <DetailStatusRow
            status={{ kind: 'visibility', visibility: 'public', text: 'Public' }}
            onViewVersions={vi.fn()}
        />,
        'light',
    );

    return screen.getByText('Public').parentElement?.parentElement as HTMLElement;
};

describe('DetailStatusRow (native) — the wrapping row', () => {
    it('draws no separator glyph between the two items', () => {
        draw();

        expect(screen.queryByText('·')).toBeNull();
        expect(screen.getByRole('button', { name: 'Version history' })).toBeTruthy();
    });

    it('wraps, so each item can stand on its own line', () => {
        expect(resolvedStyle(draw(), 'flexWrap')).toBe('wrap');
    });

    it('keeps 16 between the items across and down', () => {
        const row = draw();
        const gap = `${String(nativeTokens.spacing[4])}px`;

        expect(gap).toBe('16px');
        // One `gap` is both the row gap and the column gap.
        expect(resolvedStyle(row, 'gap')).toBe(gap);
    });
});
