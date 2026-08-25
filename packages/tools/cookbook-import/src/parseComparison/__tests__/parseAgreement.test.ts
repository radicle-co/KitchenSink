import { describe, expect, it } from 'vitest';

import type { CrfParse } from '../crfParse.js';
import { compareParses, disposeAgreement, divergentFields, divergentResponses } from '../parseAgreement.js';
import type { AgreementKind } from '../parseAgreement.js';
import type { ModelParse } from '../parseResponse.js';

function crf(overrides: Partial<CrfParse> = {}): CrfParse {
    return {
        sentence: 'one-half cup of butter',
        measure: '1/2 cups',
        names: ['butter'],
        size: null,
        preparation: null,
        comment: null,
        ...overrides,
    };
}

function model(overrides: Partial<ModelParse> = {}): ModelParse {
    return { measure: 'one-half cup', foods: [{ name: 'butter', prep: null }], ...overrides };
}

describe('compareParses — measure', () => {
    it('agrees when a number word and a numeral state the same amount of the same unit', () => {
        const agreement = compareParses(model(), crf());

        expect(agreement.measure).toBe('agree');
        expect(agreement.agrees).toBe(true);
        expect(agreement.kind).toBe('agree');
    });

    it('agrees when both sides state no measure at all', () => {
        expect(compareParses(model({ measure: '' }), crf({ measure: '' })).measure).toBe('agree');
    });

    it('names the CRF losing a historical unit into the food name, rather than calling it a plain difference', () => {
        const agreement = compareParses(
            { measure: 'one gill', foods: [{ name: 'milk', prep: null }] },
            crf({ sentence: 'one gill of milk', measure: '1', names: ['gill of milk'] }),
        );

        expect(agreement.measure).toBe('crfUnitInName');
        expect(agreement.kind).toBe('crfUnitInName');
    });

    it('names the CRF routing a descriptor to its own size field, which our shape has no slot for', () => {
        const agreement = compareParses(
            { measure: 'one large', foods: [{ name: 'chicken', prep: null }] },
            crf({ sentence: 'one large chicken', measure: '1', names: ['chicken'], size: 'large' }),
        );

        expect(agreement.measure).toBe('crfSizeField');
    });

    it('reports a genuine unit disagreement as one', () => {
        const agreement = compareParses(model({ measure: 'one-half pound' }), crf());

        expect(agreement.measure).toBe('unitDiffers');
    });

    it('reports a quantity disagreement under an agreed unit as one', () => {
        const agreement = compareParses(model({ measure: 'two cups' }), crf({ measure: '3 cups' }));

        expect(agreement.measure).toBe('quantityDiffers');
    });

    it('reports the model losing a unit the CRF read as a unit disagreement, not as a CRF defect', () => {
        const agreement = compareParses(model({ measure: 'one-half' }), crf());

        expect(agreement.measure).toBe('unitDiffers');
    });
});

describe('compareParses — food names', () => {
    it('agrees on the same food spelled with a different plural', () => {
        const agreement = compareParses(
            { measure: 'one-quarter pound', foods: [{ name: 'chicken livers', prep: null }] },
            crf({ measure: '1/4 pounds', names: ['chicken liver'] }),
        );

        expect(agreement.names).toBe('agree');
    });

    it('names the model splitting one CRF name into several foods', () => {
        const agreement = compareParses(
            {
                measure: 'one-half cup each',
                foods: [
                    { name: 'carrots', prep: null },
                    { name: 'celery', prep: null },
                ],
            },
            crf({ measure: '1/2 cups', names: ['carrots and celery'] }),
        );

        expect(agreement.names).toBe('modelSplitsFoods');
    });

    it('reports a genuinely different food as a difference', () => {
        expect(compareParses(model({ foods: [{ name: 'lard', prep: null }] }), crf()).names).toBe('differ');
    });

    it('does not accept a superset as agreement — an extra food is a difference', () => {
        const agreement = compareParses(
            {
                measure: 'one-half cup',
                foods: [
                    { name: 'butter', prep: null },
                    { name: 'lard', prep: null },
                ],
            },
            crf(),
        );

        expect(agreement.names).toBe('differ');
    });

    it('ignores the order the two parsers listed the foods in', () => {
        const agreement = compareParses(
            {
                measure: 'one-half cup',
                foods: [
                    { name: 'celery', prep: null },
                    { name: 'carrots', prep: null },
                ],
            },
            crf({ names: ['carrots', 'celery'] }),
        );

        expect(agreement.names).toBe('agree');
    });
});

