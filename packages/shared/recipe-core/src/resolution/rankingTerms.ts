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
 * Parse a CATALOG NAME into its ranking terms. The head is the **first** token — unless the name carries a
 * comma AND its first comma segment is multi-word, in which case the head is that segment's **last** token.
 *
 * The base rule is USDA's naming convention read literally: the catalog inverts a food's name so the head
 * noun leads (`Flour, wheat, all-purpose`; `Sugars, brown`; `Vinegar, red wine`; `Chives, raw`). A name
 * whose head is `carob` is a carob product however prominently `flour` appears later in it — which is
 * exactly what disqualifies `Carob flour`, `Crackers, milk` and the sugar-coated candy from the head tier.
 *
 * ⛔ The comma-segment amendment (plan U1, D4b) exists because SR Legacy also contains NATURAL-ORDER
 * product names whose first segment is an English noun phrase: `Cinnamon buns, frosted` is a bun, and the
 * first-token rule crowned its MODIFIER — measured 2026-08-29, that name won the bare query `cinnamon` at
 * the head rung with a WIDE margin, a false catch that would have skipped verification. Inside a multi-word
 * first segment the head noun is FINAL (the same reason {@link describeRankingQuery}'s head is last).
 *
 * ⚠️ A NO-COMMA name keeps its first token deliberately, in both directions: flipping `Carob flour` to a
 * last-word head would promote the attractor INTO the head rung for the query `flour` — the exact defect
 * the head asymmetry was built to end.
 *
 * @param name - The catalog (or local ingredient) display name.
 * @returns Its ranking terms. Pure.
 */
export function describeRankingName(name: string): RankingTerms {
    const tokens = rankingTokens(name);
    const commaIndex = name.indexOf(',');
    let head = tokens[0];

    if (commaIndex >= 0) {
        const segmentTokens = rankingTokens(name.slice(0, commaIndex));

        if (segmentTokens.length > 1) {
            head = segmentTokens[segmentTokens.length - 1];
        }
    }

    return { folded: foldForRanking(name), tokens, head };
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
