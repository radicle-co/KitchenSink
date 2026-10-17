import { describe, expect, it } from 'vitest';

import { BOARDS } from '../boards.js';
import type { BoardSpec } from '../boards.js';
import { canvasLayout } from '../canvasLayout.js';

const web = (file: string, row: string, height: number): BoardSpec => ({
    file,
    title: `${file} (web)`,
    row,
    platform: 'web',
    height,
});
const native = (file: string, row: string, height: number): BoardSpec => ({
    file,
    title: `${file} (mobile)`,
    row,
    platform: 'native',
    height,
});

describe('canvasLayout', () => {
    const layout = canvasLayout([
        web('A.html', 'One', 500),
        native('AM.html', 'One', 900),
        web('B.html', 'Two', 300),
        native('BM.html', 'Two', 200),
        web('C.html', 'Two', 100),
    ]);

    it('places a row left to right with 80 between boards', () => {
        expect(layout.boards['A.html']).toMatchObject({ x: 0, y: 0, w: 1280, h: 500 });
        expect(layout.boards['AM.html']).toMatchObject({ x: 1360, y: 0, w: 390, h: 900 });
        expect(layout.boards['BM.html']).toMatchObject({ x: 1360, y: 1300 });
        expect(layout.boards['C.html']).toMatchObject({ x: 1360 + 390 + 80, y: 1300 });
    });

    it('starts the next row 400 below the TALLEST board of the row above, not the last one', () => {
        expect(layout.boards['B.html']?.y).toBe(900 + 400);
    });

    it('marks web boards expand=fill and leaves native boards without it', () => {
        expect(layout.boards['A.html']?.expand).toBe('fill');
        expect(layout.boards['AM.html']).not.toHaveProperty('expand');
    });

    it('keeps the declared order as the key order and carries the titles', () => {
        expect(Object.keys(layout.boards)).toEqual(['A.html', 'AM.html', 'B.html', 'BM.html', 'C.html']);
        expect(layout.boards['AM.html']?.title).toBe('AM.html (mobile)');
    });

    it('puts one title1 note per row, 260 above the row, 2400 wide, in row order', () => {
        expect(layout.notes).toEqual({
            row0: { x: 0, y: -260, text: 'One', kind: 'title1', maxW: 2400 },
            row1: { x: 0, y: 1300 - 260, text: 'Two', kind: 'title1', maxW: 2400 },
        });
    });

    it('lays out each board at its own width', () => {
        const layout = canvasLayout([
            { file: 'A.html', title: 'A, 768 px (web)', row: 'One', platform: 'web', height: 500, width: 768 },
            {
                file: 'BMobile.html',
                title: 'B, 834 px (mobile)',
                row: 'One',
                platform: 'native',
                height: 900,
                width: 834,
            },
            { file: 'CMobile.html', title: 'C (mobile)', row: 'One', platform: 'native', height: 900 },
        ]);

        expect(layout.boards['A.html']).toMatchObject({ x: 0, w: 768 });
        expect(layout.boards['BMobile.html']).toMatchObject({ x: 768 + 80, w: 834 });
        expect(layout.boards['CMobile.html']).toMatchObject({ x: 768 + 80 + 834 + 80, w: 390 });
    });

    it('reproduces the published prototype canvas positions from the registry', () => {
        const real = canvasLayout(BOARDS);

        expect(real.boards['Home.dc.html']).toMatchObject({ x: 0, y: 0, w: 1280, h: 962, expand: 'fill' });
        expect(real.boards['HomeMobile.dc.html']).toMatchObject({ x: 1360, y: 0, w: 390, h: 1388 });
        expect(real.boards['Discover.dc.html']?.y).toBe(1788);
        expect(real.boards['RecipeVersionsEmptyMobile.dc.html']?.x).toBe(3190);
        expect(real.boards['LegalSources.dc.html']?.y).toBe(41373);
        expect(real.notes['row0']?.y).toBe(-260);
        expect(real.notes['row20']).toMatchObject({ y: 41113, text: 'Data sources' });
        expect(Object.keys(real.notes)).toHaveLength(21);
    });

    it('lays out nothing for no boards', () => {
        expect(canvasLayout([])).toEqual({ boards: {}, notes: {} });
    });
});
