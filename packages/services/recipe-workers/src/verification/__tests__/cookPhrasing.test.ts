/**
 * THE USDA → COOK PHRASING INVERSION — the half of the synthetic corpus that decides whether it measures
 * anything at all.
 *
 * ⛔ WHY THIS IS THE TEST THAT MATTERS. The corpus's ground truth is known BY CONSTRUCTION: the candidate is
 * the catalog row the line was derived FROM, so "correct" is true by definition rather than by annotation.
 * That guarantee is only worth having if the derived line still NAMES the row a human would name — a phrasing
 * so mangled that a competent cook would not recognise the food turns every model disagreement into a false
 * disagree that says nothing about the model. So the inversion is pinned here, example by example, against
 * real USDA descriptions taken verbatim from the seeded catalog.
 *
 * ⚠️ The bias this introduces runs in the SAFE direction and is asserted rather than assumed: a stilted noun
 * phrase makes the judging task HARDER, which inflates disagreement — so a low false-disagree rate measured
 * on this corpus is not flattered by the phrasing.
 */
import { describe, expect, it } from 'vitest';

import { cookNounPhrase, isInvertibleUsdaName, usdaSegments } from '../cookPhrasing.js';

describe('usdaSegments', () => {
    it('splits on commas and trims, including the rows written without a space after the comma', () => {
        expect(usdaSegments('Water convolvulus,raw')).toEqual(['Water convolvulus', 'raw']);
        expect(usdaSegments('Flour, wheat, all-purpose, enriched')).toEqual([
            'Flour',
            'wheat',
            'all-purpose',
            'enriched',
        ]);
    });

    it('drops empty segments so a trailing comma cannot manufacture a blank descriptor', () => {
        expect(usdaSegments('Cheese, feta,')).toEqual(['Cheese', 'feta']);
    });
});

describe('isInvertibleUsdaName', () => {
    it('accepts a plain head-plus-descriptors description', () => {
        expect(isInvertibleUsdaName('Bread, wheat, sprouted')).toBe(true);
        expect(isInvertibleUsdaName('Cheese, cheshire')).toBe(true);
        expect(isInvertibleUsdaName('Apples, gala, with skin, raw')).toBe(true);
    });

    it('rejects a single-segment name, which carries no descriptor to invert', () => {
        expect(isInvertibleUsdaName('Pummelo')).toBe(false);
    });

    it('rejects a description with more than four segments, where the tail stops being adjectival', () => {
        expect(
            isInvertibleUsdaName('Beef, chuck, arm pot roast, separable lean only, trimmed to 0 inch fat, raw'),
        ).toBe(false);
    });

    it('rejects BRANDED rows — a brand name is not a phrasing a cook derives from the catalog', () => {
        expect(isInvertibleUsdaName('George Weston Bakeries, Thomas English Muffins')).toBe(false);
        expect(isInvertibleUsdaName('KFC, Fried Chicken, ORIGINAL RECIPE, Skin and Breading')).toBe(false);
        expect(isInvertibleUsdaName('Beverages, Energy drink, FULL THROTTLE')).toBe(false);
        expect(isInvertibleUsdaName('Vitasoy USA Azumaya, Extra Firm Tofu')).toBe(false);
    });

    it('rejects parentheticals, semicolons and digits, which are catalog bookkeeping rather than phrasing', () => {
        expect(isInvertibleUsdaName('Moose, meat, raw (Alaska Native)')).toBe(false);
        expect(isInvertibleUsdaName('Oil, industrial, palm kernel (hydrogenated)')).toBe(false);
        expect(isInvertibleUsdaName('Cheese, cheddar; 45% reduced fat')).toBe(false);
        expect(isInvertibleUsdaName('Beef, round, trimmed to 0 inch fat')).toBe(false);
    });

    it('rejects a CATEGORY head, because its siblings are unrelated foods rather than near misses', () => {
        // ⛔ This filter does double duty. `Snacks, beef jerky` inverts to "beef jerky snacks", and its
        // head-sharing sibling is `Snacks, potato chips` — a gross miss dressed up as a near miss, which
        // would make the class-2 contrast easy and flatter every model on the number that decides.
        expect(isInvertibleUsdaName('Snacks, beef jerky, chopped and formed')).toBe(false);
        expect(isInvertibleUsdaName('Babyfood, meat, lamb, strained')).toBe(false);
        expect(isInvertibleUsdaName('Beverages, tea, black, brewed')).toBe(false);
    });
});

