/**
 * @module db-reaper/perPrDatabaseScope — the pure scope predicate that authorises a `DROP DATABASE`.
 *
 * ⛔ **THIS FILE IS A SECURITY BOUNDARY.** `PerPrDatabaseReaperFunction` (ADR-0031) connects to the shared
 * sandbox RDS instance **as the master user** and drops logical databases. On that instance also live
 * `kitchensink_identity` — the database every per-PR preview signs in against — and the base
 * `kitchensink_food` / `kitchensink_recipes` that every preview's database is CLONED from. Nothing but the
 * precision of the predicates below keeps a `pr-{N}` token away from them.
 *
 * It sits in the family of `.github/scripts/pr-scope.sh`, `.github/scripts/sandbox-wake.sh`'s
 * `db_wake_is_sandbox_instance` and `sandboxSharedTier.ts`: one sourceable module of pure verdicts, with a
 * regression suite (`packages/infra/global/__tests__/perPrDatabaseScope.test.ts`) that EXECUTES it rather
 * than re-implementing it, and that fires it at deliberately violating fakes.
 *
 * ## The rule
 *
 * A database is reapable for a token **iff all three** hold:
 *
 *  1. the token is exactly `pr-{digits}` ({@link isPerPrToken}) — the same shape `pr_scope_is_token` demands;
 *  2. the database is not one of the explicitly {@link PROTECTED_DATABASES}; and
 *  3. the database name is EXACTLY one of the names {@link perPrDatabaseNamesFor} derives for that token.
 *
 * ⛔ **Exact equality, never a prefix and never `LIKE '%_pr_%'`.** `kitchensink_food_pr_15` must not answer a
 * request for `pr-1`. Here that is STRUCTURAL rather than something a trailing delimiter has to catch, which
 * is the same argument `pr_scope_environment_belongs` makes for GitHub Environments — and it is the stronger
 * form available because, unlike an AWS stack, a logical database never carries a `pr-{N}-…` suffix. The
 * weaker `pr_scope_belongs` prefix rule is deliberately NOT reused.
 *
 * ⛔ **Two INDEPENDENT checks, because one is always one edit away from authorising destruction.** Check 2 is
 * a DENYLIST of exact names — a statement about the database that survives any change to the derivation, and
 * that names `kitchensink_identity` even though no derivation could ever produce it. Check 3 is an ALLOWLIST
 * of exact names — a statement about the token × database pair. Neither is the authority alone, and the
 * handler re-runs the whole verdict at the point of destruction on top of both.
 *
 * ## Why the register is keyed by its producing function
 *
 * ADR-0006 gives exactly two services a per-PR logical database, and each derives its name from a
 * `*DatabaseNameForStage` function in its own CDK stack. Keying the register by that function name lets
 * `perPrDatabaseDropDoors.test.ts` compare it, by exact equality, against the producers DISCOVERED in the
 * infra tree — so a third service landing tomorrow with its own per-PR database fails the build rather than
 * becoming silently unreapable. A copy of a list cannot detect that the list is incomplete.
 *
 * Every function here is pure and total.
 */

/**
 * The shared base logical database each `*DatabaseNameForStage` derivation produces per-PR children under.
 *
 * ⛔ The KEY is the CDK function that owns the naming rule (`foodDatabaseNameForStage` in
 * `FoodServiceStack.ts`, `recipeDatabaseNameForStage` in `@kitchensink/recipe-core`), not a service name.
 * That is what makes the register comparable against the tree: the guard discovers calls to
 * `*DatabaseNameForStage`, and a producer present in one side and absent from the other is a failure in
 * both directions.
 *
 * ⚠️ `kitchensink_identity` is deliberately ABSENT: the identity service has no per-PR database at all
 * (ADR-0006), so it has no producer. It appears in {@link PROTECTED_DATABASES} instead, which is the point of
 * keeping the two registers separate.
 */
