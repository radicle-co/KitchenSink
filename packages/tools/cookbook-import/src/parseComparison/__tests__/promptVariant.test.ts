import { PARSE_SYSTEM_PROMPT } from '@kitchensink/recipe-core/parsing/parse-prompt';
import { describe, expect, it } from 'vitest';

import { compareParses } from '../parseAgreement.js';
import type { CrfParse } from '../crfParse.js';
import { classifyParseResponse } from '../parseResponse.js';
import {
    PARSE_VARIANT_IDS,
    PARSE_VARIANT_V1,
    PARSE_VARIANT_V2,
    PARSE_VARIANT_V3,
    buildVariantPrompt,
    resolveParseVariant,
    statedUnitOf,
} from '../promptVariant.js';

/**
 * The three arms of the prompt bake-off.
 *
 * The assertions here are the ones that decide whether the RUN means anything, not stylistic checks on the
 * wording. Four properties carry the whole comparison:
 *
 *  1. **v1 is the shipped prompt by reference**, not a transcription. A copy would drift and the baseline
 *     column would silently stop being the baseline.
 *  2. **Each arm judges responses against ITS OWN declared shape.** Measuring v2 against v1's `strictObject`
 *     files every well-formed v2 answer as `wrongShape`, which reads as a catastrophic prompt failure and is
 *     entirely a schema artefact — the single most likely way to get a wrong answer out of this experiment.
 *  3. **Every arm projects into ONE vocabulary**, so the CRF comparator, the non-food census and the cost
 *     arithmetic are shared rather than reimplemented per arm.
 *  4. **v3's unit is the model's claim, v1's and v2's is our derivation.** The projection must actually carry
 *     that difference, or the report's caveat would be describing machinery that is not there.
 */
function crf(overrides: Partial<CrfParse> = {}): CrfParse {
    return {
        sentence: 'x',
        measure: '',
        names: [],
        size: null,
        preparation: null,
        comment: null,
        ...overrides,
    };
}

describe('the arm registry', () => {
    it('resolves every declared id', () => {
        for (const id of PARSE_VARIANT_IDS) {
            expect(resolveParseVariant(id).id).toBe(id);
        }
    });

    it('REFUSES an unknown id rather than falling back to the baseline', () => {
        // ⛔ A silent fallback would produce a three-column report whose columns are the same prompt, and
        // nothing in the output would say so.
        expect(() => resolveParseVariant('v4')).toThrow(/not one of/);
        expect(() => resolveParseVariant('')).toThrow(/not one of/);
    });

    it('gives every arm a distinct system prompt', () => {
        const prompts = new Set(PARSE_VARIANT_IDS.map((id) => resolveParseVariant(id).systemPrompt));

        expect(prompts.size).toBe(PARSE_VARIANT_IDS.length);
    });
});

describe('v1 — the baseline', () => {
    it('IS the shipped constant, by reference and not by transcription', () => {
        expect(PARSE_VARIANT_V1.systemPrompt).toBe(PARSE_SYSTEM_PROMPT);
    });

    it('derives its unit rather than taking one the model stated', () => {
        expect(PARSE_VARIANT_V1.unitSource).toBe('derived');
    });

    it('accepts the shipped answer document', () => {
        const answer = PARSE_VARIANT_V1.readAnswer({ measure: 'one cup', foods: [{ name: 'flour', prep: null }] });

        expect(answer.ok).toBe(true);
        expect(answer.ok && answer.parse.statedUnit).toBeUndefined();
    });

    it('REJECTS a document carrying an equipment slot it never asked for', () => {
        const answer = PARSE_VARIANT_V1.readAnswer({ measure: 'one cup', equipment: null, foods: [] });

        expect(answer.ok).toBe(false);
    });
});