describe('compareParses — preparation', () => {
    it('agrees when both sides state the same preparation', () => {
        const agreement = compareParses(
            { measure: '3 cloves', foods: [{ name: 'garlic', prep: 'minced' }] },
            crf({ sentence: '3 cloves garlic, minced', measure: '3 cloves', names: ['garlic'], preparation: 'minced' }),
        );

        expect(agreement.prep).toBe('agree');
    });

    it('agrees when neither side states one', () => {
        expect(compareParses(model(), crf()).prep).toBe('agree');
    });

    it('names the CRF taking a state word out of the food name — the case that moves a nutrition row', () => {
        const agreement = compareParses(
            { measure: 'two cups', foods: [{ name: 'toasted breadcrumbs', prep: null }] },
            crf({ measure: '2 cups', names: ['breadcrumbs'], preparation: 'toasted' }),
        );

        expect(agreement.prep).toBe('crfPrepInModelName');
    });

    it('names the model taking a state word out of the food name', () => {
        const agreement = compareParses(
            { measure: 'two cups', foods: [{ name: 'breadcrumbs', prep: 'toasted' }] },
            crf({ measure: '2 cups', names: ['toasted breadcrumbs'] }),
        );

        expect(agreement.prep).toBe('modelPrepInCrfName');
    });

    it('reports two different preparations as a difference', () => {
        const agreement = compareParses(
            { measure: '3 cloves', foods: [{ name: 'garlic', prep: 'grated' }] },
            crf({ measure: '3 cloves', names: ['garlic'], preparation: 'minced' }),
        );

        expect(agreement.prep).toBe('differ');
    });
});

describe('compareParses — the reported kind', () => {
    it('is the measure verdict when the measure disagrees, whatever else also does', () => {
        const agreement = compareParses(
            { measure: 'one-half pound', foods: [{ name: 'lard', prep: 'melted' }] },
            crf(),
        );

        expect(agreement.kind).toBe('unitDiffers');
        expect(agreement.agrees).toBe(false);
    });

    it('falls through to the name verdict when only the name disagrees', () => {
        expect(compareParses(model({ foods: [{ name: 'lard', prep: null }] }), crf()).kind).toBe('differ');
    });

    it('falls through to the preparation verdict when only the preparation disagrees', () => {
        const agreement = compareParses(model({ foods: [{ name: 'butter', prep: 'melted' }] }), crf());

        expect(agreement.kind).toBe('differ');
        expect(agreement.prep).toBe('differ');
    });
});

describe('divergentFields', () => {
    it('reports nothing for two byte-identical answers', () => {
        expect(divergentFields(model(), model())).toEqual([]);
    });

    it('reports nothing for two answers that differ only in spelling the same content', () => {
        expect(divergentFields(model(), model({ measure: 'One-Half  Cup' }))).toEqual([]);
    });

    it('reports the measure when the two runs read a different amount', () => {
        expect(divergentFields(model(), model({ measure: 'one cup' }))).toEqual(['measure']);
    });

    it('reports foods when the two runs name a different food', () => {
        expect(divergentFields(model(), model({ foods: [{ name: 'lard', prep: null }] }))).toEqual(['foods']);
    });

    it('reports prep when one run states a preparation the other does not — the observed flip', () => {
        expect(divergentFields(model(), model({ foods: [{ name: 'butter', prep: 'shred' }] }))).toEqual(['prep']);
    });

    it('reports every field that moved', () => {
        expect(divergentFields(model(), { measure: 'one cup', foods: [{ name: 'lard', prep: 'melted' }] })).toEqual([
            'measure',
            'foods',
            'prep',
        ]);
    });

    it('treats a different number of foods as a foods divergence', () => {
        expect(
            divergentFields(model(), {
                measure: 'one-half cup',
                foods: [
                    { name: 'butter', prep: null },
                    { name: 'lard', prep: null },
                ],
            }),
        ).toEqual(['foods']);
    });
});

