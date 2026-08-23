import { describe, expect, it } from 'vitest';

import type { CrfParse } from '../crfParse.js';
import { compareParses, divergentFields, divergentResponses } from '../parseAgreement.js';
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