export const PER_PR_DATABASE_BASE_BY_PRODUCER: Readonly<Record<string, string>> = {
    foodDatabaseNameForStage: 'kitchensink_food',
    recipeDatabaseNameForStage: 'kitchensink_recipes',
};

/** The base databases that HAVE per-PR children, derived from the register above so the two cannot drift. */
export const PER_PR_DATABASE_BASES: readonly string[] = [...new Set(Object.values(PER_PR_DATABASE_BASE_BY_PRODUCER))];

/**
 * Every database name this reaper must NEVER drop, whatever the token.
 *
 * ⛔ An explicit denylist is the exception to ADR-0005's no-denylist rule, and it is warranted for exactly
 * the reason `pr_scope_is_protected_environment` gives: these names carry no `pr-{N}` marker and no tag to
 * cross-check, so there is no second independent signal that would catch a mistake. It is the SECOND guard,
 * not the only one — check 3 refuses all of these on its own terms too, because none is a derived name.
 *
 * The three `kitchensink_*` bases are the shared, persistent databases behind every preview.
 * `postgres`/`template0`/`template1` are PostgreSQL's own; `rdsadmin` is RDS's maintenance database. None of
 * the latter four could reach a `DROP` through check 3 either, and they are named anyway because a denylist
 * whose entries are all unreachable teaches the next reader that the list is decorative.
 */
export const PROTECTED_DATABASES: readonly string[] = [
    'kitchensink_identity',
    ...PER_PR_DATABASE_BASES,
    'postgres',
    'template0',
    'template1',
    'rdsadmin',
];

/** Raised when a caller reaches the derivation without having passed {@link isPerPrToken} first. */
export class PerPrScopeViolationError extends Error {
    /** The token that was refused, verbatim, so an operator can see what was actually passed. */
    public readonly token: string;

    public constructor(token: string) {
        super(
            `Refusing to derive per-PR database names from '${token}': a teardown token must be exactly ` +
                '`pr-` followed by one or more digits. Reaching this means a caller skipped ' +
                'isPerPrToken() — failing loudly rather than matching something.',
        );
        this.name = 'PerPrScopeViolationError';
        this.token = token;
        Object.setPrototypeOf(this, PerPrScopeViolationError.prototype);
    }
}

/** Type guard for {@link PerPrScopeViolationError}. */
export function isPerPrScopeViolationError(error: unknown): error is PerPrScopeViolationError {
    return error instanceof PerPrScopeViolationError;
}

/**
 * The only token shape a reap may act on: exactly `pr-` followed by one or more digits.
 *
 * ⚠️ The same rule as `pr_scope_is_token`, restated in TypeScript rather than shared, because the shell file
 * cannot be imported into a Lambda bundle. The two are pinned to each other by
 * `perPrDatabaseReaperTeardown` in the teardown integration suite, which drives the real script.
 *
 * Anchored at BOTH ends so no whitespace, glob, path traversal, SQL fragment or bare stage name can pass.
 *
 * @param token - The candidate teardown token.
 * @returns `true` when the token is well formed. Pure.
 */
export function isPerPrToken(token: string): boolean {
    return /^pr-[0-9]+$/.test(token);
}

/**
 * Whether a database name is one this reaper must never drop.
 *
 * Exact, case-sensitive equality: PostgreSQL identifiers are case-sensitive once quoted, and every name this
 * repository derives is lowercase, so a case-folding comparison would widen the denylist onto names nobody
 * here creates while doing nothing for the ones we do.
 *
 * @param databaseName - A name as `pg_database.datname` reports it.
 * @returns `true` when the name is protected. Pure.
 */
export function isProtectedDatabase(databaseName: string): boolean {
    return PROTECTED_DATABASES.includes(databaseName);
}

