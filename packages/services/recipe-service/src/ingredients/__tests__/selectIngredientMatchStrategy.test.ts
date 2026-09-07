/**
 * Unit tests for the pure, database-free MATCH STRATEGY (plan U6, R6–R8, R10) — which candidates the local
 * `ingredients` statement retrieves, decided before any SQL is built.
 *
 * ## The two things it decides, and why they are one decision
 *
 * 1. **How wide to cast.** A single-token query keeps today's retrieval byte for byte. A multi-token query
 *    ALSO retrieves rows carrying its HEAD TERM, because today's `plainto_tsquery` is a conjunction of every
 *    lexeme — so `sifted flour` requires `sift` AND `flour`, and the row a cook wants (`Flour, wheat,
 *    all-purpose`) carries only one of them and is never retrieved at all. That is the shape of the import's
 *    268 lines that matched nothing.
 * 2. **Whether to prefer `raw`.** The catalog says `Celery, raw` and cooks write `celery`, so an unqualified
 *    query gains an affinity for rows carrying `raw` — suppressed for foods that are never raw (butter,
 *    milk, flour, …) and for a query that already names a preparation.
 *
 * ⛔ Widening retrieval WITHOUT the U5 ladder would be a regression, which is why U6 declares U5 as a
 * dependency: more candidates ranked by an unfixed sort key is more noise in the page. With the ladder, a
 * widened candidate lands on the rung it deserves and the `LIMIT` still cuts in the right place.
 *
 * ## Mutation lens
 *
 * Every case fails if the single-token path stops being distinguishable from the multi-token one, if the
 * head term is taken from the wrong end of the phrase, if the suppression list is emptied, if the
 * preparation-verb check is dropped, or if `raw` injection starts firing on a query that already says how
 * the food was cooked.
 */
import { describe, expect, it } from 'vitest';

import { selectIngredientMatchStrategy } from '../selectIngredientMatchStrategy.js';

describe('selectIngredientMatchStrategy — routing', () => {
    it('routes a query with nothing searchable to `none`, costing no round trip', () => {
        expect(selectIngredientMatchStrategy('   ').kind).toBe('none');
        expect(selectIngredientMatchStrategy('%%%').kind).toBe('none');
        expect(selectIngredientMatchStrategy('').kind).toBe('none');
    });

    it('routes a single token to `singleToken`', () => {
        expect(selectIngredientMatchStrategy('flour').kind).toBe('singleToken');
        expect(selectIngredientMatchStrategy('  Butter ').kind).toBe('singleToken');
    });

    it('routes two or more tokens to `multiToken`', () => {
        expect(selectIngredientMatchStrategy('brown sugar').kind).toBe('multiToken');
        expect(selectIngredientMatchStrategy('all-purpose flour').kind).toBe('multiToken');
    });

    it('counts TOKENS, not words — a hyphenated pair is two tokens', () => {
        // `all-purpose` is one word and two tokens. The ranking vocabulary splits on every non-alphanumeric
        // run, and the strategy must agree with it or the head term it names is not the head term the tier
        // compares.
        expect(selectIngredientMatchStrategy('all-purpose').kind).toBe('multiToken');
    });

    it('carries the ranking terms, so the DAL never re-derives them', () => {
        const strategy = selectIngredientMatchStrategy('Brown Sugars');

        expect(strategy.kind === 'multiToken' && strategy.terms.tokens).toEqual(['brown', 'sugar']);
        expect(strategy.kind === 'multiToken' && strategy.terms.head).toBe('sugar');
    });
});

describe('selectIngredientMatchStrategy — the head term the conjunction retrieves on', () => {
    it('names the LAST token of an ordinary English phrase', () => {
        const strategy = selectIngredientMatchStrategy('sifted flour');

        expect(strategy.kind === 'multiToken' && strategy.headTerm).toBe('flour');
    });

    it('names the FIRST token when the query mimics the catalog comma inversion', () => {
        const strategy = selectIngredientMatchStrategy('flour, all purpose');

        expect(strategy.kind === 'multiToken' && strategy.headTerm).toBe('flour');
    });

    it('is the SAME term the tier ladder heads on, so retrieval and ranking cannot disagree', () => {
        // A second derivation would let the statement retrieve rows the ladder then refuses to promote —
        // the widening would add candidates and fix nothing.
        const strategy = selectIngredientMatchStrategy('red wine vinegar');

        if (strategy.kind !== 'multiToken') {
            throw new Error(`expected multiToken, got ${strategy.kind}`);
        }

        expect(strategy.headTerm).toBe(strategy.terms.head);
        expect(strategy.headTerm).toBe('vinegar');
    });
});

describe('selectIngredientMatchStrategy — `raw` injection', () => {
    /** The raw affinity a query resolves to, whichever arm it routed through. */
    function rawAffinity(query: string): boolean {
        const strategy = selectIngredientMatchStrategy(query);

        return strategy.kind !== 'none' && strategy.rawAffinity;
    }

    it('injects `raw` for an unqualified produce term, which is how `chives` reaches `Chives, raw`', () => {
        expect(rawAffinity('chives')).toBe(true);
        expect(rawAffinity('celery')).toBe(true);
        expect(rawAffinity('fresh spinach')).toBe(true);
    });

    it('does NOT inject `raw` for a food that is never raw', () => {
        expect(rawAffinity('butter')).toBe(false);
        expect(rawAffinity('milk')).toBe(false);
        expect(rawAffinity('tomato sauce')).toBe(false);
        expect(rawAffinity('all purpose flour')).toBe(false);
    });

    it('does NOT inject `raw` when the cook already said how it was prepared', () => {
        expect(rawAffinity('roasted chicken')).toBe(false);
        expect(rawAffinity('freeze-dried chives')).toBe(false);
        expect(rawAffinity('canned tomatoes')).toBe(false);
    });

    it('does NOT inject `raw` when the query already says `raw`', () => {
        // Injecting it again would double-count a term the base metric already sees.
        expect(rawAffinity('raw spinach')).toBe(false);
    });

    it('suppresses on the SINGULARIZED head, so a plural does not slip past the list', () => {
        expect(rawAffinity('eggs')).toBe(true);
        expect(rawAffinity('sauces')).toBe(false);
    });

    it('never injects for a query with nothing searchable', () => {
        expect(rawAffinity('   ')).toBe(false);
    });
});
