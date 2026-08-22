/**
 * The ranking VOCABULARY — the fold, the tokenizer, the plural rule and the two head-term rules that both
 * search surfaces' Scoring Policies are built from (plan U5/U6, R1–R8).
 *
 * DESIGN PATTERN: **Value-object constructors.** `describeRankingName` and `describeRankingQuery` parse a
 * raw string ONCE into the terms the tiers actually compare on ({@link RankingTerms}), so no tier ever
 * re-derives them and no two tiers can derive them differently. Parse, don't validate.
 *
 * ## Why this lives in `recipe-core` and not in either service
 *
 * The plan's rule for U5 is "shared rule, never shared SQL". food-service ranks its catalog and
 * recipe-service ranks its local `ingredients` table with two DIFFERENT statements over two different base
 * metrics (`similarity` vs `word_similarity` — KTD-1), but a *tier* has to mean the same thing on both or
 * `service-test-harness`'s conformance contract has nothing to compare. So the vocabulary is defined once,
 * here, and rendered into SQL twice. Both services already depend on `@kitchensink/recipe-core`, which is
 * where U11 put `verificationGatePolicy.ts` for exactly this reason.
 *
 * ## ⚠️ Every rule here has a SQL mirror, and the mirrors are load-bearing
 *
 * Each function below is re-expressed as a SQL fragment inside each surface's policy module, because the
 * tier is the sort key and Postgres truncates to the page BEFORE any row reaches this process. Nothing in
 * the type system links the two. What links them is
 * `packages/tools/service-test-harness/src/rankingConformance.ts`, which runs a corpus through the real
 * statement and asserts the observed order equals the order these functions predict. **If you change a rule
 * here, change the SQL and let the conformance contract prove you did.**
 *
 * The rules are deliberately chosen to be expressible identically in both languages: an explicit ASCII
 * whitespace class rather than `\s`/`[[:space:]]` (whose Unicode membership differs), Unicode NFD plus a
 * combining-mark strip rather than the `unaccent` extension (whose rules file is not NFD), and an explicit
 * two-arm plural rule rather than a Snowball stemmer (which cannot be reproduced in TypeScript without
 * pinning a second implementation of it).
 *
 * ## What this is NOT
 *
 * It is not a normalization KEY. `normalizedKey.ts` owns the exact-match grain and deliberately folds none
 * of hyphenation, plurals or diacritics, because collapsing those into an identity would merge foods that
 * are genuinely distinct (`2% milk` is not `2 milk`). This module folds them for COMPARISON only, inside a
 * ranking that still has the base metric underneath it — which is precisely the handoff
 * `resolution/__tests__/representativeUserInput.test.ts` records against "ranking (U5/U6)".
 */

/**
 * Whitespace, stated as an explicit ASCII class.
 *
 * ⛔ NOT `\s`. JavaScript's `\s` matches NBSP, the Unicode space separators and U+FEFF; Postgres'
 * `[[:space:]]` under a UTF-8 ctype does not agree with it. An explicit class is identical in both engines,
 * so an exotic space is treated the SAME way on both sides — which is the invariant that matters — instead
 * of being erased by one and kept by the other.
 */
const ASCII_WHITESPACE = /[ \t\n\r\f\v]+/g;

/** Unicode combining marks, i.e. what NFD decomposition splits an accented letter into. */
const COMBINING_MARKS = /[̀-ͯ]/g;

/** Every run that is not a letter or a digit — the token separator. */
const TOKEN_SEPARATOR = /[^\p{L}\p{N}]+/u;

/** Minimum token length before the `-es` arm of the plural rule may fire (`boxes` → `box`). */
const ES_PLURAL_MIN_LENGTH = 5;

/** Minimum token length before the `-s` arm of the plural rule may fire (`eggs` → `egg`). */
const S_PLURAL_MIN_LENGTH = 4;

/** A sibilant stem that takes `-es` in the plural. */
const ES_PLURAL = /(?:s|x|z|ch|sh)es$/;

/** A plain `-s` plural: the character before the final `s` is not itself an `s` (so `glass` is not folded). */
const S_PLURAL = /[^s]s$/;

