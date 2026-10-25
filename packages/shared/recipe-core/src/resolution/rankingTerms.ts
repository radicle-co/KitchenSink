/**
 * The ranking VOCABULARY — the fold, the tokenizer, the plural rule and the one head-term rule that both
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

/**
 * The `-es` plural after a sibilant stem (`boxes` → `box`, `dishes` → `dish`, `peaches` → `peach`), applied
 * to WHOLE TEXT rather than to one token.
 *
 * ⛔ **Whole-text, and that is a hard requirement, not a style.** The SQL mirror of this rule is a STORED
 * generated column, and a generated-column expression may not contain a subquery — so a per-token rule (which
 * needs `regexp_split_to_table` + `ARRAY(...)`) is not expressible there at all. Measured on 50,000
 * production-shaped foods, 2026-08-22, the per-token form also cost **253–357 ms** on the `broad`/`brand`
 * shapes against SC-007's 200 ms budget; materialized, the same ladder costs **+0.8–5.2 ms**.
 *
 * The two length guards a per-token rule needed are now structural: this pattern is 2 alnum + 1–2 sibilant +
 * `es`, i.e. 5–6 characters, and {@link S_PLURAL} is 4.
 */
const ES_PLURAL = /([\p{L}\p{N}]{2}(?:s|x|z|ch|sh))es(?![\p{L}\p{N}])/gu;

/**
 * The plain `-s` plural (`eggs` → `egg`, `sugars` → `sugar`), applied to whole text.
 *
 * ⚠️ `(?!s)[\p{L}\p{N}]` rather than `[^s]`: the character before the final `s` must be an alphanumeric that
 * is not itself an `s`. `[^s]` would also match a SPACE, so `ab s` would fold to `ab` — a rule that reaches
 * across a word boundary, which the per-token form could never do. Postgres has no way to subtract a
 * character from a bracket expression either, so both engines express it as a negative lookahead and stay
 * identical.
 */
const S_PLURAL = /([\p{L}\p{N}]{2}(?!s)[\p{L}\p{N}])s(?![\p{L}\p{N}])/gu;

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
 * Singularize every word of an already-FOLDED string, in one pass per arm.
 *
 * ⚠️ This buys AGREEMENT between two implementations, not English morphology. `molasses` folds to `molass`,
 * which is wrong as English and harmless as a comparison: the same rule runs on both sides of every
 * comparison, so a query and a name containing that word still meet. What would NOT be harmless is a rule
 * Postgres and JavaScript disagree about — which is why this is two explicit arms rather than the `english`
 * Snowball stemmer the tsvector uses, and why both arms avoid every construct the two regex engines treat
 * differently. The alternation in {@link ES_PLURAL} cannot diverge under POSIX leftmost-longest vs
 * JavaScript leftmost-first, because the required `es` suffix makes its branches mutually exclusive at any
 * given start position.
 *
 * @param folded - Text already through {@link foldForRanking}.
 * @returns The same text with each word's plural suffix removed. Pure.
 */
export function singularizeRankingText(folded: string): string {
    return folded.replace(ES_PLURAL, '$1').replace(S_PLURAL, '$1');
}

/**
 * Singularize ONE folded token — {@link singularizeRankingText} applied to a token, which is the same rule
 * because a lone token is a lone word.
 *
 * @param token - A folded token (no case, no marks, no separators).
 * @returns The singular form, or the token unchanged. Pure.
 */
export function singularizeRankingToken(token: string): string {
    return singularizeRankingText(token);
}

/**
 * Split a name or query into its folded, singularized tokens, in order.
 *
 * ⚠️ Order is fold → singularize → split, and the SQL mirror uses the same order for the same reason: the
 * plural arms are anchored on a word boundary (`(?![\p{L}\p{N}]`), which only exists while the words are
 * still in one string.
 *
 * @param text - Any name or query.
 * @returns The tokens, never containing an empty string. Pure.
 */
export function rankingTokens(text: string): readonly string[] {
    return singularizeRankingText(foldForRanking(text))
        .split(TOKEN_SEPARATOR)
        .filter((token) => token.length > 0);
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
 * A bracketed group, removed before the head is read: `Tamales (Navajo)` is a tamale, and a qualifier in brackets
 * is never the food. Non-nested on purpose, so the SQL mirror (`rank_head_of`, migration 0025) can say the same
 * thing in one `regexp_replace`.
 */
const BRACKETED_GROUP = /\([^)]*\)/g;

/**
 * A trailing phrase opened by the standalone word `in`, removed before the head is read: `walnuts in syrup` is a
 * walnut and `Fish, tuna, light, canned in water` is still a fish. The word must stand alone between ASCII
 * whitespace, so `instant` and `raisin` keep their letters. ⚠️ An `of` phrase is NOT cut: its head is final
 * (`cream of mushroom soup` is a soup), which is what the last-word rule already reads.
 */
