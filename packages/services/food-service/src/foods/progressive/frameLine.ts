/**
 * The progressive search's line format (ADR-0055 point 9): each frame is its JSON on one line, ended by the newline
 * byte. `JSON.stringify` escapes every line break a string can hold, so the newline that ends the line is the only one.
 *
 * @module
 */
import type { ProgressiveSearchFrame } from '../progressiveSearch.schema.js';

/**
 * One frame as one line. Pure.
 *
 * @param frame - The frame.
 * @returns Its JSON and a newline.
 */
export function frameLine(frame: ProgressiveSearchFrame): string {
    return `${JSON.stringify(frame)}\n`;
}
