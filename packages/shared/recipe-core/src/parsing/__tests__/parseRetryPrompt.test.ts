/**
 * The parse RETRY prompt (plan U7, KTD-D/D5) — the conscious carve-out from the poisoning rule, pinned.
 *
 * ⛔ The carve-out is NARROW: what crosses into the retry is the VALIDATOR's categorized verdict (the
 * name it rejected + a length-clamped taxonomy), NEVER the validator's raw completion and NEVER anything
 * from the CRF. The base task text is `PARSE_SYSTEM_PROMPT` verbatim — the retry ADDS a context section,
 * it does not reword the measured task.
 */
import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { PARSE_SYSTEM_PROMPT } from '../parsePrompt.js';
import {
    MAX_RETRY_CONTEXT_CHARS,
    PARSE_RETRY_SUFFIX_SHA256,
    PARSE_RETRY_SUFFIX_TEMPLATE,
    buildParseRetryPrompt,
    type RetryFailure,
} from '../parseRetryPrompt.js';

/** Tuple-exact type equality — invariant position. */
type Exact<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

const FAILURE = { kind: 'not-a-food', name: 'mixing bowl whip', taxonomy: 'equipment' } as const;

describe('the pinned suffix', () => {
    it('pins the STATIC template by SHA-256 — the failures are variable, the wording is not', () => {
        expect(createHash('sha256').update(PARSE_RETRY_SUFFIX_TEMPLATE).digest('hex')).toBe(PARSE_RETRY_SUFFIX_SHA256);
    });

    it('⛔ the base task is PARSE_SYSTEM_PROMPT verbatim — the retry adds, it never rewords', () => {
        const prompt = buildParseRetryPrompt('1 cup mixing bowl whip', [FAILURE]);

        expect(prompt.systemPrompt.startsWith(PARSE_SYSTEM_PROMPT)).toBe(true);
    });
});

describe('buildParseRetryPrompt', () => {
    it('feeds the rejected name and its category into the context section', () => {
        const prompt = buildParseRetryPrompt('1 cup mixing bowl whip', [FAILURE]);

        expect(prompt.systemPrompt).toContain('"mixing bowl whip"');
        expect(prompt.systemPrompt).toContain('equipment');
    });

    it('takes the line and the failures and NOTHING else — a third parameter is a compile error', () => {
        const takesLineAndFailures: Exact<
            Parameters<typeof buildParseRetryPrompt>,
            [string, readonly RetryFailure[]]
        > = true;

        expect(takesLineAndFailures).toBe(true);
    });

    it('renders a MEASUREMENT failure with its own sentence — no name, no taxonomy', () => {
        const prompt = buildParseRetryPrompt('2 cups flour', [{ kind: 'measurement', statedByModel: '3 cups' }]);

        expect(prompt.systemPrompt).toContain('the measure "3 cups" does not match what the line states');
    });

    it('⛔ CLAMPS the free-form taxonomy — the open taxonomy crosses as at most the clamp, never a completion', () => {
        const rambling = { kind: 'not-a-food', name: 'x', taxonomy: 'a'.repeat(500) } as const;
        const prompt = buildParseRetryPrompt('1 cup x', [rambling]);

        expect(prompt.systemPrompt).toContain('a'.repeat(MAX_RETRY_CONTEXT_CHARS));
        expect(prompt.systemPrompt).not.toContain('a'.repeat(MAX_RETRY_CONTEXT_CHARS + 1));
    });

    it('clamps the rejected NAME the same way', () => {
        const longName = { kind: 'not-a-food', name: 'n'.repeat(500), taxonomy: 'equipment' } as const;
        const prompt = buildParseRetryPrompt('1 cup x', [longName]);

        expect(prompt.systemPrompt).not.toContain('n'.repeat(MAX_RETRY_CONTEXT_CHARS + 1));
    });

    it('carries the same delimited user message as the first attempt — the line itself is untouched', () => {
        const prompt = buildParseRetryPrompt('1 cup flour', [FAILURE]);

        expect(prompt.userMessage).toBe('<input>1 cup flour</input>');
    });
});
