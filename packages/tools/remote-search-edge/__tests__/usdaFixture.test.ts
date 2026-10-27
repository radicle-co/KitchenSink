/**
 * The USDA double the local sandbox puts behind the real remote search handler.
 *
 * It exists so provision (`ensureRemoteProbeWords`) and the remote-food Maestro flows run against local services
 * with no call to a third-party API. What makes it correct is not that it returns food-shaped JSON but that the
 * words the e2e tier probes are ACCEPTED by the tier's own judge (`judgeProbe`) when searched through it. Those
 * tests import the judge and the candidate lists, so a new probe word that this double cannot serve fails here.
 */
import { describe, expect, it } from 'vitest';

import {
    judgeProbe,
    NO_MATCH_FOOD_NAME,
    PROBE_CANDIDATES,
    PROBE_ROLES,
    type ProbeRole,
} from '@kitchensink/e2e-seed/remoteProbeWords';
import { RawUsdaSearchResultSchema } from '@kitchensink/usda-client';

import { createUsdaFixture } from '../src/usdaFixture.js';

const wordsOf = (platform: 'android' | 'ios'): readonly (readonly [ProbeRole, string])[] =>
    PROBE_ROLES.flatMap((role) =>
        role === 'noMatch' ? [] : PROBE_CANDIDATES[platform][role].map((word) => [role, word] as const),
    );

describe('searching the USDA double', () => {
    const usda = createUsdaFixture();

    it.each([...wordsOf('android'), ...wordsOf('ios')])(
        'serves the %s probe word %s so the e2e judge accepts it',
        (role, word) => {
            const names = usda.search(word).foods.map((food) => food.description);

            expect(
                judgeProbe(role, word, { kind: 'answered', catalogCount: 0, authoredCount: 0, items: names }),
            ).toEqual({ kind: 'accepted' });
        },
    );

    it('finds nothing for the name the create-a-food story types, so only the create offer shows', () => {
        const names = usda.search(NO_MATCH_FOOD_NAME).foods.map((food) => food.description);

        expect(
            judgeProbe('noMatch', NO_MATCH_FOOD_NAME, {
                kind: 'answered',
                catalogCount: 0,
                authoredCount: 0,
                items: names,
            }),
        ).toEqual({ kind: 'accepted' });
    });

    it('answers in the shape the real USDA client validates', () => {
        expect(() => RawUsdaSearchResultSchema.parse(usda.search('tahini'))).not.toThrow();
    });

    it('is deterministic: the same query gives the same foods, ids included', () => {
        expect(usda.search('Tahini')).toEqual(createUsdaFixture().search('tahini'));
    });

    it('gives every probe word its own foods, so adopting one never makes another word look held', () => {
        const ids = [...wordsOf('android'), ...wordsOf('ios')].flatMap(([, word]) =>
            usda.search(word).foods.map((food) => food.fdcId),
        );

        // The same word on two roles would repeat; a CROSS-word collision is what this guards.
        const distinctWords = new Set([...wordsOf('android'), ...wordsOf('ios')].map(([, word]) => word));

        expect(new Set(ids).size).toBe(distinctWords.size * usda.search('tahini').foods.length);
    });
});

describe('fetching a food the double listed', () => {
    it('returns the detail of a hit it served, named as it was listed', () => {
        const usda = createUsdaFixture();
        const [hit] = usda.search('gochujang').foods;

        expect(hit).toBeDefined();
        expect(usda.detail(hit?.fdcId ?? 0)).toMatchObject({ fdcId: hit?.fdcId, description: hit?.description });
    });

    it('carries the macros the catalog stores', () => {
        const usda = createUsdaFixture();
        const [hit] = usda.search('gochujang').foods;
        const nutrients = usda.detail(hit?.fdcId ?? 0)?.foodNutrients.map((nutrient) => nutrient.nutrientId);

        expect(nutrients).toEqual(expect.arrayContaining([1008, 1003, 1004, 1005]));
    });

    it('knows nothing of an id it never listed', () => {
        expect(createUsdaFixture().detail(1)).toBeUndefined();
    });
});