describe('divergentResponses', () => {
    const BARE = '{"measure":"one-half cup","foods":[{"name":"butter","prep":null}]}';
    const OTHER = '{"measure":"one cup","foods":[{"name":"butter","prep":null}]}';
    const fence = (body: string): string => ['```json', body, '```'].join('\n');

    it('compares two bare documents on what they say', () => {
        expect(divergentResponses(BARE, BARE)).toEqual({ kind: 'comparable', fields: [] });
        expect(divergentResponses(BARE, OTHER)).toEqual({ kind: 'comparable', fields: ['measure'] });
    });

    it('compares a bare document with a fenced one — a wrapper is a contract failure, not a divergence', () => {
        expect(divergentResponses(BARE, fence(BARE))).toEqual({ kind: 'comparable', fields: [] });
    });

    it('compares two fenced documents, so a model that always wraps is still measurable for stability', () => {
        expect(divergentResponses(fence(BARE), fence(OTHER))).toEqual({
            kind: 'comparable',
            fields: ['measure'],
        });
    });

    it('reports a pair it cannot read as INCOMPARABLE rather than as a divergence of every field', () => {
        expect(divergentResponses(BARE, 'I cannot parse that line.')).toEqual({ kind: 'incomparable' });
    });

    it('reports two unreadable responses as incomparable, not as agreement', () => {
        expect(divergentResponses('nope', 'nope')).toEqual({ kind: 'incomparable' });
    });

    it('reports a cut-off fragment as incomparable — an unfinished answer states nothing to compare', () => {
        expect(divergentResponses(BARE, '{"measure":"one-half cup","foods":[{"na')).toEqual({ kind: 'incomparable' });
    });
});

describe('disposeAgreement — KTD-11’s disposition column, which the shape classifier did not carry', () => {
    it('disposes of every shape the classifier can produce', () => {
        // ⛔ Keyed by a TOTAL `Record` over the union rather than listed as an array literal. An array is
        // assignable to `readonly AgreementKind[]` however short it is, so the list this suite used to
        // carry would have gone on passing while never exercising a newly added verdict — the exact hole
        // `DISPOSITIONS` itself is a total `Record` to avoid. A member added to any of the three per-field
        // unions is now a compile error HERE too.
        const everyShape: Readonly<Record<AgreementKind, true>> = {
            agree: true,
            crfUnitInName: true,
            crfUnitAbsent: true,
            crfSizeField: true,
            amountCountDiffers: true,
            unitDiffers: true,
            quantityDiffers: true,
            modelSplitsFoods: true,
            crfPrepInModelName: true,
            modelPrepInCrfName: true,
            differ: true,
        };
        const shapes = Object.keys(everyShape) as readonly AgreementKind[];

        for (const shape of shapes) {
            expect(() => disposeAgreement(shape), `no disposition for ${shape}`).not.toThrow();
        }
    });

    it('gives agreement nothing to dispose of', () => {
        expect(disposeAgreement('agree')).toBe('agreed');
    });

    it('gives the CRF the amounts — KTD-11: "CRF wins, record both"', () => {
        expect(disposeAgreement('quantityDiffers')).toBe('crfWins');
        expect(disposeAgreement('unitDiffers')).toBe('crfWins');
        expect(disposeAgreement('amountCountDiffers')).toBe('crfWins');
    });

    it('gives the LLM the three shapes KTD-11 marks "LLM wins silently"', () => {
        expect(disposeAgreement('crfUnitInName')).toBe('llmWins');
        expect(disposeAgreement('modelSplitsFoods')).toBe('llmWins');
        expect(disposeAgreement('modelPrepInCrfName')).toBe('llmWins');
    });

    it('canonicalises the size field rather than picking a side — `large` is an adjective (KTD-11b)', () => {
        expect(disposeAgreement('crfSizeField')).toBe('canonicalised');
    });

    it('canonicalises placement in BOTH directions, so the mirror shape is not silently a human problem', () => {
        // ⛔ `crfPrepInModelName` is absent from KTD-11's measured table (it scored n = 0 on Nova Micro),
        // so a table-driven map transcribed from the report would have had no row for it. It is the
        // MIRROR of `modelPrepInCrfName` and the same ruling settles it: placement is canonicalised,
        // never won.
        expect(disposeAgreement('crfPrepInModelName')).toBe('canonicalised');
    });

    it('sends only the unstructured residue to a human — the adjudication list', () => {
        expect(disposeAgreement('differ')).toBe('adjudicate');
    });

    it('never lets a shape KTD-11 disposes of reach a human as well', () => {
        const adjudicated = (
            [
                'crfUnitInName',
                'crfUnitAbsent',
                'crfSizeField',
                'amountCountDiffers',
                'unitDiffers',
                'quantityDiffers',
            ] as const
        ).filter((shape) => disposeAgreement(shape) === 'adjudicate');

        expect(adjudicated, `shapes KTD-11 disposes of that still reach a human: ${adjudicated.join(', ')}`).toEqual(
            [],
        );
    });
});

