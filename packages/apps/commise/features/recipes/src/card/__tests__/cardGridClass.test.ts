import { describe, expect, it } from 'vitest';

import { GRID_CELL_CLASS } from '../cardGridClass.js';

describe('GRID_CELL_CLASS', () => {
    it('names its one column minmax(0, 1fr): an implicit `auto` column grows to the min-content of a long word', () => {
        expect(GRID_CELL_CLASS.split(/\s+/u)).toEqual(
            expect.arrayContaining(['grid', 'grid-cols-[minmax(0,1fr)]', 'grid-rows-subgrid', 'row-span-6']),
        );
    });
});