const IN_PHRASE = /[ \t\n\r\f\v]in[ \t\n\r\f\v][\s\S]*$/i;

/** The last element of a token list, or `undefined` for an empty one. Pure. */
function lastToken(tokens: readonly string[]): string | undefined {
    return tokens[tokens.length - 1];
}

/**
 * The HEAD TERM of a name or a typed phrase: the English head noun of its first comma segment.
 *
 * Remove bracketed groups, cut a trailing `in …` phrase, then take the LAST token of the text before the first
 * comma. One rule reads both conventions the catalog holds:
 *
 * - an inverted USDA name has a one-word first segment, so its last token is its first (`Flour, wheat` → flour);
 * - a natural-order name has its head noun last (`milk crackers` → cracker, `1% milk` → milk), and so does a
 *   multi-word first segment (`Cinnamon buns, frosted` → bun).
 *
 * ⛔ This replaced a FIRST-word rule for comma-free names (ADR-0070). That rule stood in for a default meaning
 * (`Carob flour` had head `carob` so the query `flour` would not crown it), and it became wrong when the curated
 * seed renamed 2,640 of its 2,642 roots into natural English: on 2026-10-25 a prod paste import bound `milk` to
 * milk crackers, `salt` to salt cod, `cinnamon` to cinnamon rolls and `bread` to bread flour. A default meaning is
 * now a seed default (a separate kind, never a synonym), so the head rule can tell the truth: carob flour is a flour.
 *
 * If the first segment holds no token, the reduced whole text answers, then the original text, so a name has a
 * head whenever it holds anything alphanumeric. ⚠️ The SQL mirror is `rank_head_of()` (migration 0025): change
 * both or neither, and let `rankingConformance` prove they agree.
 *
 * @param text - A catalog name or a typed query.
 * @returns The head term, or `undefined` when the text holds nothing alphanumeric. Pure.
 */
export function rankingHeadOf(text: string): string | undefined {
    const reduced = text.replace(BRACKETED_GROUP, ' ').replace(IN_PHRASE, '');
    const commaIndex = reduced.indexOf(',');
    const firstSegment = commaIndex >= 0 ? reduced.slice(0, commaIndex) : reduced;

    return (
        lastToken(rankingTokens(firstSegment)) ?? lastToken(rankingTokens(reduced)) ?? lastToken(rankingTokens(text))
    );
}

/**
 * Parse a CATALOG NAME into its ranking terms. The head is {@link rankingHeadOf}'s, the same as a query's.
 *
 * @param name - The catalog display name.
 * @returns Its ranking terms. Pure.
 */
export function describeRankingName(name: string): RankingTerms {
    return { folded: foldForRanking(name), tokens: rankingTokens(name), head: rankingHeadOf(name) };
}

/**
 * The comparison key of a phrase: its folded, singularized tokens joined by one space. Two phrases with the same key
 * say the same words in the same order, whatever their case, accents, plurals or punctuation. ⚠️ The SQL mirror is
 * `rank_alias_keys_of()` (migration 0026), applied to each synonym.
 *
 * @param text - A name, a synonym or a typed query.
 * @returns The key; `''` when the text holds nothing alphanumeric. Pure.
 */
export function rankingKeyOf(text: string): string {
    return rankingTokens(text).join(' ');
}

/** A catalog root's ranking terms: its name's terms, plus the keys of its curated synonyms. */
export interface CatalogNameTerms extends RankingTerms {
    /** {@link rankingKeyOf} of each synonym, empty keys removed. What the `synonym` rung compares. */
    readonly synonymKeys: readonly string[];
}

/**
 * Parse a catalog ROOT — its name and its synonyms — into the terms the ladder classifies.
 *
 * The synonyms are REQUIRED, not defaulted: a caller that forgets them would rank every root as if it had none, and
 * the `synonym` rung would silently never hold.
 *
 * @param name - The root's display name.
 * @param synonyms - The root's curated synonyms (food's `aliases`, split on its delimiter).
 * @returns The terms. Pure.
 */
export function describeCatalogName(name: string, synonyms: readonly string[]): CatalogNameTerms {
    return {
        ...describeRankingName(name),
        synonymKeys: synonyms.map(rankingKeyOf).filter((key) => key.length > 0),
    };
}

/**
 * Parse a TYPED QUERY into its ranking terms. The head is {@link rankingHeadOf}'s, the same as a name's.
 *
 * ⚠️ A name and a query used to take OPPOSITE heads (first word of a name, last word of a query), because the
 * catalog wrote inverted names. One rule now reads both, so a name and its own text always meet at the head rung,
 * and a cook who types the inverted form back (`flour, all purpose`) still means flour.
 *
 * @param query - The trimmed user query.
 * @returns Its ranking terms. Pure.
 */
export function describeRankingQuery(query: string): RankingTerms {
    return { folded: foldForRanking(query), tokens: rankingTokens(query), head: rankingHeadOf(query) };
}