/**
 * ⛔ THE CRF OUTPUTS QUOTED IN THIS BLOCK ARE MEASURED, NOT IMAGINED.
 *
 * Every `crf({ … })` below is what `ingredient-parser-nlp==2.3.0` really printed for that sentence on
 * 2026-08-25, flattened exactly as `scripts/crfParse.py` flattens it. A hand-written guess would let this
 * whole block agree with a CRF that does not exist — so `tests/crfUnitAbsent.integration.test.ts` re-derives
 * every row from the REAL engine and fails if any of them has moved.
 */
describe('compareParses — an ABSENT CRF unit is absence, not dissent (owner ruling 2026-08-25)', () => {
    it('names the CRF stating NO unit where the model stated one, rather than calling it a unit disagreement', () => {
        // Measured: `one and a half quarts of boiling water` -> amount [('1', '')], name `boiling water`.
        // The CRF dropped the fraction AND the unit; a bare `1` is not a competing reading of `1.5 quarts`.
        const agreement = compareParses(
            { measure: 'one and a half quarts', foods: [{ name: 'water', prep: 'boiling' }] },
            crf({ sentence: 'one and a half quarts of boiling water', measure: '1', names: ['boiling water'] }),
        );

        expect(agreement.measure).toBe('crfUnitAbsent');
        expect(disposeAgreement(agreement.measure)).toBe('llmWins');
    });

    it('names it on a quarter as well as a half — the shape is the empty unit, not the fraction', () => {
        // Measured: `one and a quarter cups of milk` -> amount [('1', '')], name `milk`.
        const agreement = compareParses(
            { measure: 'one and a quarter cups', foods: [{ name: 'milk', prep: null }] },
            crf({ sentence: 'one and a quarter cups of milk', measure: '1', names: ['milk'] }),
        );

        expect(agreement.measure).toBe('crfUnitAbsent');
        expect(disposeAgreement(agreement.measure)).toBe('llmWins');
    });

    it('⛔ is decided BEFORE the generic unit verdict, so an absent unit never ALSO reads as `unitDiffers`', () => {
        // The ORDERING assertion, made by observation rather than by reading `judgeMeasure`. `kind` is the
        // measure verdict whenever the measure disagrees, so a `crfUnitAbsent` that fell through to the
        // generic verdict would surface here as `unitDiffers` and be disposed of `crfWins`.
        const agreement = compareParses(
            { measure: 'one and a half quarts', foods: [{ name: 'water', prep: 'boiling' }] },
            crf({ sentence: 'one and a half quarts of boiling water', measure: '1', names: ['boiling water'] }),
        );

        expect(agreement.measure).not.toBe('unitDiffers');
        expect(agreement.kind).toBe('crfUnitAbsent');
        expect(agreement.agrees).toBe(false);
    });

    it('⛔ leaves a GENUINE unit disagreement alone — KTD-11’s `unitDiffers` → `crfWins` is NOT overturned', () => {
        // ⛔ THE ANTI-OVER-REACH ASSERTION, and the one that catches the mandatory mutant. Both engines
        // named a unit and named different ones: `one-half pound` against the CRF's `1/2 cups`. That is
        // dissent, not absence, and widening the new shape to "the units differ" swallows the whole of
        // KTD-11's amount column.
        const agreement = compareParses(model({ measure: 'one-half pound' }), crf());

        expect(agreement.measure).toBe('unitDiffers');
        expect(disposeAgreement(agreement.measure)).toBe('crfWins');
    });

    it('⛔ does NOT fire in the mirror direction — a silent MODEL is still a unit disagreement', () => {
        // The claim is about the CRF's MEASURED blindness, not a symmetry. The naming asymmetry costs
        // nothing: `unitDiffers` → `crfWins` already gives the unit to the engine that spoke.
        const agreement = compareParses(model({ measure: 'one-half' }), crf());

        expect(agreement.measure).toBe('unitDiffers');
        expect(disposeAgreement(agreement.measure)).toBe('crfWins');
    });

    it('⛔ does NOT fire when BOTH engines stated no unit — mutual silence is not absence-vs-answer', () => {
        const agreement = compareParses(model({ measure: 'two' }), crf({ measure: '3' }));

        expect(agreement.measure).toBe('quantityDiffers');
        expect(disposeAgreement(agreement.measure)).toBe('crfWins');
    });

    it('keeps the MORE SPECIFIC `crfUnitInName` when the CRF put the unit in the food name', () => {
        // Measured: `two and a half pounds of beef` -> amount [('2', '')], name `and a half pounds of beef`.
        // The unit is absent from the measure AND present in the name, so both shapes are true of the line.
        // The one that says WHERE the word went carries more information, and both dispose the same way —
        // so the ordering changes what the census NAMES, never what is done.
        const agreement = compareParses(
            { measure: 'two and a half pounds', foods: [{ name: 'beef', prep: null }] },
            crf({ sentence: 'two and a half pounds of beef', measure: '2', names: ['and a half pounds of beef'] }),
        );

        expect(agreement.measure).toBe('crfUnitInName');
        expect(disposeAgreement(agreement.measure)).toBe('llmWins');
    });

    it('keeps the MORE SPECIFIC `crfSizeField` when the CRF routed the word to its size field', () => {
        const agreement = compareParses(
            { measure: 'one large', foods: [{ name: 'chicken', prep: null }] },
            crf({ sentence: 'one large chicken', measure: '1', names: ['chicken'], size: 'large' }),
        );

        expect(agreement.measure).toBe('crfSizeField');
        expect(disposeAgreement(agreement.measure)).toBe('canonicalised');
    });

    it('⛔ leaves the spellings the CRF reads CORRECTLY on `agree` — the rule is narrow, not a blanket', () => {
        // Measured: `one and one-half cups of flour` -> [('3/2', 'cup')]; `one-half pound chocolate` ->
        // [('1/2', 'pound')]. The same 1.5-style composite, spelled the way the CRF understands. A rule
        // that fired on the PHRASE rather than on the empty unit would break both of these.
        const flour = compareParses(
            { measure: 'one and one-half cups', foods: [{ name: 'flour', prep: null }] },
            crf({ sentence: 'one and one-half cups of flour', measure: '1 1/2 cups', names: ['flour'] }),
        );
        const chocolate = compareParses(
            { measure: 'one-half pound', foods: [{ name: 'chocolate', prep: null }] },
            crf({ sentence: 'one-half pound chocolate', measure: '1/2 pounds', names: ['chocolate'] }),
        );

        expect(flour.measure).toBe('agree');
        expect(flour.kind).toBe('agree');
        expect(chocolate.measure).toBe('agree');
        expect(chocolate.kind).toBe('agree');
    });

    it('⛔ leaves the SPLIT-AMOUNT spelling on `quantityDiffers` — the CRF stated a unit, so it is dissent', () => {
        // Measured: `one and a half cups of sugar` -> amounts [('1', ''), ('half', 'cup')], which the
        // sidecar joins to `1 half cups` and the comparison fold reads as 1/2 cup. The CRF's unit is `cup`,
        // NOT empty — it answered, and answered a different number, which is exactly KTD-11's
        // `quantityDiffers`. The ruling is deliberately too narrow to reach it. ⚠️ The consequence is real,
        // measured, and recorded in ADR-0026: this spelling still resolves to half a cup for one and a half.
        const agreement = compareParses(
            { measure: 'one and a half cups', foods: [{ name: 'sugar', prep: null }] },
            crf({ sentence: 'one and a half cups of sugar', measure: '1 half cups', names: ['sugar'] }),
        );

        expect(agreement.measure).toBe('quantityDiffers');
        expect(disposeAgreement(agreement.measure)).toBe('crfWins');
    });

    it('gives the LLM the unit the CRF never stated', () => {
        expect(disposeAgreement('crfUnitAbsent')).toBe('llmWins');
    });
});
