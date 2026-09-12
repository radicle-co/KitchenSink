/**
 * ⛔ THE ONE REGISTRY OF ADVISORY-LOCK CLASSES.
 *
 * An advisory lock's key is scoped to the CURRENT DATABASE: PostgreSQL builds the lock tag from `MyDatabaseId` and
 * the key (`src/backend/utils/adt/lockfuncs.c`), so two databases on one instance never contend. Inside one
 * database, though, every concern shares one key space, and food's database holds several. A registry keeps them
 * disjoint, and keeps a class number meaning one thing in every service, so a reader never has to ask which
 * database a number was chosen for.
 *
 * PostgreSQL offers two DISJOINT spaces: the single-argument `bigint` form and the two-argument
 * `(classid, objid)` form. A caller that takes the two-argument form with a class from this file cannot
 * collide with any other registered class, whatever it hashes into `objid`.
 *
 * ## Why a shared registry rather than a constant per service
 *
 * ⛔ Per-service numbering is the bug, not the cure. `food-service` held `WORKER_LOCK_CLASS = 1`,
 * `LOCK_CLASS_DEDUP = 2` and `LOCK_CLASS_LIMITER = 3` as local constants, and each new concern picked the next
 * integer by reading its neighbours. A shared registry makes a new class a reviewed code change instead. This is the
 * same lesson ALB listener priorities already learned here: per-service copies of a band registry drifted and
 * collided, so the allocation moved to ONE allocator.
 *
 * ⚠️ Two call sites used the BARE single-argument form with `hashtext(...)` — food's enqueue serializer and
 * recipe's per-owner collections lock. Each shared the `bigint` space with every other single-argument key
 * its database might ever take, with nothing but hash luck keeping them apart. They now take classes from here.
 *
 * ⛔ NEVER REUSE A NUMBER, even for a class whose owner is deleted — a rolling deploy can have the old and
 * new code live at once, and a reused class silently reintroduces the collision this file exists to prevent.
 * Add the next integer and leave the gap. A deleted owner's class moves to {@link RETIRED_ADVISORY_LOCK_CLASSES},
 * which keeps its number and its name out of use.
 *
 * ## The reserved single-argument keys
 *
 * A few fixed SESSION keys deliberately stay in the single-argument space: {@link RESERVED_ADVISORY_LOCK_KEYS}. Each is
 * far above `int4`, and `hashtext` returns `int4`, so a per-entity lock can never hash onto one. Each is also already
 * bound by deployed code, so moving one into a class would let an old caller and a new one both hold the lock during a
 * rolling deploy.
 */

/**
 * Every advisory-lock class, by the concern that owns it. A class means the same in every database it is taken in.
 *
 * ⛔ `as const` and exhaustively typed so a new class is a code change here, visible in review, rather than
 * an integer invented at a call site. `packages/infra/global/__tests__/advisoryLockClasses.test.ts` asserts
 * that every advisory-lock call in the repo takes the two-argument form with a member of this object, and
 * that the numbers are unique.
 */
export const ADVISORY_LOCK_CLASSES = {
    /** food-service's Fargate consumer singleton (`worker/workerLock.ts`). */
    foodWorkerSingleton: 1,
    /** food-service's per-normalized-name dedup on food creation (`foods/dao/food.dao.ts`). */
    foodNameDedup: 2,
    /** food-service's per-source call-rate limiter (`foods/dao/sourceCallLog.dao.ts`). */
    foodSourceLimiter: 3,
    /** food-service's per-food enqueue serializer, so `fetch_requesters` cannot race (FR-044). */
    foodEnqueue: 4,
    /** recipe-service's per-owner collections lock, which serializes `sortOrder` assignment. */
    recipeCollectionOwner: 5,
    /** recipe-service's per-normalized-key parse-correction lock. */
    recipeParseCorrection: 6,
    /** recipe-service's per-normalized-key resolution-mapping lock. */
    recipeResolutionMapping: 7,
    /** recipe-service's per-recipe photo lock, which serializes `sortOrder` and cover selection. */
    recipePhoto: 8,
    /**
     * food-service's catalog seed (`foods/seed/catalog/catalogSeedTransaction.ts`, curated plan KTD-2): a SESSION lock
     * taken before any transaction, so a second apply plans against the first one's committed rows.
     */
    foodCatalogSeed: 10,
    /**
     * food-service's per-item remote adoption (`foods/remote/AdoptRemoteFood.ts`, ADR-0055 point 10): concurrent adopts
     * of one source item make one root.
     */
    foodRemoteAdoption: 11,
} as const;

/**
 * Every class whose owner was deleted, by the concern that held it. Nothing takes these: a live class may reuse
 * neither the number nor the name (`advisoryLockClasses.test.ts`).
 */
export const RETIRED_ADVISORY_LOCK_CLASSES = {
    /**
     * food-service's per-source mirror sync lock. The mirror was deleted when the owner ruled that runtime search calls
     * only a source whose API can search, and every static download belongs in the seed (2026-10-01).
     */
    foodMirrorSync: 9,
} as const;

/** One registered advisory-lock class. */
export type AdvisoryLockClass = (typeof ADVISORY_LOCK_CLASSES)[keyof typeof ADVISORY_LOCK_CLASSES];

/**
 * Every fixed key in the single-argument `bigint` space, by the concern that takes it. Like a class, a key is never
 * reused or renumbered: deployed code already binds each number.
 */
export const RESERVED_ADVISORY_LOCK_KEYS = {
    /**
     * Every master-connected pass over the role catalog: the role-model bootstrap and the per-PR reaper (ADR-0039),
     * held for the whole pass on the maintenance database. ⛔ Nothing else serializes them: the provider framework
     * re-invokes a handler on a transport error while the first invocation may still run, and two interleaved passes
     * are a lock-out (A reads "the master is not in the app role", B joins it for the recreate, A grants `rds_iam`).
     */
    roleCatalog: 7_412_200_228_220_039,
    /** `applyMigrations`' apply loop, in the database being migrated. */
    schemaMigration: 7_412_200_228_220_022,
    /** `@kitchensink/service-test-harness` provisioning roles and databases on a test server. */
    testDatabaseProvisioning: 7_412_200_228_220_023,
} as const;

/** The name of one reserved key. */
export type ReservedAdvisoryLockName = keyof typeof RESERVED_ADVISORY_LOCK_KEYS;

/** A lock in the two-argument space: a registered class, and an `int4` object within it. */
export interface RegisteredAdvisoryLock {
    /** A class from {@link ADVISORY_LOCK_CLASSES}, never an integer invented at the call site. */
    readonly classId: AdvisoryLockClass;
    /** The object within the class: an `int4`. */
    readonly objectId: number;
    /** Absent: a key is registered or reserved, never both. */
    readonly reserved?: never;
}

/** A lock in the single-argument space: one of {@link RESERVED_ADVISORY_LOCK_KEYS}, by name. */
export interface ReservedAdvisoryLock {
    /** Which reserved key. */
    readonly reserved: ReservedAdvisoryLockName;
    /** Absent: a key is registered or reserved, never both. */
    readonly classId?: never;
    /** Absent: a key is registered or reserved, never both. */
    readonly objectId?: never;
}

/** Any advisory lock this repository takes: registered or reserved. */
export type AdvisoryLockKey = RegisteredAdvisoryLock | ReservedAdvisoryLock;
