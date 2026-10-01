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

/**
 * ⛔ THE NO-FOOD VERDICT — a measure attached to nothing.
 *
 * Measured over 1,265 ingredient lines: the parse model returned a measurement and NO food on 28 of them
 * ('three quarts of cold water' → measure "three", no food items). The validator loop could not see it —
 * the foodness judge iterates the food list, and an empty list judges nothing — so the line landed as a
 * clean parse. This verdict is what makes the retry fire.
 *
 * What crosses stays inside D5's carve-out: what the MODEL ITSELF produced (the measure) and the checker's
 * observation that it produced no food. Nothing from the CRF, nothing from any other engine.
 */
describe('the no-food failure', () => {
    it('renders the measure the model stated beside the fact that no food came back', () => {
        const prompt = buildParseRetryPrompt('three quarts of cold water', [
            { kind: 'no-food', statedMeasure: 'three' },
        ]);

        expect(prompt.systemPrompt).toContain('no food name was returned');
        expect(prompt.systemPrompt).toContain('"three"');
    });

    it('⛔ is NOT rendered as the MEASUREMENT sentence — a distinct verdict reads as a distinct sentence', () => {
        // The renderer was a two-arm ternary on `kind`, so any third member fell into the measurement arm
        // and told a foodless parse that its measure "does not match what the line states" — a sentence no
        // validator said, about a failure that is not this one. `tsc` cannot catch that when both members
        // carry the field the arm reads, so the assertion is here instead.
        const prompt = buildParseRetryPrompt('three quarts of cold water', [
            { kind: 'no-food', statedMeasure: 'three' },
        ]);

        expect(prompt.systemPrompt).not.toContain('does not match what the line states');
    });

    it('says nothing about a measure the parse never stated — no empty quotes, no "(none)" token', () => {
        const prompt = buildParseRetryPrompt('For the sauce:', [{ kind: 'no-food', statedMeasure: null }]);

        expect(prompt.systemPrompt).toContain('no food name was returned');
        expect(prompt.systemPrompt).not.toContain('""');
        expect(prompt.systemPrompt).not.toContain('(none)');
    });

    it('⛔ the RETRY CONTEXT never asserts that the line names a food — the retry must not invite a fabrication', () => {
        // 22 of the same 1,265 lines legitimately name no food ('spoonfuls', 'baking-board', 'family', 'A
        // small quantity'). "The line names a food and none was returned" is FALSE on every one of them,
        // and a model told a falsehood about its own input is a model asked to invent one.
        //
        // ⚠️ Asserted over the SUFFIX alone, not the whole system prompt, and the distinction is real: the
        // pinned base task already says "never leave food_items null when the sentence names a food" — a
        // CONDITIONAL rule the model is meant to apply, which the retry context must not restate as a
        // finding of fact about THIS line. The base prompt is verbatim and not this builder's to edit.
        const prompt = buildParseRetryPrompt('A small quantity', [{ kind: 'no-food', statedMeasure: null }]);
        const suffix = prompt.systemPrompt.slice(PARSE_SYSTEM_PROMPT.length);

        expect(suffix).toContain('no food name was returned');
        expect(suffix).not.toMatch(/names a food/u);
    });

    it('clamps the stated measure exactly like every other crossing string', () => {
        const prompt = buildParseRetryPrompt('x', [{ kind: 'no-food', statedMeasure: 'm'.repeat(500) }]);

        expect(prompt.systemPrompt).toContain('m'.repeat(MAX_RETRY_CONTEXT_CHARS));
        expect(prompt.systemPrompt).not.toContain('m'.repeat(MAX_RETRY_CONTEXT_CHARS + 1));
    });
});
