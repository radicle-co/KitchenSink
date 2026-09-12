/**
 * THE CONTENT KEY a cached ingredient PARSE is stored under (plan U20 / KTD-13, KTD-14).
 *
 * ⛔ WHY THE KEY CARRIES THE ENGINE, when its nearest precedent deliberately does not.
 * `recipe_ingredient_verifications` stores `model_id` as an ATTRIBUTE and versions the derivation, so
 * swapping models does not invalidate cached verdicts. That is right for a JUDGEMENT and wrong here: this is
 * a COMPARISON pipeline, and a comparison needs BOTH engines' outputs for one line to coexist as two rows. So
 * the engine and its version are members of the key, and a CRF version bump re-partitions only the CRF half
 * while every LLM row survives to be re-compared against it.
 *
 * ⚠️ The line is reduced to a DIGEST before it is ever part of a key, and that is the property KTD-14 leans
 * on: the cache row carries no person-to-row link, so a row shared installation-wide holds nothing an erasure
 * sweep could key on.
 */
import { describe, expect, it } from 'vitest';

import {
    PARSE_ENGINES,
    PARSE_KEY_VERSION,
    lineDigest,
    lineDigestPreimage,
    parseKey,
    parseKeyPreimage,
    type ParseEngine,
    type ParsedLineIdentity,
} from '../parseKey.js';

/** A deterministic stand-in for a digest — the identity, so a test can READ what was hashed. */
const echo = (input: string): string => input;

/** The line every case starts from. */
const LINE = '2 cups all-purpose flour';

/** The engine version every case starts from. */
const CRF_VERSION = 'crf-ingredient-phrase-tagger@0.1.0';

/**
 * Build an identity, overriding the raw LINE (which is digested) or either engine member.
 *
 * @param overrides - What to vary from the baseline.
 * @returns The identity. Pure.
 */
function identity(overrides: { line?: string; engine?: ParseEngine; engineVersion?: string } = {}): ParsedLineIdentity {
    const { line = LINE, engine = 'crf', engineVersion = CRF_VERSION } = overrides;

    return { lineDigest: lineDigest(line, echo), engine, engineVersion };
}

describe('the parse-engine vocabulary', () => {
    it('is the two engines the comparator adjudicates between, and nothing else', () => {
        // ⛔ ONE authoritative representation. The column's CHECK constraint mirrors this list and the Drizzle
        // schema ties itself to it with `satisfies` — so a third engine is a compile error and a migration,
        // never a value that quietly appears in a cache row nobody can interpret.
        expect(PARSE_ENGINES).toStrictEqual(['crf', 'llm']);
    });
});

describe('lineDigest', () => {
    it('is stable for the same line', () => {
        expect(lineDigest(LINE, echo)).toBe(lineDigest(LINE, echo));
    });

    it('carries the version prefix, so a normalization change is an ENUMERABLE re-partition', () => {
        // ⛔ Without the prefix, changing what the preimage serializes silently re-partitions the table: old
        // rows become unreachable AND new rows collide with nothing, so the system appears to work while every
        // cached parse quietly stops applying. The prefix makes the old generation inert and LISTABLE.
        expect(lineDigest(LINE, echo).startsWith(`${PARSE_KEY_VERSION}:`)).toBe(true);
    });

    it('puts the version INSIDE the preimage too, not only in front of the digest', () => {
        // A prefix alone would leave two generations sharing a digest BODY — enumerable, but not distinct.
        expect(lineDigestPreimage(LINE)).toBe(JSON.stringify([PARSE_KEY_VERSION, LINE]));
    });

    it('normalizes to NFC, so one line has one key', () => {
        // The same text typed with a precomposed `è` and with `e` + a combining grave is the SAME line to
        // a cook and to a parser. Two keys for it would double the engine spend and halve the hit rate,
        // invisibly.
        //
        // ⚠️ The decomposed form is written with ESCAPES on purpose: the two forms are byte-different and
        // pixel-identical, so a literal would be unreviewable — and a first draft of the sibling test in
        // `verificationKey.test.ts` silently compared two different WORDS and "failed" against correct code.
        const precomposed = '2 cups crème fraîche';
        const decomposed = '2 cups cre\u0300me frai\u0302che';

        expect(precomposed).not.toBe(decomposed);
        expect(lineDigest(precomposed, echo)).toBe(lineDigest(decomposed, echo));
    });

    it('collapses whitespace runs and trims, because indentation is not part of the line', () => {
        expect(lineDigest('  2   cups all-purpose   flour ', echo)).toBe(lineDigest(LINE, echo));
    });

    it('does NOT fold case', () => {
        // ⛔ The deliberate OPPOSITE of `normalizedIngredientKey`, which destroys case because it is an
        // equivalence-class key for MATCHING two cooks' phrases. This one identifies a specific line handed to
        // a specific parser, and both engines read a capitalised proper noun differently from a lowercase one.
        expect(lineDigest('Flour', echo)).not.toBe(lineDigest('flour', echo));
    });

    it('is the digest and nothing else once hashed — the line never survives into the key', () => {
        expect(lineDigest(LINE, () => 'deadbeef')).toBe(`${PARSE_KEY_VERSION}:deadbeef`);
    });
});

