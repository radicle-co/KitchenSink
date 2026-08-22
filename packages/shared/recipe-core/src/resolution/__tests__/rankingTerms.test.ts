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
 * its length guards; or if either head rule is applied to the wrong side. The asymmetry between the two head
 * rules is asserted directly, because it is the single most surprising thing in this module and a
 * well-meaning "unify them" is the likeliest future regression.
 */
import { describe, expect, it } from 'vitest';

import {
    describeRankingQuery,
    describeRankingName,
    foldForRanking,
    rankingTokens,
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

    it('preserves order, because the head term is the FIRST token of a catalog name', () => {
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

describe('describeRankingName — a catalog name is HEAD-FIRST', () => {
    it("takes the first token as the head, which is USDA's inverted convention", () => {
        expect(describeRankingName('Flour, wheat, all-purpose').head).toBe('flour');
        expect(describeRankingName('Vinegar, red wine').head).toBe('vinegar');
        expect(describeRankingName('Sugars, brown').head).toBe('sugar');
    });

    it('gives an ATTRACTOR its own head, which is the whole point', () => {
        // `Carob flour` is a carob product. Its head is `carob`, so the query `flour` cannot promote it to
        // the head tier — the defect the 334 attractor lines came from.
        expect(describeRankingName('Carob flour').head).toBe('carob');
        expect(describeRankingName('Crackers, milk').head).toBe('cracker');
    });

    it('has no head when the name holds no alphanumeric character', () => {
        expect(describeRankingName('   ').head).toBeUndefined();
    });
});

describe('describeRankingQuery — a typed phrase is HEAD-LAST unless it is comma-inverted', () => {
    it('takes the LAST token of an ordinary English noun phrase', () => {
        expect(describeRankingQuery('red wine vinegar').head).toBe('vinegar');
        expect(describeRankingQuery('brown sugar').head).toBe('sugar');
        expect(describeRankingQuery('flour').head).toBe('flour');
    });

    it("takes the FIRST token when the cook mimics the catalog's comma inversion", () => {
        // A cook who has seen `Flour, all purpose` in the picker and types it back means `flour`, not
        // `purpose`. The comma is the signal, and it is the only signal.
        expect(describeRankingQuery('flour, all purpose').head).toBe('flour');
        expect(describeRankingQuery('Vinegar, red wine').head).toBe('vinegar');
    });

    it('⛔ is DELIBERATELY asymmetric with the name rule, and the asymmetry is what fixes `flour`', () => {
        // Same text, two sides, two heads. If the query rule were applied to the name, `Carob flour` would
        // report head `flour`, tie with the real flour row at the head tier, and the length penalty would
        // hand the win straight back to the attractor.
        expect(describeRankingName('Carob flour').head).toBe('carob');
        expect(describeRankingQuery('Carob flour').head).toBe('flour');
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
        });
    });
});
