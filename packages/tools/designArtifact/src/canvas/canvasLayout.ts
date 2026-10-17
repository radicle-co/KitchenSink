/**
 * @module canvas/canvasLayout — where each board and each row title sits on the canvas.
 *
 * Pure. Rows run top to bottom in the order their first board appears; the boards of a row run left to right. A web
 * board fills its width on resize (`expand: 'fill'`); a native board keeps its phone width.
 */
import type { CanvasBoard, CanvasNote } from '../artifactFormat.js';

import { boardWidth } from './boards.js';
import type { BoardSpec } from './boards.js';

/** Space between boards of one row. */
export const BOARD_GAP = 80;

/** Space between the tallest board of a row and the top of the next. */
export const ROW_GAP = 400;

/** How far above its row the row title sits. */
export const NOTE_OFFSET = 260;

/** The widest a row title may be before it wraps. */
export const NOTE_MAX_WIDTH = 2400;

/** The positions {@link canvasLayout} computes. */
export interface CanvasLayout {
    /** Keyed by file, in canvas order. */
    readonly boards: Readonly<Record<string, CanvasBoard>>;
    /** Keyed `row0`, `row1`, … in row order. */
    readonly notes: Readonly<Record<string, CanvasNote>>;
}

/**
 * Lays the boards out.
 *
 * @param boards - The registry, in canvas order.
 * @returns Board rectangles and row-title notes.
 */
export function canvasLayout(boards: readonly BoardSpec[]): CanvasLayout {
    const rows = new Map<string, BoardSpec[]>();

    for (const board of boards) {
        rows.set(board.row, [...(rows.get(board.row) ?? []), board]);
    }

    const placed: Record<string, CanvasBoard> = {};
    const notes: Record<string, CanvasNote> = {};
    let y = 0;

    [...rows].forEach(([title, members], index) => {
        let x = 0;

        notes[`row${String(index)}`] = { x: 0, y: y - NOTE_OFFSET, text: title, kind: 'title1', maxW: NOTE_MAX_WIDTH };

        for (const board of members) {
            const w = boardWidth(board);

            placed[board.file] = {
                x,
                y,
                w,
                h: board.height,
                title: board.title,
                ...(board.platform === 'web' ? { expand: 'fill' } : {}),
            };
            x += w + BOARD_GAP;
        }

        y += Math.max(...members.map((board) => board.height)) + ROW_GAP;
    });

    return { boards: placed, notes };
}
