/**
 * Tests for `parseJobs.schema.ts` (plan U9, origin D9/R13) — the parse-job wire contract.
 *
 * Written RED-first from the plan. The load-bearing claims:
 *
 *  1. The create request's admission IS `parseJobText.ts`'s — the schema and the service split with the
 *     same function, so what validates is exactly what gets stored (R17's precondition).
 *  2. Refusals are rejections with the offending line NAMED — never truncations (ADR-0024's rule).
 *  3. The proposal wire shape is a PROJECTION of the stored `ParsedLine` (raw, quantity, unit,
 *     statedMeasure, foods, reviewReasons) — proposals only, R19: nothing here carries a food id, so the
 *     wire cannot bind what the parse only proposed.
 *  4. Responses are strict: unknown keys in a stored proposal do NOT leak onto the wire.
 */
import { describe, expect, it } from 'vitest';
import { MAX_PARSE_JOB_LINES, PARSE_JOB_LINE_MAX_CHARS } from '@kitchensink/recipe-core/parsing/parse-job-text';

import {
    createParseJobRequestSchema,
    editParseJobLineRequestSchema,
    parseJobResponseSchema,
    parseProposalFoodSchema,
    parseProposalSchema,
} from '../parseJobs.schema.js';

describe('createParseJobRequestSchema', () => {
    it('accepts a well-formed paste', () => {
        const result = createParseJobRequestSchema.safeParse({ text: '2 cups flour\n1 tsp salt' });

        expect(result.success).toBe(true);
    });

    it('rejects unknown keys (strict envelope)', () => {
        const result = createParseJobRequestSchema.safeParse({ text: 'flour', ownerId: 'sneaky' });

        expect(result.success).toBe(false);
    });

    it('rejects whitespace-only text — a job with zero lines is not a job', () => {
        const result = createParseJobRequestSchema.safeParse({ text: '  \n\n  ' });

        expect(result.success).toBe(false);
    });

    it('rejects an over-long line, naming its index — never truncating', () => {
        const text = `fine\n${'x'.repeat(PARSE_JOB_LINE_MAX_CHARS + 1)}`;
        const result = createParseJobRequestSchema.safeParse({ text });

        expect(result.success).toBe(false);

        if (!result.success) {
            expect(JSON.stringify(result.error.issues)).toContain('line 1');
        }
    });

    it('rejects a paste with too many lines', () => {
        const text = Array.from({ length: MAX_PARSE_JOB_LINES + 1 }, (_, i) => `line ${String(i)}`).join('\n');
        const result = createParseJobRequestSchema.safeParse({ text });

        expect(result.success).toBe(false);
    });
});

describe('editParseJobLineRequestSchema', () => {
    it('accepts a replacement line', () => {
        expect(editParseJobLineRequestSchema.safeParse({ sourceLine: '3 large eggs' }).success).toBe(true);
    });

    it('rejects a whitespace-only replacement', () => {
        expect(editParseJobLineRequestSchema.safeParse({ sourceLine: '   ' }).success).toBe(false);
    });

    it('rejects an over-long replacement whole', () => {
        const sourceLine = 'x'.repeat(PARSE_JOB_LINE_MAX_CHARS + 1);

        expect(editParseJobLineRequestSchema.safeParse({ sourceLine }).success).toBe(false);
    });
});

describe('parseProposalSchema', () => {
    const proposal = {
        raw: '2 cups flour, sifted',
        quantity: { kind: 'exact', value: 2 },
        unit: 'cup',
        statedMeasure: '2 cups',
        foods: [{ name: 'flour', prep: 'sifted' }],
        reviewReasons: [],
    };

    it('accepts the ParsedLine projection', () => {
        expect(parseProposalSchema.safeParse(proposal).success).toBe(true);
    });

    it('carries NO food id — proposals bind nothing (R19), pinned on the SHAPE', () => {
        // The response is deliberately loose (a client tolerates a newer server's fields), so rejection
        // cannot carry R19. What carries it is the declared key set: a binding field cannot appear here
        // without failing this pin and arguing itself in review.
        expect(Object.keys(parseProposalFoodSchema.shape).sort()).toEqual(['name', 'prep']);
        expect(Object.keys(parseProposalSchema.shape).sort()).toEqual([
            'foods',
            'quantity',
            'raw',
            'reviewReasons',
            'statedMeasure',
            'unit',
        ]);
    });

    it('accepts an absent quantity and empty foods (a heading the segmenter admitted)', () => {
        const heading = {
            raw: 'For the marinade',
            quantity: { kind: 'absent' },
            unit: null,
            statedMeasure: null,
            foods: [],
            reviewReasons: ['no_food'],
        };

        expect(parseProposalSchema.safeParse(heading).success).toBe(true);
    });
});

describe('parseJobResponseSchema', () => {
    it('accepts a running job view with pending lines', () => {
        const result = parseJobResponseSchema.safeParse({
            id: '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
            status: 'running',
            createdAt: '2026-08-31T00:00:00.000Z',
            expiresAt: '2026-09-01T00:00:00.000Z',
            lines: [{ lineIndex: 0, sourceLine: '2 cups flour', status: 'pending', proposal: null }],
        });

        expect(result.success).toBe(true);
    });

    it('refuses a line status outside the four-member union', () => {
        const result = parseJobResponseSchema.safeParse({
            id: '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
            status: 'running',
            createdAt: '2026-08-31T00:00:00.000Z',
            expiresAt: '2026-09-01T00:00:00.000Z',
            lines: [{ lineIndex: 0, sourceLine: 'x', status: 'exploded', proposal: null }],
        });

        expect(result.success).toBe(false);
    });
});
