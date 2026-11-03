/**
 * The fact tiles' row rule at its call site (designer, iosBatch2): the tiles go across only while each one, per unit of text
 * scale, is at least 100 pt wide with an 8 pt gap between them; below that, one tile to a row. This is the table that used to
 * test `factTilesAcross`, moved to where the rule is applied now that it is `columnsKeepingMinOf`
 * (`card/__tests__/cardGridLayout.test.ts` holds the rule's own arithmetic).
 */
import { render, resolvedStyle } from '@commise/ui/testing/tamagui';
import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { DetailFactTiles } from '../DetailFactTiles.native.js';
import type { DetailStatCell } from '../detailFacts.js';

afterEach(cleanup);

const ALL: readonly DetailStatCell[] = [
    { id: 'total', label: 'Total', value: '1 h' },
    { id: 'prep', label: 'Prep', value: '10 min' },
    { id: 'difficulty', label: 'Difficulty', value: 'Medium' },
];

const rowOf = (): HTMLElement => screen.getByRole('group', { name: 'Total: 1 h' }).parentElement as HTMLElement;

describe('DetailFactTiles (native) — across, or one to a row', () => {
    it.each([
        { width: 358, scale: 1, count: 3, across: true },
        { width: 358, scale: 1.1, count: 3, across: true },
        { width: 358, scale: 2, count: 3, across: false },
        // 3 × 100 + 2 × 8 = 316: exactly the line, and one point under it.
        { width: 316, scale: 1, count: 3, across: true },
        { width: 315, scale: 1, count: 3, across: false },
        { width: 288, scale: 1, count: 3, across: false },
        { width: 358, scale: 1.5, count: 3, across: false },
        { width: 358, scale: 1.5, count: 2, across: true },
        { width: 358, scale: 2, count: 2, across: false },
        { width: 200, scale: 1, count: 2, across: false },
    ])('$count tiles in $width pt at scale $scale go across: $across', ({ width, scale, count, across }) => {
        render(<DetailFactTiles tiles={ALL.slice(0, count)} layout={{ bodyWidth: width, textScale: scale }} />);

        expect(resolvedStyle(rowOf(), 'flexDirection')).toBe(across ? 'row' : 'column');
    });

    it('draws nothing for no tiles', () => {
        const { container } = render(<DetailFactTiles tiles={[]} layout={{ bodyWidth: 358, textScale: 1 }} />);

        expect(container.textContent).toBe('');
    });
});
