/**
 * THE STEP ANSWER READER: the writer's answer is data, and nothing in it is guessed (spec 027 FR-046).
 *
 * Every refusal is pinned with a case that is refused for that reason and no other, and the neighbouring valid
 * case is pinned beside it, so a reader that refuses too much fails as loudly as one that refuses too little.
 */
import { describe, expect, it } from 'vitest';

import { PLAIN_FACT_PUNCTUATION } from '../alphabet.js';
import { MAX_ANSWER_CAP, MAX_REWRITTEN_STEP_CHARS, parseStepAnswer } from '../stepAnswer.js';

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

    it('accepts surrounding whitespace', () => {
        expect(parseStepAnswer(`\n  ${answer([{ text: 'Serve.', covers: [3] }])}  \n`, 80)).toEqual({
            ok: true,
            steps: [{ text: 'Serve.', covers: [3] }],
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
        ['a step that covers nothing', answer([{ text: 'Melt.', covers: [] }])],
        ['a covers entry that is a string', answer([{ text: 'Melt.', covers: ['0'] }])],
        ['a covers entry that is fractional', answer([{ text: 'Melt.', covers: [0.5] }])],
        ['a covers entry that is negative', answer([{ text: 'Melt.', covers: [-1] }])],
        ['a step over the text limit', answer([{ text: 'x'.repeat(MAX_REWRITTEN_STEP_CHARS + 1), covers: [0] }])],
    ])('refuses %s', (_name, text) => {
        expect(parseStepAnswer(text, 80)).toEqual({ refused: 'unreadable' });
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

describe('parseStepAnswer, text that is not plain', () => {
    const one = (text: string): string => answer([{ text, covers: [0] }]);

    it.each([
        ['a link with a scheme', 'See https://evil.example/x for more.'],
        ['a bare address', 'Visit evil.example/x for more.'],
        ['a www address', 'Visit www.evil.example today.'],
        ['an email address', 'Write to a@evil.example.'],
        ['markup', 'Stir <b>well</b>.'],
        ['a markdown link', 'Stir [here](evil) well.'],
        ['a markdown emphasis', 'Stir *well*.'],
        ['an IP address with a path', 'Open 192.168.1.1/x now.'],
        ['a host and port', 'Open localhost:3000/x now.'],
        ['a digit in the domain', 'Open evil.c0m/x now.'],
        ['an ideographic full stop used as a dot', 'Open evil\u3002com/x now.'],
        ['spaces and a zero-width non-joiner', ' \u200C '],
        ['only joiners', '\u200C\u200D'],
        ['a combining mark beside a dot', 'Open evil\u0300.com now.'],
        ['a Devanagari host', 'Open \u0939\u093F\u0902\u0926\u0940.\u092D\u093E\u0930\u0924 now.'],
        ['a Thai host', 'Open \u0E44\u0E17\u0E22\u0E14\u0E35.com now.'],
        ['a zero-width joiner in a host', 'Open evil\u200D.com now.'],
        ['a short host', 'Open t.co now.'],
        [
            'a Japanese step with ideographic punctuation',
            '\u5C0F\u9EA6\u7C89200g\u3002\u6B21\u306B\u6DB2\u3092\u52A0\u3048\u307E\u3059\u3002',
        ],
        ['a Japanese word', '\u30D0\u30BF\u30FC\u3092\u6EB6\u304B\u3057\u307E\u3059'],
        ['an Arabic-Indic digit', 'Add \u0663 eggs.'],
        ['a full-width digit', 'Add \uFF13 eggs.'],
        ['a Persian word with a joiner', '\u0645\u06CC\u200C\u062E\u0648\u0627\u0647\u0645'],
        ['a full-width full stop used as a dot', 'Open evil\uFF0Ecom now.'],
        ['full-width letters and an ideographic full stop', 'Open ｅｖｉｌ。ｃｏｍ now.'],
        ['mixed-width letters and an ideographic full stop', 'Open evil。ｃom now.'],
        ['a javascript scheme', 'Run javascript:alert(1) now.'],
        ['a data scheme', 'Open data:text/html,hi now.'],
        ['a vbscript scheme', 'Run vbscript:x now.'],
        ['a file scheme', 'Open file:x now.'],
        ['an http scheme', 'Open http:x now.'],
        ['an https scheme', 'Open https:x now.'],
        ['a host spelt with the abbreviation e.g.', 'Open e.g.com now.'],
        ['a hidden character beside a dot', 'Open evil\u034F.com now.'],
        ['a hidden character in plain words', 'Stir\u034F well.'],
        ['a variation selector in plain words', 'Stir\uFE0F well.'],
        [
            'a Cyrillic host with an ideographic full stop',
            'Open \u043F\u0440\u0438\u043C\u0435\u0440\u3002\u0440\u0444 now.',
        ],
        ['a Han top level after an ASCII host', 'Open evil\u3002\u4E2D\u56FD now.'],
        ['a template placeholder', 'Stir {{name}} well.'],
        ['a backslash escape', 'Stir\\nwell.'],
        ['a line break', 'Stir.\nThen serve.'],
        ['a control character', 'Stir\u0007 well.'],
        ['an emoji', 'Stir well 🙂.'],
    ])('refuses %s', (_name, text) => {
        expect(parseStepAnswer(one(text), 80)).toEqual({ refused: 'unsafeText' });
    });

    it('accepts plain prose with fractions, decimals, degrees, accents and punctuation', () => {
        const text = 'Fold 1/2 cup crème fraîche and 2.5 tbsp sugar (about 30 g) in; bake at 200 °C for 20-25 minutes!';

        expect(parseStepAnswer(one(text), 80)).toMatchObject({ ok: true });
    });

    it('accepts a plus sign between ingredients', () => {
        expect(parseStepAnswer(one('Season with salt + pepper.'), 80)).toMatchObject({ ok: true });
    });

    it('accepts every mark a fact name may hold, so the two character sets cannot drift apart', () => {
        for (const mark of PLAIN_FACT_PUNCTUATION) {
            expect(parseStepAnswer(one(`Add a${mark} b`), 80)).toMatchObject({ ok: true });
        }
    });

    it('accepts a time with a colon', () => {
        expect(parseStepAnswer(one('Rest for 1:30 minutes.'), 80)).toMatchObject({ ok: true });
    });

    it('accepts the plain Latin cases a recipe needs', () => {
        for (const text of [
            'A.1. sauce',
            '2 fl.oz.',
            'crème fraîche',
            'St. Louis',
            '2.5 cups',
            '\u00BD cup',
            'Rest 1:30.',
        ]) {
            expect(parseStepAnswer(one(text), 80)).toMatchObject({ ok: true });
        }
    });

    it('returns NFC text, so a decomposed letter comes back composed', () => {
        const result = parseStepAnswer(one('Fry the jalapen\u0303o.'), 80);

        expect(result).toEqual({ ok: true, steps: [{ text: 'Fry the jalape\u00F1o.', covers: [0] }] });
    });

    it('checks every step, not only the first', () => {
        const text = answer([
            { text: 'Melt the butter.', covers: [0] },
            { text: 'Visit www.evil.example now.', covers: [1] },
        ]);

        expect(parseStepAnswer(text, 80)).toEqual({ refused: 'unsafeText' });
    });
});

describe('parseStepAnswer, the cap', () => {
    const valid = answer([{ text: 'Melt.', covers: [0] }]);

    it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, MAX_ANSWER_CAP + 1])('rejects the cap %s', (cap) => {
        expect(() => parseStepAnswer(valid, cap)).toThrow(RangeError);
    });

    it('accepts the smallest and the largest cap', () => {
        expect(parseStepAnswer(valid, 1)).toMatchObject({ ok: true });
        expect(parseStepAnswer(valid, MAX_ANSWER_CAP)).toMatchObject({ ok: true });
    });
});
