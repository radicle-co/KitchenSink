import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { gradient, heroDark } from '@commise/ui/tokens/gradients';
import { describe, expect, it } from 'vitest';

import { CONTENT_DIR } from '../../config.js';
import { BOARDS, BOARDS_DIR, BOARD_WIDTH, BOARD_WIDTHS, boardWidth } from '../boards.js';

describe('boards registry', () => {
    it('lists the 69 boards, each file once', () => {
        expect(BOARDS).toHaveLength(69);
        expect(new Set(BOARDS.map((b) => b.file)).size).toBe(69);
    });

    it('is exactly the files in content/canvas/boards, so a new board cannot be forgotten', () => {
        const onDisk = readdirSync(BOARDS_DIR).filter((f) => f.endsWith('.dc.html'));

        expect([...BOARDS.map((b) => b.file)].sort()).toEqual([...onDisk].sort());
        expect(BOARDS_DIR).toBe(join(CONTENT_DIR, 'canvas/boards'));
        expect(BOARDS.every((b) => existsSync(join(BOARDS_DIR, b.file)))).toBe(true);
    });

    it('paints the canvas wash from var(--background-image-hero), never from stops typed into a board', () => {
        const stops = [...gradient.hero.stops, ...heroDark.stops].map((stop) => stop.color.toLowerCase());

        for (const { file } of BOARDS) {
            const source = readFileSync(join(BOARDS_DIR, file), 'utf8').toLowerCase();

            for (const colour of stops) {
                expect(source, `${file} types the wash stop ${colour}`).not.toContain(colour);
            }
        }
    });

    it('names the platform from the file: a Mobile suffix is native, anything else web', () => {
        for (const board of BOARDS) {
            expect(board.platform, board.file).toBe(board.file.endsWith('Mobile.dc.html') ? 'native' : 'web');
        }
    });

    it('titles every board with its platform in parentheses', () => {
        for (const board of BOARDS) {
            expect(board.title, board.file).toMatch(board.platform === 'web' ? /\(web\)$/u : /\(mobile\)$/u);
        }
    });

    it('keeps boards of one row together, so rows are contiguous', () => {
        const seen: string[] = [];

        for (const { row } of BOARDS) {
            if (seen[seen.length - 1] !== row) {
                expect(seen, row).not.toContain(row);
                seen.push(row);
            }
        }

        expect(seen).toHaveLength(14);
    });

    it('declares heights that are positive whole numbers', () => {
        for (const board of BOARDS) {
            expect(Number.isInteger(board.height) && board.height > 0, board.file).toBe(true);
        }
    });

    it('fixes the default widths: web 1280, native 390', () => {
        expect(BOARD_WIDTH).toEqual({ web: 1280, native: 390 });
    });

    // The widths are the app's breakpoints (`@commise/ui/tokens/layout`): web compact below 600, medium to 839, the
    // expanded nav at 1024 (regular container) and 1280 (wide container); native phone, tablet portrait and landscape.
    it('offers one width per breakpoint on each platform', () => {
        expect(BOARD_WIDTHS).toEqual({ web: [390, 768, 1024, 1280], native: [390, 834, 1194] });
    });

    it('draws a board at its default width unless it names another', () => {
        expect(boardWidth({ file: 'A.dc.html', title: 'A (web)', row: 'R', platform: 'web', height: 1 })).toBe(1280);
        expect(
            boardWidth({
                file: 'A.dc.html',
                title: 'A, 768 px (web)',
                row: 'R',
                platform: 'web',
                height: 1,
                width: 768,
            }),
        ).toBe(768);
        expect(
            boardWidth({ file: 'AMobile.dc.html', title: 'A (mobile)', row: 'R', platform: 'native', height: 1 }),
        ).toBe(390);
    });

    it('draws every board at a width its platform allows', () => {
        for (const board of BOARDS) {
            expect((BOARD_WIDTHS[board.platform] as readonly number[]).includes(boardWidth(board)), board.file).toBe(
                true,
            );
        }
    });

    it('names a width that is not the default in the title, so a reader knows which breakpoint it shows', () => {
        for (const board of BOARDS) {
            const width = boardWidth(board);
            const named = board.title.includes(`${String(width)} px`);

            expect(named, board.file).toBe(width !== BOARD_WIDTH[board.platform]);
        }
    });
});