/**
 * Fold a name or query to the form the tiers compare on: case-folded, diacritic-stripped, whitespace
 * collapsed. Punctuation is KEPT.
 *
 * ⛔ Punctuation survives on purpose. The catalog names foods with commas (`Flour, wheat`) and cooks type
 * percentages that are part of the food's identity (`2% milk`). Erasing either would make the exact tier
 * claim an identity the catalog does not hold.
 *
 * @param text - Any name or query.
 * @returns The folded form. Pure.
 */
export function foldForRanking(text: string): string {
    return text.toLowerCase().normalize('NFD').replace(COMBINING_MARKS, '').replace(ASCII_WHITESPACE, ' ').trim();
}

/**
 * Fold a single folded token to its singular form.
 *
 * ⚠️ This buys AGREEMENT between two implementations, not English morphology. `molasses` folds to `molass`,
 * which is wrong as English and harmless as a comparison: the same rule runs on both sides of every
 * comparison, so a query and a name containing that word still meet. What would NOT be harmless is a rule
 * Postgres and JavaScript disagree about, which is why this is two explicit arms rather than the `english`
 * Snowball stemmer the tsvector uses.
 *
 * @param token - A folded token (no case, no marks, no separators).
 * @returns The singular form, or the token unchanged. Pure.
 */
export function singularizeRankingToken(token: string): string {
    if (token.length >= ES_PLURAL_MIN_LENGTH && ES_PLURAL.test(token)) {
        return token.slice(0, -2);
    }

    if (token.length >= S_PLURAL_MIN_LENGTH && S_PLURAL.test(token)) {
        return token.slice(0, -1);
    }

    return token;
}

/**
 * Split a name or query into its folded, singularized tokens, in order.
 *
 * @param text - Any name or query.
 * @returns The tokens, never containing an empty string. Pure.
 */
export function rankingTokens(text: string): readonly string[] {
    return foldForRanking(text)
        .split(TOKEN_SEPARATOR)
        .filter((token) => token.length > 0)
        .map(singularizeRankingToken);
}

/** A name or query, parsed once into everything the tiers compare on. */
export interface RankingTerms {
    /** The folded form — what the exact tier compares. */
    readonly folded: string;
    /** The folded, singularized tokens in source order — what the token-set and covered tiers compare. */
    readonly tokens: readonly string[];
    /** The head term, or `undefined` when the text holds nothing alphanumeric. */
    readonly head: string | undefined;
}

/**
 * Parse a CATALOG NAME into its ranking terms. The head is the **first** token.
 *
 * That rule is USDA's naming convention read literally: the catalog inverts a food's name so the head noun
 * leads (`Flour, wheat, all-purpose`; `Sugars, brown`; `Vinegar, red wine`; `Chives, raw`). A name whose
 * head is `carob` is a carob product however prominently `flour` appears later in it — which is exactly what
 * disqualifies `Carob flour`, `Crackers, milk` and the sugar-coated candy from the head tier.
 *
 * @param name - The catalog (or local ingredient) display name.
 * @returns Its ranking terms. Pure.
 */
export function describeRankingName(name: string): RankingTerms {
    const tokens = rankingTokens(name);

    return { folded: foldForRanking(name), tokens, head: tokens[0] };
}

/**
 * Parse a TYPED QUERY into its ranking terms. The head is the **last** token — unless the query carries a
 * comma, in which case it is the first.
 *
 * ⛔ **This is deliberately NOT the name rule, and the asymmetry is what fixes `flour`.** A cook types an
 * English noun phrase, whose head is final (`red wine vinegar` is a vinegar); the catalog writes the
 * inverted form, whose head is initial. Applying the query rule to a name would give `Carob flour` the head
 * `flour`, tie it with the real flour row at the head tier, and hand the win straight back to the attractor
 * through the base metric's length penalty (measured 2026-08-22: `similarity('Carob flour','flour') = 0.50`
 * against `0.15` for `Flour, wheat, all-purpose, enriched, bleached`).
 *
 * A cook who has seen the inverted form in the picker and types it back — `flour, all purpose` — means
 * `flour`. The comma is the signal, and it is the only signal, because it is the only thing in a typed
 * phrase that distinguishes the two conventions.
 *
 * @param query - The trimmed user query.
 * @returns Its ranking terms. Pure.
 */
export function describeRankingQuery(query: string): RankingTerms {
    const tokens = rankingTokens(query);
    const head = query.includes(',') ? tokens[0] : tokens[tokens.length - 1];

    return { folded: foldForRanking(query), tokens, head };
}
