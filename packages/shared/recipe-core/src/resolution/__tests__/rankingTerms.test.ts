/**
 * The ranking VOCABULARY — the fold, the tokenizer, the plural rule and the two head-term rules that both
 * surfaces' Scoring Policies are built from (plan U5/U6).
 *
 * ## Why these live in `recipe-core` rather than in each service
 *
 * The plan's rule is "shared rule, never shared SQL": food-service and recipe-service each render their OWN
 * statement, but they must agree on what a *token* is, what a *plural* is and what the *head term* is — or a
 * tier means two different things on two surfaces and the conformance contract has nothing to compare. Both
 * services already depend on `@kitchensink/recipe-core`, which is where `verificationGatePolicy.ts` went for
 * exactly this reason (U11), so the vocabulary is defined once and the SQL twice.
 *
 * ## Mutation lens
 *
 * Every case below fails if the fold stops case-folding, stops stripping combining marks, stops collapsing
 * whitespace; if the tokenizer stops splitting on hyphens or commas; if the plural rule loses either arm or
 * its length guards; or if the head rule stops reading the head noun from the right place.
 *
 * ## The head rule is ONE rule for both sides (ADR-0070, 2026-10-25)
 *
 * This suite used to assert that a name and a query took DIFFERENT heads (first word of a name, last word of a
 * query), because the catalog wrote USDA's inverted names (`Flour, wheat`). The curated seed renamed 2,640 of its
 * 2,642 roots into natural English (`milk crackers`, `1% milk`, `ground cinnamon`), and the first-word rule then
 * crowned modifiers: a prod paste import on 2026-10-25 bound `milk` to milk crackers, `salt` to salt cod,
 * `cinnamon` to cinnamon rolls and `bread` to bread flour. Those cases are pinned below. The asymmetry tests
 * were rewritten, not deleted: they now assert the single English head-noun rule on both sides.
 */
import { describe, expect, it } from 'vitest';

import {
    describeCatalogName,
    describeRankingQuery,
    describeRankingName,
    foldForRanking,
    rankingKeyOf,
    rankingTokens,
    singularizeRankingText,
    singularizeRankingToken,
} from '../rankingTerms.js';

describe('foldForRanking', () => {
    it('case-folds, so a catalog name and the query a cook types compare equal', () => {
        expect(foldForRanking('Flour')).toBe('flour');
    });

    it('strips combining marks, so `jalapeño` and `jalapeno` fold together', () => {
        // The representative-input corpus records this difference as one the KEY deliberately preserves and
        // ranking is expected to bridge. This is the bridge.
        expect(foldForRanking('jalapeño')).toBe(foldForRanking('jalapeno'));
        expect(foldForRanking('Crème Brûlée')).toBe('creme brulee');
    });

    it('collapses runs of whitespace and trims, so a pasted name is not a different food', () => {
        expect(foldForRanking('  all   purpose\tflour ')).toBe('all purpose flour');
    });

    it('KEEPS punctuation, because the catalog names foods with commas and percentages', () => {
        // `2% milk` and `2 milk` are different products; the fold must not erase that.
        expect(foldForRanking('Flour, wheat')).toBe('flour, wheat');
        expect(foldForRanking('2% milk')).toBe('2% milk');
    });

    it('uses an explicit ASCII whitespace class so the SQL mirror cannot disagree on NBSP', () => {
        // U+00A0 is whitespace to JS `\s` and is NOT in this class — on BOTH sides. Identical treatment is
        // the invariant; erasing it is not.
        expect(foldForRanking('a b')).toBe('a b');
    });
});