describe('v2 — equipment as a drain', () => {
    it('drops the greedy "several words name one food" sentence the hypothesis blames', () => {
        expect(PARSE_SYSTEM_PROMPT).toContain('Several words may together name one food');
        expect(PARSE_VARIANT_V2.systemPrompt).not.toContain('Several words may together name one food');
    });

    it('declares an equipment slot in the answer shape it prints', () => {
        expect(PARSE_VARIANT_V2.systemPrompt).toContain('"equipment"');
    });

    it('names no vessel words, so the metric is not measuring an enumeration handed to the model', () => {
        // ⛔ The headline scores `foods` against the vessel lexicon. Listing `bowl`/`pan`/`sieve` in the
        // prompt would teach the model the detector's own vocabulary and inflate the result.
        for (const vessel of ['bowl', 'pan', 'kettle', 'sieve', 'colander', 'mould', 'spider']) {
            expect(PARSE_VARIANT_V2.systemPrompt.toLowerCase()).not.toContain(vessel);
        }
    });

    it('accepts its own document, which v1 would have called wrongShape', () => {
        const document = { measure: 'one cup', equipment: 'a bowl', foods: [{ name: 'flour', prep: null }] };

        expect(PARSE_VARIANT_V2.readAnswer(document).ok).toBe(true);
        expect(PARSE_VARIANT_V1.readAnswer(document).ok).toBe(false);
    });

    it('accepts a null equipment, because a line naming no equipment is the common case', () => {
        expect(PARSE_VARIANT_V2.readAnswer({ measure: '', equipment: null, foods: [] }).ok).toBe(true);
    });

    it('spells `measure` exactly as v1 does, so the known benign `null` cancels out of the comparison', () => {
        expect(PARSE_VARIANT_V2.readAnswer({ measure: null, equipment: null, foods: [] }).ok).toBe(false);
        expect(PARSE_VARIANT_V1.readAnswer({ measure: null, foods: [] }).ok).toBe(false);
    });

    it('DISCARDS the equipment value rather than projecting it anywhere', () => {
        const answer = PARSE_VARIANT_V2.readAnswer({
            measure: 'one cup',
            equipment: 'a large mixing bowl',
            foods: [{ name: 'flour', prep: null }],
        });

        expect(answer.ok).toBe(true);
        // ⛔ The slot's whole job is to stop `foods` being the only container. If it reached the reading,
        // v2 would be a different pipeline as well as a different prompt.
        expect(answer.ok && answer.parse.foods.map((food) => food.name)).toEqual(['flour']);
        expect(answer.ok && answer.parse.statedUnit).toBeUndefined();
    });

    it('still derives its unit from the measure phrase', () => {
        expect(PARSE_VARIANT_V2.unitSource).toBe('derived');
    });
});

describe('v3 — full slots', () => {
    it('takes the unit the model states rather than deriving one', () => {
        expect(PARSE_VARIANT_V3.unitSource).toBe('model-stated');

        const answer = PARSE_VARIANT_V3.readAnswer({
            measurements: 'two',
            equipment: null,
            prep: null,
            units: 'cups',
            foods: ['flour'],
        });

        expect(answer.ok && answer.parse.statedUnit).toBe('cups');
    });

    it('records a stated ABSENCE of a unit as an empty string, never as "derive it yourself"', () => {
        // ⛔ `undefined` and `''` are different answers. An arm WITH a unit slot that answered "none" has
        // made a reading; collapsing it onto `undefined` would silently re-derive the unit from the phrase
        // on exactly the lines where the model disagreed with our derivation.
        const answer = PARSE_VARIANT_V3.readAnswer({
            measurements: 'a pinch',
            equipment: null,
            prep: null,
            units: null,
            foods: ['salt'],
        });

        expect(answer.ok && answer.parse.statedUnit).toBe('');
        expect(statedUnitOf(null)).toBe('');
        expect(statedUnitOf('  cups  ')).toBe('cups');
    });

    it('projects its bare food names into the common {name, prep} vocabulary', () => {
        const answer = PARSE_VARIANT_V3.readAnswer({
            measurements: 'two',
            equipment: null,
            prep: 'chopped',
            units: null,
            foods: ['onions', 'carrots'],
        });

        // Top-level `prep` replicates onto every food. `judgePrep` compares SETS of non-empty preparations,
        // so one clause replicated twice and the same clause stated once are the same value.
        expect(answer.ok && answer.parse.foods).toEqual([
            { name: 'onions', prep: 'chopped' },
            { name: 'carrots', prep: 'chopped' },
        ]);
    });

    it('rejects v1’s and v2’s documents, and they reject its own', () => {
        const v3Document = { measurements: '', equipment: null, prep: null, units: null, foods: [] };

        expect(PARSE_VARIANT_V3.readAnswer(v3Document).ok).toBe(true);
        expect(PARSE_VARIANT_V1.readAnswer(v3Document).ok).toBe(false);
        expect(PARSE_VARIANT_V2.readAnswer(v3Document).ok).toBe(false);
        expect(PARSE_VARIANT_V3.readAnswer({ measure: '', foods: [] }).ok).toBe(false);
    });

    it('opens with the role framing the owner asked to be measured', () => {
        expect(PARSE_VARIANT_V3.systemPrompt.startsWith('You are an experienced chef')).toBe(true);
    });
});

