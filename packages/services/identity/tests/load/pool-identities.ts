/**
 * The ONE derivation of the synthetic principals the identity k6 load suite uses.
 *
 * Two prepare steps need the same ids from opposite directions — `prepare-db.ts` SEEDS the warm rows and
 * `prepare-clerk-tokens.ts` MINTS tokens whose `sub` must match them — so the mapping
 * `index -> { sub, userId, email, displayName }` lives here once and is imported by both. The k6 scripts
 * never re-derive anything: they consume the token pool as DATA (`open()` + `SharedArray`), so a rule
 * change here can never silently desynchronise the runtime from the fixtures.
 *
 * TypeScript, not `.mjs`, deliberately: this module is inside the package's `tsconfig.json` `include`
 * (`tests/**\/*.ts`), and an untyped `.mjs` import would make every value crossing this boundary `any`
 * under `strict` — so the compiler would check none of the pool shapes the whole tier depends on. Both
 * prepare steps therefore run under `tsx`, the runner the recipe/food prepare steps already use.
 *
 * `userId` is a CANONICALLY VALID ULID (`ulidx.isValid` → true): 26 Crockford base32 chars with a
 * first char <= '7'. `users.id` is a bare `text` column so Postgres accepts anything, but
 * `isUserId`/`newUserId` (`@kitchensink/identity-db`) treat it as a real ULID, and seeding a value that
 * would fail that guard plants a landmine for the first caller that validates. The `01KD` prefix is a
 * plausible timestamp; `WARM`/`ADMN`/`MASS` are the role tags (every letter is inside the Crockford
 * alphabet — `I`, `L`, `O` and `U` are NOT, which is why the recognisable `01JLOAD…` shape used by the
 * recipe/food load suites is deliberately not reused here: it is not a valid ULID).
 *
 * Every value is namespaced under the non-resolvable `identity-load.test` TLD (RFC 2606) so a load
 * fixture can never collide with, or be mistaken for, a real user.
 *
 * @module
 */

/** Crockford-valid ULID prefix shared by every seeded principal (a plausible 48-bit timestamp). */
const ULID_PREFIX = '01KD';

/** Total ULID length. */
const ULID_LENGTH = 26;

/** Reserved e-mail domain (RFC 2606) — never deliverable, never a real user. */
export const POOL_EMAIL_DOMAIN = 'identity-load.test';

/**
 * Display-name prefix shared by every warm principal, so warm rows are recognisable in the database and
 * in an admin listing.
 *
 * NOT the `admin-user-search.load.js` `?name=` needle, deliberately: it matches EVERY warm principal —
 * exactly `IDENTITY_WARM_POOL_SIZE` (50) rows — and because the warm users are inserted first they sit at
 * the head of the heap, so Postgres satisfies the endpoint's `limit 50` within the first ~50 tuples and
 * never scans. That scenario needs a needle matching FEWER rows than the limit; see `adminSearch` in
 * `prepare-clerk-tokens.ts`.
 */
export const POOL_NAME_NEEDLE = 'Warmload';

/** The scope `AdminController` requires (`@RequireScopes('admin:users')`). */
export const ADMIN_SCOPE = 'admin:users';

/**
 * Field fragments the BULK filler users are composed from. `prepare-db.ts` inserts those users with one
 * set-based `generate_series` statement (20k round trips would dominate the prepare step), so the SQL
 * cannot call {@link bulkIdentity} per row — it composes the SAME fragments instead. Exporting them keeps
 * ONE authoritative statement of each fragment; the two builders are two renderings of it, never two
 * definitions, and `prepare-db.ts` asserts the rendered row matches {@link bulkIdentity} before running.
 */
export const BULK_ULID_PREFIX = `${ULID_PREFIX}MASS`;
/** @see BULK_ULID_PREFIX */
export const BULK_SUB_PREFIX = 'user_load_bulk_';
/** @see BULK_ULID_PREFIX */
export const BULK_EMAIL_PREFIX = 'bulk-';
/** @see BULK_ULID_PREFIX */
export const BULK_NAME_PREFIX = 'Bulkload ';
/** @see BULK_ULID_PREFIX — the width the SQL must `lpad` the index to. */
export const BULK_INDEX_PAD = ULID_LENGTH - BULK_ULID_PREFIX.length;

