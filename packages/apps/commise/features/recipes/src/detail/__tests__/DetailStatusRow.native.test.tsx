/**
 * The status row's separator (designer, `RecipeDetailAndroid384`, item 4): "Public · Version history" on one line, and when the
 * pair wraps (at 2x text) the separator is dropped so no "·" starts the second line on its own. Whether the pair wrapped
 * is read from where each item lays out (the second item is lower than the first), which jsdom cannot compute, so the
 * tests deliver the layout reports a device would.
 */
import { act, cleanup, screen } from '@testing-library/react';
import { renderWithTamagui } from '@commise/ui/testing/tamagui';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DetailStatusRow } from '../DetailStatusRow.native.js';

afterEach(cleanup);

const status = { kind: 'visibility', visibility: 'public', text: 'Public' } as const;

/** Deliver a layout report, with the top edge `y`, to the item at `index` (0 the status, 1 the version link). */
function layout(index: 0 | 1, y: number): void {
    const reporters = Array.from(document.querySelectorAll('*')).filter(
        (element) => (element as Element & { __reactLayoutHandler?: unknown }).__reactLayoutHandler !== undefined,
    ) as (Element & { __reactLayoutHandler: (event: unknown) => void })[];
    const handler = reporters[index]?.__reactLayoutHandler;

    if (handler === undefined) {
        throw new Error(`item ${String(index)} reports no layout`);
    }

    act(() => handler({ nativeEvent: { layout: { x: 0, y, width: 100, height: 24 } } }));
}

const draw = (): void => {
    renderWithTamagui(<DetailStatusRow status={status} onViewVersions={vi.fn()} />, 'light');
};

describe('DetailStatusRow (native) — the separator', () => {
    it('shows the separator before anything has laid out', () => {
        draw();

        expect(screen.getByText('·')).toBeTruthy();
    });

    it('keeps the separator while both items share a line', () => {
        draw();
        layout(0, 0);
        layout(1, 0);

        expect(screen.getByText('·')).toBeTruthy();
    });

    it('drops the separator when the version link wraps below the visibility', () => {
        draw();
        layout(0, 0);
        layout(1, 36);

        expect(screen.queryByText('·')).toBeNull();
        expect(screen.getByRole('button', { name: 'Version history' })).toBeTruthy();
    });

    it('brings the separator back when the pair fits again', () => {
        draw();
        layout(0, 0);
        layout(1, 36);
        layout(1, 0);

        expect(screen.getByText('·')).toBeTruthy();
    });
});