describe('singularizeRankingToken', () => {
    it('folds a simple plural, which is how `eggs` reaches `Egg, whole, raw`', () => {
        expect(singularizeRankingToken('eggs')).toBe('egg');
        expect(singularizeRankingToken('sugars')).toBe('sugar');
        expect(singularizeRankingToken('chives')).toBe('chive');
    });

    it('folds an `-es` plural after a sibilant, which is how `peaches` reaches `Peach`', () => {
        expect(singularizeRankingToken('peaches')).toBe('peach');
        expect(singularizeRankingToken('boxes')).toBe('box');
        expect(singularizeRankingToken('dishes')).toBe('dish');
    });

    it('leaves a word whose `s` is not a plural alone', () => {
        expect(singularizeRankingToken('glass')).toBe('glass');
        expect(singularizeRankingToken('gas')).toBe('gas');
        expect(singularizeRankingToken('raw')).toBe('raw');
    });

    it('is idempotent, so applying it to an already-singular catalog token is safe', () => {
        for (const token of ['egg', 'sugar', 'flour', 'glass', 'peach']) {
            expect(singularizeRankingToken(singularizeRankingToken(token))).toBe(singularizeRankingToken(token));
        }
    });

    it('⛔ never reaches ACROSS a word boundary, which a naive `[^s]` would', () => {
        // The rule is applied to whole TEXT (it has to be — its SQL mirror is a generated column, and those
        // may not contain a subquery). A `[^s]` before the final `s` would also match a SPACE, so `ab s`
        // would fold to `ab` — one word eating the next. The negative lookahead is what forbids it.
        expect(singularizeRankingText('ab s')).toBe('ab s');
        expect(singularizeRankingText('eggs and butter')).toBe('egg and butter');
        expect(singularizeRankingText('boxes of peaches')).toBe('box of peach');
    });

    it('is the SAME rule whether applied to one token or to a whole phrase', () => {
        for (const phrase of ['eggs', 'sugars brown', 'peaches and glass', 'raw chives']) {
            const perWord = phrase.split(' ').map(singularizeRankingToken).join(' ');

            expect(singularizeRankingText(phrase)).toBe(perWord);
        }
    });

    it('over-folds consistently rather than correctly, and that is the contract', () => {
        // `molasses` is not a plural, but BOTH sides fold it the same way, so a comparison still holds. The
        // rule buys agreement between two implementations, not English morphology.
        expect(singularizeRankingToken('molasses')).toBe(singularizeRankingToken('molasses'));
        expect(singularizeRankingToken('molasses')).toBe('molass');
    });
});

describe('rankingTokens', () => {
    it('splits on every non-alphanumeric run, so a hyphenated name yields its words', () => {
        expect(rankingTokens('Flour, wheat, all-purpose')).toEqual(['flour', 'wheat', 'all', 'purpose']);
    });

    it('singularizes each token', () => {
        expect(rankingTokens('Sugars, brown')).toEqual(['sugar', 'brown']);
    });

    it('preserves order, because the head term is read from a position in the phrase', () => {
        expect(rankingTokens('Carob flour')).toEqual(['carob', 'flour']);
    });

    it('yields no empty token, whatever the punctuation', () => {
        expect(rankingTokens('  ,,, --- ')).toEqual([]);
        expect(rankingTokens('')).toEqual([]);
    });

    it('folds diacritics before tokenizing', () => {
        expect(rankingTokens('Jalapeño peppers')).toEqual(['jalapeno', 'pepper']);
    });
});

describe('describeRankingName — the head is the English head noun of the first comma segment', () => {
    describe('a natural-order name takes its LAST word (the prod defect of 2026-10-25)', () => {
        it('never crowns a modifier: milk crackers are crackers, salt cod is cod', () => {
            expect(describeRankingName('milk crackers').head).toBe('cracker');
            expect(describeRankingName('salt cod').head).toBe('cod');
            expect(describeRankingName('cinnamon rolls').head).toBe('roll');
            expect(describeRankingName('bread flour').head).toBe('flour');
        });

        it('crowns the real food the cook asked for', () => {
            expect(describeRankingName('1% milk').head).toBe('milk');
            expect(describeRankingName('whole milk').head).toBe('milk');
            expect(describeRankingName('kosher salt').head).toBe('salt');
            expect(describeRankingName('ground cinnamon').head).toBe('cinnamon');
            expect(describeRankingName('French bread').head).toBe('bread');
        });

        it('treats Carob flour as a flour, which it is', () => {
            // Rewritten: this suite once pinned `carob` here, because the first-word rule stood in for a
            // default meaning. A default is now a seed default (ADR-0070), so the head rule can tell the truth.
            expect(describeRankingName('Carob flour').head).toBe('flour');
            expect(describeRankingName('Milk and cereal bar').head).toBe('bar');
        });
    });

    describe('an inverted USDA name keeps its head', () => {
        it('takes the single word before the first comma', () => {
            expect(describeRankingName('Flour, wheat, all-purpose').head).toBe('flour');
            expect(describeRankingName('Vinegar, red wine').head).toBe('vinegar');
            expect(describeRankingName('Sugars, brown').head).toBe('sugar');
            expect(describeRankingName('Crackers, milk').head).toBe('cracker');
            expect(describeRankingName('Pepper, banana, raw').head).toBe('pepper');
        });

        it('takes the last word of a multi-word first segment (plan U1, D4b)', () => {
            expect(describeRankingName('Cinnamon buns, frosted').head).toBe('bun');
            expect(describeRankingName('Salad dressing, russian').head).toBe('dressing');
            expect(describeRankingName('Sausage, Italian, sweet, links').head).toBe('sausage');
        });
    });

    describe('words that are not the head noun are removed first', () => {
        it('drops a bracketed group, so a qualifier in brackets is never the head', () => {
            expect(describeRankingName('Tamales (Navajo)').head).toBe('tamale');
            expect(describeRankingName('Cheese (cheddar, sharp), shredded').head).toBe('cheese');
        });

        it('cuts a trailing "in ..." phrase, which names the packing, not the food', () => {
            expect(describeRankingName('walnuts in syrup').head).toBe('walnut');
            expect(describeRankingName('sun-dried tomatoes in oil').head).toBe(singularizeRankingToken('tomatoes'));
            expect(describeRankingName('Beans, in tomato sauce').head).toBe('bean');
        });

        it('keeps an "of" phrase on the last word, because its head is final', () => {
            expect(describeRankingName('cream of mushroom soup').head).toBe('soup');
        });

        it('cuts only a standalone "in", never the letters inside a word', () => {
            expect(describeRankingName('instant oatmeal').head).toBe('oatmeal');
            expect(describeRankingName('raisin bread').head).toBe('bread');
        });
    });

    it('falls back to the last token of the whole name when the first segment holds nothing', () => {
        expect(describeRankingName(', frosted').head).toBe('frosted');
        expect(describeRankingName('(boiled), potatoes').head).toBe(singularizeRankingToken('potatoes'));
    });

    it('has no head when the name holds no alphanumeric character', () => {
        expect(describeRankingName('   ').head).toBeUndefined();
        expect(describeRankingName('( )').head).toBeUndefined();
    });
});

