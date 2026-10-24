import { describe, expect, it } from 'vitest';

import { classifyParseResponse } from '../parseResponse.js';

/** The shape the prompt asks for, spelled the way a compliant model spells it. */
const BARE = '{"measure":"one-half cup","foods":[{"name":"butter","prep":null}]}';

describe('classifyParseResponse', () => {
    describe('valid', () => {
        it('accepts the bare document', () => {
            const outcome = classifyParseResponse(BARE, 'end_turn');

            expect(outcome.kind).toBe('valid');

            if (outcome.kind !== 'valid') {
                return;
            }

            expect(outcome.parse.measure).toBe('one-half cup');
            expect(outcome.parse.foods).toEqual([{ name: 'butter', prep: null }]);
        });

        it('accepts the pretty-printed document every Nova model actually emits', () => {
            const pretty =
                '{\n  "measure": "one-half cup",\n  "foods": [\n    {\n      "name": "butter",\n      "prep": null\n    }\n  ]\n}';

            expect(classifyParseResponse(pretty, 'end_turn').kind).toBe('valid');
        });

        it('accepts surrounding whitespace, which is not prose', () => {
            expect(classifyParseResponse(`\n\n${BARE}\n `, 'end_turn').kind).toBe('valid');
        });

        it('accepts a stated prep', () => {
            const outcome = classifyParseResponse(
                '{"measure":"3 cloves","foods":[{"name":"garlic","prep":"minced"}]}',
                'end_turn',
            );

            expect(outcome.kind).toBe('valid');

            if (outcome.kind !== 'valid') {
                return;
            }

            expect(outcome.parse.foods[0]?.prep).toBe('minced');
        });

        it('accepts several foods on one line', () => {
            const outcome = classifyParseResponse(
                '{"measure":"one-half cup each","foods":[{"name":"carrots","prep":null},{"name":"celery","prep":null}]}',
                'end_turn',
            );

            expect(outcome.kind).toBe('valid');

            if (outcome.kind !== 'valid') {
                return;
            }

            expect(outcome.parse.foods).toHaveLength(2);
        });

        it('accepts an empty measure — a line may state none, and that is an answer', () => {
            expect(classifyParseResponse('{"measure":"","foods":[{"name":"salt","prep":null}]}', 'end_turn').kind).toBe(
                'valid',
            );
        });
    });

    describe('truncated', () => {
        it('is decided by the stop reason, not by whether the fragment happens to parse', () => {
            expect(classifyParseResponse(BARE, 'max_tokens').kind).toBe('truncated');
        });

        it('classifies a cut-off fragment as truncated rather than malformed', () => {
            expect(classifyParseResponse('{"measure":"one-half cup","foods":[{"na', 'max_tokens').kind).toBe(
                'truncated',
            );
        });
    });

    describe('proseWrapper', () => {
        it('refuses a markdown-fenced document — Nova Lite emits this and our reader takes whole documents only', () => {
            const outcome = classifyParseResponse(`\`\`\`json\n${BARE}\n\`\`\``, 'end_turn');

            expect(outcome.kind).toBe('proseWrapper');

            if (outcome.kind !== 'proseWrapper') {
                return;
            }

            expect(outcome.wrapper).toBe('codeFence');
        });

        it('refuses an unlabelled fence', () => {
            expect(classifyParseResponse(`\`\`\`\n${BARE}\n\`\`\``, 'end_turn').kind).toBe('proseWrapper');
        });

        it('refuses a leading sentence', () => {
            const outcome = classifyParseResponse(`Here is the JSON:\n${BARE}`, 'end_turn');

            expect(outcome.kind).toBe('proseWrapper');

            if (outcome.kind !== 'proseWrapper') {
                return;
            }

            expect(outcome.wrapper).toBe('proseText');
        });

        it('refuses a trailing sentence', () => {
            expect(classifyParseResponse(`${BARE}\n\nLet me know if you need anything else.`, 'end_turn').kind).toBe(
                'proseWrapper',
            );
        });

        it('still carries the embedded parse, so a wrapper can be told from a wrong answer', () => {
            const outcome = classifyParseResponse(`\`\`\`json\n${BARE}\n\`\`\``, 'end_turn');

            expect(outcome.kind).toBe('proseWrapper');

            if (outcome.kind !== 'proseWrapper') {
                return;
            }

            expect(outcome.parse?.measure).toBe('one-half cup');
        });
    });

    describe('malformedJson', () => {
        it('refuses a stray closing bracket — one of the shapes the previous run measured', () => {
            expect(classifyParseResponse(`${BARE}]`, 'end_turn').kind).toBe('malformedJson');
        });

        it('refuses a field opened with a double quote and closed with a single one', () => {
            expect(
                classifyParseResponse('{"measure":"one-half cup\',"foods":[{"name":"butter","prep":null}]}', 'end_turn')
                    .kind,
            ).toBe('malformedJson');
        });

        it('refuses an empty response', () => {
            expect(classifyParseResponse('', 'end_turn').kind).toBe('malformedJson');
        });

        it('refuses prose carrying no JSON at all', () => {
            expect(classifyParseResponse('I cannot parse that line.', 'end_turn').kind).toBe('malformedJson');
        });
    });

    describe('wrongShape', () => {
        it('refuses a JSON array where the document must be an object', () => {
            expect(classifyParseResponse('[{"name":"butter"}]', 'end_turn').kind).toBe('wrongShape');
        });

        it('refuses a missing foods key', () => {
            expect(classifyParseResponse('{"measure":"one-half cup"}', 'end_turn').kind).toBe('wrongShape');
        });

        it('refuses foods as a bare string', () => {
            expect(classifyParseResponse('{"measure":"one cup","foods":"butter"}', 'end_turn').kind).toBe('wrongShape');
        });

        it("refuses a numeric measure — the prompt asks for the line's own words", () => {
            expect(
                classifyParseResponse('{"measure":0.5,"foods":[{"name":"butter","prep":null}]}', 'end_turn').kind,
            ).toBe('wrongShape');
        });

        it('refuses a missing prep key rather than defaulting it', () => {
            expect(classifyParseResponse('{"measure":"one cup","foods":[{"name":"butter"}]}', 'end_turn').kind).toBe(
                'wrongShape',
            );
        });

        it('refuses an extra key — the declared shape is the whole contract', () => {
            const outcome = classifyParseResponse(
                '{"measure":"one cup","foods":[{"name":"butter","prep":null}],"quantity":1}',
                'end_turn',
            );

            expect(outcome.kind).toBe('wrongShape');

            if (outcome.kind !== 'wrongShape') {
                return;
            }

            expect(outcome.detail).toContain('quantity');
        });

        it('records why the shape failed, so the census is readable without the raw log', () => {
            const outcome = classifyParseResponse('{"measure":"one-half cup"}', 'end_turn');

            expect(outcome.kind).toBe('wrongShape');

            if (outcome.kind !== 'wrongShape') {
                return;
            }

            expect(outcome.detail).toContain('foods');
        });
    });
});