/** A principal that must exist in the database before the load starts (user + account + profile). */
export interface SeededIdentity {
    /** The Clerk subject — what `resolveOrCreateFromClaims` keys `users.identity_id` on. */
    readonly sub: string;
    /** The app-user ULID (`users.id`). */
    readonly userId: string;
    /** The `users.email` value (citext). */
    readonly email: string;
    /** The `users.name` / `profiles.display_name` value. */
    readonly displayName: string;
}

/** A principal that must NOT exist yet — its first request drives read-through provisioning. */
export interface UnseededIdentity {
    /** The Clerk subject. */
    readonly sub: string;
    /** The `email` claim the service will write on first-sight provisioning. */
    readonly email: string;
}

/** Build a 26-char Crockford ULID from a role-tagged prefix and a numeric index. Pure. */
function poolUlid(prefix: string, index: number): string {
    return `${prefix}${String(index).padStart(ULID_LENGTH - prefix.length, '0')}`;
}

/**
 * The i-th WARM principal: pre-seeded (user + account + profile) so `GET /api/v1/users/me` measures the
 * steady-state read path instead of paying first-sight provisioning during ramp-up.
 *
 * @param index - Zero-based pool index.
 * @returns The Clerk `sub`, the app-user ULID, the e-mail and the display name. Pure.
 */
export function warmIdentity(index: number): SeededIdentity {
    return {
        sub: `user_load_warm_${index}`,
        userId: poolUlid(`${ULID_PREFIX}WARM`, index),
        email: `warm-${index}@${POOL_EMAIL_DOMAIN}`,
        displayName: `${POOL_NAME_NEEDLE} ${index}`,
    };
}

/**
 * The i-th COLD principal: deliberately NOT seeded. Its first authenticated request is what drives the
 * read-through `provisionCompleteUser` transaction, so each token may be presented exactly ONCE per run
 * (see the exhaustion guard in `provisioning-and-rename.load.js`).
 *
 * @param index - Zero-based pool index.
 * @returns The Clerk `sub` and e-mail. No `userId`: the service mints the ULID. Pure.
 */
export function coldIdentity(index: number): UnseededIdentity {
    return {
        sub: `user_load_cold_${index}`,
        email: `cold-${index}@${POOL_EMAIL_DOMAIN}`,
    };
}

/**
 * The single ADMIN principal for `admin-user-search.load.js`. Seeded like a warm user; its token carries
 * `public_metadata.scopes: ['admin:users']`, the only thing `ScopesGuard` accepts.
 *
 * @returns The admin principal's ids. Pure.
 */
export function adminIdentity(): SeededIdentity {
    return {
        sub: 'user_load_admin',
        userId: poolUlid(`${ULID_PREFIX}ADMN`, 0),
        email: `admin@${POOL_EMAIL_DOMAIN}`,
        displayName: 'Load Admin',
    };
}

/**
 * The i-th BULK filler user (a `users` row only — the admin list projects only `users` columns, so
 * accounts and profiles would be dead weight). These exist to give the `ilike '%…%'` predicate a
 * realistically sized table: a btree on `users.email` cannot serve a LEADING-wildcard match, so the
 * planner falls back to a sequential scan whose cost is proportional to this population. Pure.
 *
 * @param index - Zero-based filler index.
 * @returns The filler user's ids.
 */
export function bulkIdentity(index: number): SeededIdentity {
    return {
        sub: `${BULK_SUB_PREFIX}${index}`,
        userId: poolUlid(BULK_ULID_PREFIX, index),
        email: `${BULK_EMAIL_PREFIX}${index}@${POOL_EMAIL_DOMAIN}`,
        displayName: `${BULK_NAME_PREFIX}${index}`,
    };
}
