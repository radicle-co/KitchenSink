/**
 * THE STEP ANSWER READER: the writer's answer is data, and nothing in it is guessed (spec 027 FR-046).
 *
 * Every refusal is pinned with a case that is refused for that reason and no other, and the neighbouring valid
 * case is pinned beside it, so a reader that refuses too much fails as loudly as one that refuses too little.
 */
import { describe, expect, it } from 'vitest';

import { MAX_REWRITTEN_STEP_CHARS, parseStepAnswer } from '../stepAnswer.js';

const answer = (steps: unknown): string => JSON.stringify({ steps });

describe('parseStepAnswer, readable answers', () => {
    it('returns the steps in order with the source steps each one covers', () => {
        const text = answer([
            { text: 'Melt the butter.', covers: [0] },
            { text: 'Roast until done.', covers: [1, 2] },
        ]);

        expect(parseStepAnswer(text, 80)).toEqual({
            ok: true,
            steps: [
                { text: 'Melt the butter.', covers: [0] },
                { text: 'Roast until done.', covers: [1, 2] },
            ],
        });
    });

    it('accepts surrounding whitespace and a step that covers nothing', () => {
        expect(parseStepAnswer(`\n  ${answer([{ text: 'Serve.', covers: [] }])}  \n`, 80)).toEqual({
            ok: true,
            steps: [{ text: 'Serve.', covers: [] }],
        });
    });

    it('accepts exactly the cap and refuses one more', () => {
        const steps = (count: number): unknown[] =>
            Array.from({ length: count }, (_, index) => ({ text: `Step ${index}.`, covers: [index] }));

        expect(parseStepAnswer(answer(steps(3)), 3)).toMatchObject({ ok: true });
        expect(parseStepAnswer(answer(steps(4)), 3)).toEqual({ refused: 'overCap' });
    });
});

describe('parseStepAnswer, unreadable', () => {
    it.each([
        ['empty text', ''],
        ['plain prose', 'Melt the butter, then roast.'],
        ['truncated JSON', '{"steps":[{"text":"Melt","covers":[0]}'],
        ['a bare array', '[{"text":"Melt","covers":[0]}]'],
        ['null', 'null'],
        ['no steps key', '{}'],
        ['steps is not an array', '{"steps":"Melt"}'],
        ['an empty step list', answer([])],
        ['a step that is a string', answer(['Melt the butter.'])],
        ['a step with no text', answer([{ covers: [0] }])],
        ['a step with blank text', answer([{ text: '   ', covers: [0] }])],
        ['a step with no covers', answer([{ text: 'Melt.' }])],
        ['a covers entry that is a string', answer([{ text: 'Melt.', covers: ['0'] }])],
        ['a covers entry that is fractional', answer([{ text: 'Melt.', covers: [0.5] }])],
        ['a covers entry that is negative', answer([{ text: 'Melt.', covers: [-1] }])],
        ['a step over the text limit', answer([{ text: 'x'.repeat(MAX_REWRITTEN_STEP_CHARS + 1), covers: [0] }])],
    ])('refuses %s', (_name, text) => {
        expect(parseStepAnswer(text, 80)).toEqual({ refused: 'unreadable' });
    });

    it('counts the text limit in code points, so astral characters are not counted twice', () => {
        const text = answer([{ text: '𝒜'.repeat(MAX_REWRITTEN_STEP_CHARS), covers: [0] }]);

        expect(parseStepAnswer(text, 80)).toMatchObject({ ok: true });
    });

    it('accepts a step at exactly the text limit', () => {
        const text = answer([{ text: 'x'.repeat(MAX_REWRITTEN_STEP_CHARS), covers: [0] }]);

        expect(parseStepAnswer(text, 80)).toMatchObject({ ok: true });
    });
});

describe('parseStepAnswer, text outside the step list', () => {
    const valid = answer([{ text: 'Melt.', covers: [0] }]);

    it.each([
        ['prose before the answer', `Here are your steps: ${valid}`],
        ['prose after the answer', `${valid}\nHope that helps!`],
        ['a code fence around the answer', `\`\`\`json\n${valid}\n\`\`\``],
        ['another top-level field', '{"steps":[{"text":"Melt.","covers":[0]}],"note":"I changed the oven"}'],
        ['another field on a step', answer([{ text: 'Melt.', covers: [0], title: 'Butter' }])],
    ])('refuses %s', (_name, text) => {
        expect(parseStepAnswer(text, 80)).toEqual({ refused: 'outsideList' });
    });
});

describe('parseStepAnswer, order of refusals', () => {
    it('reports an unreadable answer before counting its steps', () => {
        const tooMany = Array.from({ length: 5 }, () => ({ covers: [0] }));

        expect(parseStepAnswer(answer(tooMany), 3)).toEqual({ refused: 'unreadable' });
    });
});