describe('the stated unit reaches the CRF comparison', () => {
    it('uses the model’s unit, not one read out of the measure phrase', () => {
        // The CRF read `2` and no unit; v3 says the unit is `cups`. The comparator must see `cup`.
        const answer = PARSE_VARIANT_V3.readAnswer({
            measurements: '2',
            equipment: null,
            prep: null,
            units: 'cups',
            foods: ['flour'],
        });

        expect(answer.ok).toBe(true);

        const agreement = answer.ok
            ? compareParses(answer.parse, crf({ measure: '2 cups', names: ['flour'] }))
            : undefined;

        // ⛔ Would be `crfUnitAbsent`/`unitDiffers` if the stated unit were dropped: the measure PHRASE `2`
        // yields no unit at all.
        expect(agreement?.measure).toBe('agree');
    });

    it('does not read a unit the model restated inside the phrase as a SECOND amount', () => {
        // ⚠️ `measurements: "2 cups"` + `units: "cups"` is the common consistent filling. Appending the
        // stated unit to the residue instead of replacing the derived one reports `amountCountDiffers` —
        // a disagreement about nothing, manufactured by the fold.
        const answer = PARSE_VARIANT_V3.readAnswer({
            measurements: '2 cups',
            equipment: null,
            prep: null,
            units: 'cups',
            foods: ['flour'],
        });

        const agreement = answer.ok
            ? compareParses(answer.parse, crf({ measure: '2 cups', names: ['flour'] }))
            : undefined;

        expect(agreement?.measure).toBe('agree');
    });

    it('keeps a genuine SECOND amount in the residue', () => {
        const answer = PARSE_VARIANT_V3.readAnswer({
            measurements: '2 cups 3 tablespoons',
            equipment: null,
            prep: null,
            units: 'cups',
            foods: ['flour'],
        });

        const agreement = answer.ok
            ? compareParses(answer.parse, crf({ measure: '2 cups', names: ['flour'] }))
            : undefined;

        expect(agreement?.measure).toBe('amountCountDiffers');
    });
});

describe('buildVariantPrompt', () => {
    it('sends the arm’s system prompt with the SHIPPED delimiter, byte for byte', () => {
        for (const id of PARSE_VARIANT_IDS) {
            const variant = resolveParseVariant(id);
            const prompt = buildVariantPrompt(variant, 'one cup of flour');

            expect(prompt.systemPrompt).toBe(variant.systemPrompt);
            // ⛔ ONE authority for the delimiter across all three arms. A locally re-spelled tag would make
            // the arms incomparable while every other assertion still passed.
            expect(prompt.userMessage).toBe('<ingredient_line>one cup of flour</ingredient_line>');
        }
    });

    it('is byte-identical to the shipped assembly for the baseline arm', () => {
        expect(buildVariantPrompt(PARSE_VARIANT_V1, 'two eggs').systemPrompt).toBe(PARSE_SYSTEM_PROMPT);
    });

    it('REJECTS an over-cap line against the arm’s own longer prompt, rather than truncating it', () => {
        // ⛔ ADR-0024: an over-cap line is refused, never trimmed — a truncated line asks the model to parse
        // text the source did not write. `buildParsePrompt` can only bound v1's length, so each arm re-checks.
        expect(() => buildVariantPrompt(PARSE_VARIANT_V3, 'x'.repeat(1_900))).toThrow(/over the 2000 limit/);
    });

    it('passes the line through verbatim, including characters a sanitiser would touch', () => {
        const line = 'one cup of "flour" & <sugar>';

        expect(buildVariantPrompt(PARSE_VARIANT_V2, line).userMessage).toContain(line);
    });
});

describe('the arm reaches the response classifier', () => {
    it('calls a v2 document VALID under v2 and wrongShape under the default reader', () => {
        const text = '{"measure":"one cup","equipment":"a bowl","foods":[{"name":"flour","prep":null}]}';

        expect(classifyParseResponse(text, 'end_turn', PARSE_VARIANT_V2.readAnswer).kind).toBe('valid');
        // ⛔ THE ARTEFACT THIS EXPERIMENT MUST NOT COMMIT. Measured against v1's schema, a perfectly good v2
        // answer is a contract failure, and v2 would report as a catastrophe that never happened.
        expect(classifyParseResponse(text, 'end_turn').kind).toBe('wrongShape');
    });

    it('still applies the arm-independent rules — truncation beats shape', () => {
        const text = '{"measurements":"","equipment":null,"prep":null,"units":null,"foods":[]}';

        expect(classifyParseResponse(text, 'max_tokens', PARSE_VARIANT_V3.readAnswer).kind).toBe('truncated');
        expect(classifyParseResponse(text, 'end_turn', PARSE_VARIANT_V3.readAnswer).kind).toBe('valid');
    });

    it('unwraps a fenced answer against the arm’s shape', () => {
        const text = '```json\n{"measurements":"2","equipment":null,"prep":null,"units":"cups","foods":["flour"]}\n```';
        const outcome = classifyParseResponse(text, 'end_turn', PARSE_VARIANT_V3.readAnswer);

        expect(outcome.kind).toBe('proseWrapper');
        expect(outcome.kind === 'proseWrapper' && outcome.parse?.statedUnit).toBe('cups');
    });
});