describe('cookNounPhrase', () => {
    it('puts the head noun LAST and reverses the descriptors ahead of it', () => {
        // USDA writes head-first, most-identifying descriptor next. A cook writes the mirror image.
        expect(cookNounPhrase('Bread, wheat, sprouted')).toBe('sprouted wheat bread');
        expect(cookNounPhrase('Radishes, red, raw')).toBe('raw red radishes');
        expect(cookNounPhrase('Oats, whole grain, steel cut')).toBe('steel cut whole grain oats');
    });

    it('carries EVERY descriptor, because a dropped one makes the ground-truth label false', () => {
        // ⛔ An earlier draft kept the two most identifying descriptors and truncated the rest, which read more
        // like a cook and lied about the row: `Peppers, sweet, green, sauteed` became "green sweet peppers",
        // so the line did not say SAUTEED while the candidate did — and a model contradicting it was RIGHT
        // while the corpus scored the contradiction as a false disagree. Faithfulness beats fluency.
        expect(cookNounPhrase('Peppers, sweet, green, sauteed')).toBe('sauteed green sweet peppers');
        expect(cookNounPhrase('Fish, salmon, chinook, smoked')).toBe('smoked chinook salmon fish');
        expect(cookNounPhrase('Beans, baked, canned, no salt added')).toBe('no salt added canned baked beans');
        expect(cookNounPhrase('Milk, canned, condensed, sweetened')).toBe('sweetened condensed canned milk');
    });

    it('moves a prepositional descriptor BEHIND the head, where English puts it', () => {
        expect(cookNounPhrase('Apples, gala, with skin, raw')).toBe('raw gala apples with skin');
        expect(cookNounPhrase('Taro, cooked, without salt')).toBe('cooked taro without salt');
    });

    it('keeps the LAST copy of a repeated word, so the head noun survives', () => {
        // "dried pine nuts nuts" is the failure this closes …
        expect(cookNounPhrase('Nuts, pine nuts, dried')).toBe('dried pine nuts');
        expect(cookNounPhrase('Salad dressing, italian dressing, reduced fat, without salt')).toBe(
            'reduced fat italian salad dressing without salt',
        );
    });

    it('NEVER deletes the head noun, even when a descriptor shares its last word', () => {
        // ⛔ THE REGRESSION. First-wins dedupe plus a "drop the head when a descriptor names it" rule matched
        // `Rice mix`'s last word against the descriptor `dry mix` and emitted "dry mix cheese flavor" — a line
        // that never says RICE, whose `correct` label is therefore false. The first live bake-off run found it.
        expect(cookNounPhrase('Rice mix, cheese flavor, dry mix, unprepared')).toContain('rice');
        expect(cookNounPhrase('Rice mix, cheese flavor, dry mix, unprepared')).toBe(
            'unprepared dry cheese flavor rice mix',
        );
    });

    it('de-duplicates repeated words rather than emitting them twice', () => {
        expect(cookNounPhrase('Wheat flour, whole-grain, soft wheat')).toBe('soft whole-grain wheat flour');
    });

    it('drops USDA bookkeeping segments a cook never says', () => {
        // "dry heat" is a laboratory cooking method, not a phrase in a recipe.
        expect(cookNounPhrase('Fish, tilapia, cooked, dry heat')).toBe('cooked tilapia fish');
        expect(cookNounPhrase('Peaches, canned, water pack, solids and liquids')).toBe('water pack canned peaches');
    });

    it('is a pure function of the name — the same input yields the same phrase every time', () => {
        const first = cookNounPhrase('Squash, summer, crookneck and straightneck, raw');
        const second = cookNounPhrase('Squash, summer, crookneck and straightneck, raw');

        expect(first).toBe(second);
        expect(first).toBe('raw crookneck and straightneck summer squash');
    });
});