describe('parseKey', () => {
    it('is stable for the same identity', () => {
        expect(parseKey(identity(), echo)).toBe(parseKey(identity(), echo));
    });

    it('carries the version prefix', () => {
        expect(parseKey(identity(), echo).startsWith(`${PARSE_KEY_VERSION}:`)).toBe(true);
    });

    it.each<[string, { line?: string; engine?: ParseEngine; engineVersion?: string }]>([
        ['the line', { line: '2 cups bread flour' }],
        ['the engine', { engine: 'llm' }],
        ['the engine version', { engineVersion: 'crf-ingredient-phrase-tagger@0.2.0' }],
    ])('changes when %s changes', (_label, overrides) => {
        // Every one of these is a thing the cached parse is ABOUT. A key ignoring any of them would serve a
        // parse nobody produced — the worst possible cache hit, because it looks like a saving.
        expect(parseKey(identity(overrides), echo)).not.toBe(parseKey(identity(), echo));
    });

    it('gives the SAME line under two engines two different keys', () => {
        // ⛔ KTD-13's whole point: a comparison pipeline needs both engines' answers to coexist. Keyed the way
        // the verification table is keyed — engine as an ATTRIBUTE — the second engine's answer would
        // overwrite the first, and the comparator would have nothing to compare.
        expect(parseKey(identity({ engine: 'crf' }), echo)).not.toBe(parseKey(identity({ engine: 'llm' }), echo));
    });

    it('cannot be confused by a field boundary', () => {
        // ⛔ THE CLASSIC CONCATENATION BUG, in this module's own fields. With a naive `a + b` join,
        // `engine: 'crf'` + `engineVersion: 'X'` and `engine: 'crfX'` + `engineVersion: ''` produce the same
        // string, so two different parses would share one row. JSON encoding of a fixed-order tuple makes that
        // unrepresentable, and it distinguishes `''` from an absent member for free.
        //
        // (The plan states this trap with the VERIFICATION key's fields, `unit`/`foodId`. Those are not members
        // of a parse identity; the analogous pair here is the engine and its version.)
        expect(parseKey({ ...identity(), engineVersion: 'X' }, echo)).not.toBe(
            parseKey({ ...identity(), engine: 'crfX' as ParseEngine, engineVersion: '' }, echo),
        );
    });

    it('serializes exactly the identity, in a fixed order, with the version first', () => {
        // Asserted structurally rather than by "a hash happened", so a dropped member is a visible diff.
        expect(parseKeyPreimage(identity())).toBe(
            JSON.stringify([PARSE_KEY_VERSION, lineDigest(LINE, echo), 'crf', CRF_VERSION]),
        );
    });

    it('is derived from the LINE DIGEST, never from the raw line', () => {
        // ⛔ The property that keeps the PRIMARY KEY and the `(line_digest, engine, engine_version)` UNIQUE
        // index describing the same thing: `parse_key` is a function of exactly the triple that index
        // constrains. Hashing the raw line here instead would let the two drift, invisibly — and it would put
        // the cook's text in the preimage, which is the KTD-14 property the digest exists to hold.
        //
        // ⚠️ Asserted with an OPAQUE digest double rather than `echo`: `echo` leaves the line inside the digest
        // by construction, so it could not tell "the preimage carries the digest" from "the preimage carries
        // the line". A real digest is opaque, and that is the case worth asserting.
        const opaque = (): string => 'deadbeef';
        const subject = { ...identity(), lineDigest: lineDigest(LINE, opaque) };

        expect(parseKeyPreimage(subject)).toContain(`${PARSE_KEY_VERSION}:deadbeef`);
        expect(parseKeyPreimage(subject)).not.toContain('all-purpose');
    });

    it('passes the digest exactly one argument — the preimage', () => {
        const seen: string[] = [];
        parseKey(identity(), (input) => {
            seen.push(input);

            return 'digest';
        });

        expect(seen).toEqual([parseKeyPreimage(identity())]);
    });

    it('produces a key carrying no raw user text', () => {
        expect(parseKey(identity(), () => 'deadbeef')).toBe(`${PARSE_KEY_VERSION}:deadbeef`);
    });
});

describe('the version bump rule', () => {
    /**
     * ⛔ The failure this guards is SILENT, which is why it is asserted rather than commented.
     *
     * A change to what a preimage serializes, in what order, or how it normalizes, WITHOUT a bump leaves every
     * stored row unreachable while every new row collides with nothing. Nothing errors. The cache simply stops
     * hitting, both engines are re-invoked for every line, and the only symptom is a bill.
     */
    it('is a `v`-prefixed generation, so a prefix query can enumerate a superseded one', () => {
        expect(PARSE_KEY_VERSION).toMatch(/^v[0-9]+$/u);
    });

    it('starts at v1 — no generation has been superseded yet', () => {
        expect(PARSE_KEY_VERSION).toBe('v1');
    });
});
