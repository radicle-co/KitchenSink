/**
 * One frame, one line (ADR-0055 point 9): a client splits the body on the newline byte, so a frame's own text may
 * never contain one, and every character a name can hold must survive.
 */
import { describe, expect, it } from 'vitest';

import { progressiveSearchFrameSchema, type ProgressiveSearchFrame } from '../../progressiveSearch.schema.js';
import { frameLine } from '../frameLine.js';

describe('frameLine', () => {
    it.each<[string, string]>([
        ['a newline', 'Kale\nchips'],
        ['a carriage return', 'Kale\rchips'],
        ['a line separator', 'Kale chips'],
        ['an accent and an emoji', 'Crème fraîche 🥬'],
        ['a quote and a backslash', 'Kale "chips" \\ baked'],
    ])('keeps a name with %s on one line, and parses back to the same frame', (_label, name) => {
        const frame: ProgressiveSearchFrame = {
            type: 'source',
            source: 'usda',
            outcome: 'answered',
            items: [{ name, reference: 'a.b.c.d.e' }],
        };
        const line = frameLine(frame);

        expect(line.endsWith('\n')).toBe(true);
        expect(line.slice(0, -1)).not.toContain('\n');
        expect(progressiveSearchFrameSchema.parse(JSON.parse(line))).toStrictEqual(frame);
    });

    it('writes completion as its own line', () => {
        expect(frameLine({ type: 'complete' })).toBe('{"type":"complete"}\n');
    });
});
