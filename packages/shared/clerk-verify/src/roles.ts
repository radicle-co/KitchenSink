/**
 * THE role vocabulary of the signed claim: which roles exist, which get the paid features, which scopes a role
 * implies, and when the sign-up webhook writes a role (plan `docs/plans/2026-10-14-009-feat-roles-and-paid-gate-plan.md`).
 *
 * Owner rulings 2026-10-13 and 2026-10-15. Roles live in the Clerk-signed `public_metadata.roles`. `superuser`, `vip`
 * and `premium` get the paid features; `admin` and `default` do not. `admin` and `superuser` both carry every scope a
 * service checks: a superuser is an admin who also uses the whole app free (a developer), while an admin sees the paid
 * features as a default user does — the gate decides whether that is the upsell or nothing.
 *
 * It lives HERE, beside the parser of the claim it describes, for the reason `testPrincipal` does: every service and
 * the production edge verify through this package, and food depends on nothing else. It imports nothing, so it adds
 * nothing to any bundle that verifies a token.
 *
 * ⛔ The paid-features GATE is not here. It decides only whether a user without an entitled role is SHOWN the upsell,
 * and only the identity service reads it (`identity/src/users/domain/paidFeatureAccess.ts`). Who may USE a paid feature
 * is {@link hasPaidFeatures}, and it reads roles alone.
 *
 * ⛔ Roles are read through {@link parseRoles} and nothing else: exact strings, so `Premium`, `premium:trial` and a bare
 * `'premium'` string grant nothing. No roles is no entitlement — that fails closed, and it is NOT "absent means
 * default": the webhook still writes `default` ({@link needsDefaultRole}).
 *
 * @pattern Parser — `parseRoles`, parse-don't-validate at the token boundary
 * @pattern Specification — `hasPaidFeatures`, a pure predicate over the roles
 * @pattern Registry — `ROLE_SCOPES`, a typed `Record` over the `Role` union, so a role without an entry is a compile error
 */

/** Every role, as written in `public_metadata.roles`. Persisted in Clerk: renaming one means migrating every user. */
export const ROLES = ['admin', 'superuser', 'vip', 'premium', 'default'] as const;

/** One of {@link ROLES}. */
export type Role = (typeof ROLES)[number];

/** The `public_metadata` key roles live under. */
export const ROLES_METADATA_KEY = 'roles';

/** The roles that get the paid features, whatever the gate says. Not `admin` (owner ruling 2026-10-15). */
export const ENTITLED_ROLES: readonly Role[] = ['superuser', 'vip', 'premium'];

/** Every scope a service checks — the set `admin` and `superuser` both hold. */
const EVERY_CHECKED_SCOPE: readonly string[] = [
    'admin:users',
    'food:admin',
    'recipes:import:public',
    'recipes:mappings:global',
    'recipes:parses:global',
];

/**
 * The scopes each role implies, applied once at token verification (`verifyClerkToken`) on top of any scope written
 * explicitly. The literals are owned by the services that check them; `roleScopesCoverage.test.ts` holds `admin` and
 * `superuser` each EQUAL to every scope a service checks, so neither can miss one nor carry one nothing checks.
 *
 * `admin` and `superuser` hold the same scopes (owner ruling 2026-10-15); they differ only in the paid features
 * ({@link ENTITLED_ROLES}).
 */
export const ROLE_SCOPES: Readonly<Record<Role, readonly string[]>> = {
    admin: EVERY_CHECKED_SCOPE,
    superuser: EVERY_CHECKED_SCOPE,
    vip: [],
    premium: [],
    default: [],
};

/** What the sign-up webhook merges into a new user's `public_metadata`: the `roles` key and nothing else. */
export const DEFAULT_ROLE_METADATA: { readonly roles: readonly Role[] } = { roles: ['default'] };

const isRole = (value: unknown): value is Role => ROLES.some((role) => role === value);

/**
 * The roles a signed `public_metadata.roles` value grants. Pure and total.
 *
 * @param raw - The raw value of `public_metadata.roles`.
 * @returns The known roles it names, first occurrence order, without duplicates; `[]` for anything not a list.
 */
export function parseRoles(raw: unknown): readonly Role[] {
    if (!Array.isArray(raw)) {
        return [];
    }

    const roles: Role[] = [];

    for (const entry of raw as readonly unknown[]) {
        if (isRole(entry) && !roles.includes(entry)) {
            roles.push(entry);
        }
    }

    return roles;
}

/**
 * Whether the roles get the paid features. Pure. The gate plays no part.
 *
 * @param roles - Parsed roles.
 */
export function hasPaidFeatures(roles: readonly Role[]): boolean {
    return roles.some((role) => ENTITLED_ROLES.includes(role));
}

/**
 * Every scope the roles imply, each once. Pure.
 *
 * @param roles - Parsed roles.
 */
export function scopesForRoles(roles: readonly Role[]): readonly string[] {
    return [...new Set(roles.flatMap((role) => ROLE_SCOPES[role]))];
}

/**
 * Whether the sign-up webhook owes this user the `default` role. Pure.
 *
 * Only when `public_metadata` has no OWN `roles` key at all. A present value — even an empty or malformed one — is
 * something an admin or `poolAdmin` wrote, and the writer never overwrites it.
 *
 * @param publicMetadata - The user's current `public_metadata`, read fresh from Clerk.
 */
export function needsDefaultRole(publicMetadata: Readonly<Record<string, unknown>>): boolean {
    return !Object.hasOwn(publicMetadata, ROLES_METADATA_KEY);
}
