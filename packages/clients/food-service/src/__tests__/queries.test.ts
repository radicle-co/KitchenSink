/**
 * REWRITTEN for plan 002 S7.9: the progressive food search's cache keys (ADR-0055 point 9). The split search's two
 * keys and its one-retry rule went with the split search's hooks; the progressive read is never retried, which
 * `progressiveHooks.test.ts` pins.
 *
 * The progressive answer holds the cook's own foods in its database frame, so its key names the cook (ADR-0054), and a
 * create can address every progressive search of one cook at once (plan 002 S3 property 7).
 */
import { describe, expect, it } from 'vitest';

import { foodServiceKeys } from '../queries.js';

describe('foodServiceKeys — the progressive search', () => {
    it('keys a progressive search by the cook and its text, under the food-service namespace', () => {
        expect(foodServiceKeys.progressiveSearch('user_a', 'egg')).toStrictEqual([
            'food-service',
            'search',
            'progressive',
            'user_a',
            'egg',
        ]);
    });

    it('gives two cooks two keys for one text, so one cook never reads another’s foods', () => {
        expect(foodServiceKeys.progressiveSearch('user_a', 'egg')).not.toStrictEqual(
            foodServiceKeys.progressiveSearch('user_b', 'egg'),
        );
    });

    it('keys a search with no one signed in under a member no user id can equal', () => {
        expect(foodServiceKeys.progressiveSearch(undefined, 'egg')).toStrictEqual([
            'food-service',
            'search',
            'progressive',
            null,
            'egg',
        ]);
    });

    it('addresses every progressive search of one cook, and no other cook’s, with one prefix', () => {
        const prefix = foodServiceKeys.progressiveSearches('user_a');
        const startsWith = (key: readonly unknown[]): boolean => prefix.every((part, index) => key[index] === part);

        expect(startsWith(foodServiceKeys.progressiveSearch('user_a', 'egg'))).toBe(true);
        expect(startsWith(foodServiceKeys.progressiveSearch('user_b', 'egg'))).toBe(false);
        expect(startsWith(foodServiceKeys.progressiveSearch(undefined, 'egg'))).toBe(false);
    });
});