describe('describeRankingQuery — a typed phrase takes the SAME head rule as a name', () => {
    it('takes the head noun of an ordinary English noun phrase', () => {
        expect(describeRankingQuery('red wine vinegar').head).toBe('vinegar');
        expect(describeRankingQuery('brown sugar').head).toBe('sugar');
        expect(describeRankingQuery('flour').head).toBe('flour');
        expect(describeRankingQuery('walnuts in syrup').head).toBe('walnut');
    });

    it("still reads a cook's comma inversion, because a single-word first segment is the head", () => {
        expect(describeRankingQuery('flour, all purpose').head).toBe('flour');
        expect(describeRankingQuery('Vinegar, red wine').head).toBe('vinegar');
        expect(describeRankingQuery('all purpose flour, bleached').head).toBe('flour');
    });

    // Rewritten (code-quality review M6): the name and the query are now ONE constructor, so "the query agrees with the
    // name rule" became a tautology. What can still drift is the comparison KEY: the rung reads `terms.key`, and the
    // SQL mirrors read `rankingKeyOf`, so the two must be one spelling. The inputs are the e2e suite's synonym sets.
    it('⛔ carries the comparison key rankingKeyOf computes, for every phrase', () => {
        for (const phrase of [
            'granulated sugar',
            'white sugar',
            'Chicken Eggs',
            'large eggs',
            'bacalao',
            'baccalà',
            'salted cod',
            'half-and-half',
            'half & half',
            '   ',
            '---',
            'Peaches',
        ]) {
            expect(describeRankingQuery(phrase).key).toBe(rankingKeyOf(phrase));
            expect(describeRankingName(phrase).key).toBe(rankingKeyOf(phrase));
        }
    });

    it('has no head for a query with nothing searchable in it', () => {
        expect(describeRankingQuery('   ').head).toBeUndefined();
        expect(describeRankingQuery('   ').tokens).toEqual([]);
    });

    it('carries the folded form and the singularized tokens the tiers compare on', () => {
        expect(describeRankingQuery(' Brown  Sugars ')).toEqual({
            folded: 'brown sugars',
            tokens: ['brown', 'sugar'],
            head: 'sugar',
            key: 'brown sugar',
        });
    });
});

describe("describeCatalogName — a root's default terms (ADR-0070 §4)", () => {
    it('keys each default term as rankingKeyOf does, in order, empty keys dropped', () => {
        expect(
            describeCatalogName('whole milk', ['vitamin D milk'], ['Milk', '  ', 'Whole  Milks']).defaultKeys,
        ).toEqual(['milk', 'whole milk']);
    });

    it('keeps default keys apart from synonym keys: a default is not a synonym', () => {
        const terms = describeCatalogName('whole milk', ['vitamin D milk'], ['milk']);

        expect(terms.synonymKeys).toEqual(['vitamin d milk']);
        expect(terms.defaultKeys).toEqual(['milk']);
    });

    it('holds no default keys for a root with no default terms', () => {
        expect(describeCatalogName('1% milk', [], []).defaultKeys).toEqual([]);
    });
});
