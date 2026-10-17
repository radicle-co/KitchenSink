import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { gradient, heroDark } from '@commise/ui/tokens/gradients';
import { describe, expect, it } from 'vitest';

import { CONTENT_DIR } from '../../config.js';
import { BOARDS, BOARDS_DIR, BOARD_WIDTH } from '../boards.js';

describe('boards registry', () => {
    it('lists the 43 boards, each file once', () => {
        expect(BOARDS).toHaveLength(43);
        expect(new Set(BOARDS.map((b) => b.file)).size).toBe(43);
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

        expect(seen).toHaveLength(12);
    });

    it('declares heights that are positive whole numbers', () => {
        for (const board of BOARDS) {
            expect(Number.isInteger(board.height) && board.height > 0, board.file).toBe(true);
        }
    });

    it('fixes the widths: web 1280, native 390', () => {
        expect(BOARD_WIDTH).toEqual({ web: 1280, native: 390 });
    });
});
