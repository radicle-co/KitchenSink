/**
 * Tests for `parseJobText.ts` (plan U9, origin R13) — the ONE splitter behind both the wire contract's
 * `superRefine` and the producer's create path.
 *
 * Written RED-first from the plan: the module does not exist yet. The load-bearing claims:
 *
 *  1. Splitting is deterministic and normalizing: CRLF and LF both split, lines are trimmed, and blank
 *     lines vanish — the stored line IS the trimmed line, because R17's digest is computed over what is
 *     stored, and two representations of "the same line" would fork the digest.
 *  2. Refusals are REJECTIONS, never truncations (ADR-0024's rule, applied one contract over): an
 *     over-long line names its index and is refused whole; the create must not silently parse a prefix
 *     the cook did not write.
 *  3. The line-length bound and `parseLineJobMessageSchema.sourceLine`'s acceptance bound are the SAME
 *     number — the splitter admits exactly what the queue contract admits, or the producer manufactures
 *     poison messages from admitted input.
 */
import { describe, expect, it } from 'vitest';

import {
    MAX_PARSE_JOB_LINES,
    PARSE_JOB_LINE_MAX_CHARS,
    PARSE_JOB_TEXT_MAX_CHARS,
    refuseParseJobLines,
    splitParseJobLines,
} from '../parseJobText.js';
import { parseLineJobMessageSchema } from '../parseJobMessage.js';

const VALID_MESSAGE_BASE = {
    jobId: '5e0f9f9a-3b2a-4c1d-9e8f-7a6b5c4d3e2f',
    lineIndex: 0,
    lineDigest: `v1:${'a'.repeat(64)}`,
    requestedAt: '2026-08-31T00:00:00.000Z',
};

describe('splitParseJobLines', () => {
    it('splits on LF and CRLF, trims each line, and drops blanks', () => {
        const text = '2 cups flour\r\n\r\n  1 tsp salt  \n\n3 eggs\n';

        expect(splitParseJobLines(text)).toEqual(['2 cups flour', '1 tsp salt', '3 eggs']);
    });

    it('answers an empty list for whitespace-only text', () => {
        expect(splitParseJobLines('  \n\r\n\t\n')).toEqual([]);
    });

    it('keeps interior whitespace verbatim — trimming is the ONLY normalization', () => {
        expect(splitParseJobLines('2  cups   flour')).toEqual(['2  cups   flour']);
    });
});

describe('refuseParseJobLines', () => {
    it('accepts a bounded, well-formed split with no refusals', () => {
        expect(refuseParseJobLines(['2 cups flour', '1 tsp salt'])).toEqual([]);
    });

    it('refuses an over-long line BY INDEX, whole — never truncated', () => {
        const lines = ['fine', 'x'.repeat(PARSE_JOB_LINE_MAX_CHARS + 1), 'also fine'];
        const refusals = refuseParseJobLines(lines);

        expect(refusals).toEqual([{ lineIndex: 1, reason: 'line_too_long' }]);
    });

    it('admits a line AT the bound exactly', () => {
        expect(refuseParseJobLines(['x'.repeat(PARSE_JOB_LINE_MAX_CHARS)])).toEqual([]);
    });

    it('refuses a split with too many lines', () => {
        const lines = Array.from({ length: MAX_PARSE_JOB_LINES + 1 }, (_, i) => `line ${String(i)}`);
        const refusals = refuseParseJobLines(lines);

        expect(refusals).toEqual([{ lineIndex: MAX_PARSE_JOB_LINES, reason: 'too_many_lines' }]);
    });

    it('refuses an empty split — a job with zero lines is not a job', () => {
        expect(refuseParseJobLines([])).toEqual([{ lineIndex: 0, reason: 'no_lines' }]);
    });
});

describe('the bounds agree with the queue contract', () => {
    it('a line AT the splitter bound is accepted by parseLineJobMessageSchema', () => {
        const result = parseLineJobMessageSchema.safeParse({
            ...VALID_MESSAGE_BASE,
            sourceLine: 'x'.repeat(PARSE_JOB_LINE_MAX_CHARS),
        });

        expect(result.success).toBe(true);
    });

    it('one char past the splitter bound is refused by parseLineJobMessageSchema', () => {
        const result = parseLineJobMessageSchema.safeParse({
            ...VALID_MESSAGE_BASE,
            sourceLine: 'x'.repeat(PARSE_JOB_LINE_MAX_CHARS + 1),
        });

        expect(result.success).toBe(false);
    });

    it('MAX_PARSE_JOB_LINES fits inside the message lineIndex bound', () => {
        const result = parseLineJobMessageSchema.safeParse({
            ...VALID_MESSAGE_BASE,
            lineIndex: MAX_PARSE_JOB_LINES - 1,
            sourceLine: 'fine',
        });

        expect(result.success).toBe(true);
    });

    it('PARSE_JOB_TEXT_MAX_CHARS is derived from the two bounds, not a third literal', () => {
        expect(PARSE_JOB_TEXT_MAX_CHARS).toBe(MAX_PARSE_JOB_LINES * (PARSE_JOB_LINE_MAX_CHARS + 1));
    });
});