/**
 * The database names this repository's own derivations produce for one PR token.
 *
 * The suffix rule mirrors `foodDatabaseNameForStage` / `recipeDatabaseNameForStage`: the stage is lowercased
 * and every run of non-alphanumerics becomes one `_`, so the stage `pr-73` yields `kitchensink_food_pr_73`.
 * Restated here rather than imported, because those functions live in two service packages the global infra
 * package does not depend on — and because this module must stay import-free to bundle into a Lambda
 * cleanly. The restatement is not left to trust: `perPrDatabaseDropDoors.test.ts` compares this register
 * against the producers discovered in the infra tree, and the reaper's own suite pins the shape.
 *
 * @param token - A token that has already passed {@link isPerPrToken}.
 * @returns One name per registered base, in register order.
 * @throws {PerPrScopeViolationError} when the token is malformed — never an empty list, so a caller that
 *   skipped the gate fails loudly instead of silently matching nothing.
 */
export function perPrDatabaseNamesFor(token: string): readonly string[] {
    if (!isPerPrToken(token)) {
        throw new PerPrScopeViolationError(token);
    }

    const suffix = token.replace('-', '_');

    return PER_PR_DATABASE_BASES.map((base) => `${base}_${suffix}`);
}

/**
 * ⛔ THE VERDICT THAT AUTHORISES A `DROP DATABASE`.
 *
 * Three checks, of which the last two are independent statements about different things — see the module
 * docstring. A `false` here is a refusal, never "probably fine".
 *
 * @param token - The teardown token, e.g. `pr-73`.
 * @param databaseName - A name as `pg_database.datname` reports it.
 * @returns `true` iff this exact database belongs to this exact PR. Pure.
 */
export function isReapablePerPrDatabase(token: string, databaseName: string): boolean {
    // 1. The gate. Everything below splices the token into a derived name, so a loose token is how an
    //    over-broad match gets in.
    if (!isPerPrToken(token)) {
        return false;
    }

    // 2. The refusal — a statement about the DATABASE alone, which holds even if the derivation below were
    //    ever widened by mistake.
    if (isProtectedDatabase(databaseName)) {
        return false;
    }

    // 3. The derivation — exact equality with a name this repository generates for this token. `includes`
    //    on a two-element list rather than a regex: there is no pattern to get subtly wrong.
    return perPrDatabaseNamesFor(token).includes(databaseName);
}

/**
 * The PR token that owns a database, or `null` if none does — the census direction.
 *
 * The reaper must be able to COUNT stranded per-PR databases with no token in hand (ADR-0031), so this is
 * the inverse of {@link isReapablePerPrDatabase} rather than a second, looser rule. It is written as a
 * separate implementation on purpose, and the two are asserted to AGREE for every combination the suite can
 * construct — a widening of one cannot quietly outrun the other.
 *
 * ⚠️ The round-trip is what makes it exact. `kitchensink_food_pr_01` yields `pr-01`, not `pr-1`: the token
 * must re-derive the SAME name, so a leading zero identifies a different (equally well-formed) token rather
 * than collapsing onto `pr-1` and letting a `pr-1` teardown claim it.
 *
 * @param databaseName - A name as `pg_database.datname` reports it.
 * @returns The owning `pr-{N}` token, or `null` for anything this reaper has no claim on. Pure.
 */
export function perPrTokenOfDatabase(databaseName: string): string | null {
    if (isProtectedDatabase(databaseName)) {
        return null;
    }

    for (const base of PER_PR_DATABASE_BASES) {
        const prefix = `${base}_pr_`;

        if (!databaseName.startsWith(prefix)) {
            continue;
        }

        const digits = databaseName.slice(prefix.length);

        if (!/^[0-9]+$/.test(digits)) {
            continue;
        }

        const token = `pr-${digits}`;

        // The round trip. Without it, any name that merely STARTS with the prefix and ends in digits would
        // be claimed — `kitchensink_food_pr_73_1` among them.
        if (perPrDatabaseNamesFor(token).includes(databaseName)) {
            return token;
        }
    }

    return null;
}
