/**
 * LIKE/ILIKE pattern construction for the identity service's admin filters.
 *
 * ## The defect this closes
 *
 * `AdminService.listUsers` built its filters as `ilike(users.email, `%${filters.email}%`)`. `%` and `_` are
 * SYNTAX to `ILIKE`, not data, and they sit inside the bound parameter's VALUE — which is exactly where the
 * pattern matcher looks for them. Parameterisation is therefore no defence at all here: it stops the string
 * escaping the literal (there is no SQL-injection exposure), and does nothing about the string being read as
 * a pattern.
 *
 * So `?email=%` produced `ILIKE '%%%'` — a predicate matching every user row, i.e. the filter silently became
 * "no filter". `?email=___` matched every address of three characters or more. Two consequences, neither
 * theoretical:
 *
 *  - **Bounded work.** `users.email` is `citext` and the admin list is `LIMIT`-ed, so the blast radius is
 *    smaller than food's unbounded catalog scan — but the predicate still degrades to a full pass over
 *    `users`, and the endpoint accepts an arbitrary number of them.
 *  - **Wrong answers.** An admin searching for the literal text `a_b@example.com` matched addresses that do
 *    not contain it. A filter that quietly over-matches on an account-administration surface is a correctness
 *    problem before it is a performance one.
 *
 * ## Why one pass, and why `ESCAPE` is declared at the call site
 *
 * The classic implementation escapes `\`, then `%`, then `_`, and the ORDER only matters because it is
 * sequential — doing `%` before `\` re-escapes the backslashes just inserted and doubles them. A single
 * left-to-right pass cannot revisit its own output, so that hazard is unrepresentable rather than merely
 * avoided. `$&` re-emits whichever metacharacter matched.
 *
 * Drizzle's `ilike()` emits no `ESCAPE` clause, so this relies on Postgres' default escape character being
 * backslash. That default is a `standard_conforming_strings` setting away from surprising, which is why
 * {@link LIKE_ESCAPE_CHARACTER} is exported: the DAO-level statements that can state it, do.
 *
 * ⚠️ SECOND COPY, RECORDED RATHER THAN HIDDEN. `packages/services/food-service/src/foods/dao/
 * food-search.dao.ts` (`toIlikePattern`) is the same escaping rule for the food catalog's search. Two
 * occurrences of one piece of knowledge is exactly where this repo's guidance says to wait for the third
 * rather than invent a shared workspace package: the two services share no dependency today, so unifying
 * them means a new leaf package on the auth hot path's import graph. The duplication is deliberate and
 * flagged; a third occurrence should extract it.
 */

/**
 * Every character that is SYNTAX to `LIKE`/`ILIKE` rather than data: the two wildcards (`%` matches any run
 * of characters, `_` matches exactly one) and the escape character itself.
 */
const LIKE_METACHARACTERS = /[\\%_]/gu;

/** The escape character these patterns are built for — Postgres' default, stated rather than assumed. */
export const LIKE_ESCAPE_CHARACTER = '\\';

/**
 * Escape every LIKE metacharacter in a user-supplied string, so it matches as literal text.
 *
 * @param value - The raw, user-supplied filter text.
 * @returns The same text with `\`, `%` and `_` escaped. Pure.
 */
export function escapeLikeMetacharacters(value: string): string {
    return value.replace(LIKE_METACHARACTERS, '\\$&');
}

/**
 * Build a `%…%` substring `ILIKE` pattern that matches the caller's text LITERALLY.
 *
 * @param value - The raw, user-supplied filter text.
 * @returns The substring pattern, safe to hand to `ilike()`. Pure.
 */
export function containsPattern(value: string): string {
    return `%${escapeLikeMetacharacters(value)}%`;
}
