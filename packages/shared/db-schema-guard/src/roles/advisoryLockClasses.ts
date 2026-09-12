/**
 * ⛔ THE ONE REGISTRY OF ADVISORY-LOCK CLASSES, because PostgreSQL's advisory locks are CLUSTER-WIDE.
 *
 * `pg_advisory_lock` keys are not scoped to a database. Every database on the instance shares one lock
 * space, and ADR-0006 puts identity, food, recipe and every `pr-{N}` logical database on ONE instance — so a
 * key chosen inside the food service is a key chosen for the whole cluster, including services that package
 * cannot see.
 *
 * PostgreSQL offers two DISJOINT spaces: the single-argument `bigint` form and the two-argument
 * `(classid, objid)` form. A caller that takes the two-argument form with a class from this file cannot
 * collide with any other registered class, whatever it hashes into `objid`.
 *
 * ## Why a shared registry rather than a constant per service
 *
 * ⛔ Per-service numbering is the bug, not the cure. `food-service` held `WORKER_LOCK_CLASS = 1`,
 * `LOCK_CLASS_DEDUP = 2` and `LOCK_CLASS_LIMITER = 3` as local constants; nothing stopped `recipe-service`
 * from picking `1` for something unrelated, and because the space is cluster-wide the two would then
 * serialize against each other across databases — visible only as unexplained contention between services
 * that share no code. This is the same lesson ALB listener priorities already learned here: per-service
 * copies of a band registry drifted and collided, so the allocation moved to ONE allocator.
 *
 * ⚠️ Two call sites used the BARE single-argument form with `hashtext(...)` — food's enqueue serializer and
 * recipe's per-owner collections lock. Those shared the `bigint` space with each other AND with
 * `ROLE_CATALOG_LOCK_KEY` (`./catalogLock.ts`), on the same instance, with nothing but hash luck keeping them apart. They
 * now take classes from here. The role-catalog key itself is left in the single-argument space on purpose:
 * it is a SESSION lock taken on the maintenance database by the bootstrap and the reaper, its value
 * (`7_412_200_228_220_039`) is far outside `hashtext`'s `int4` range, and moving it would change a key two
 * deployed callers already agree on for no gain.
 *
 * ⛔ NEVER REUSE A NUMBER, even for a class whose owner is deleted — a rolling deploy can have the old and
 * new code live at once, and a reused class silently reintroduces the collision this file exists to prevent.
 * Add the next integer and leave the gap.
 *
 * ## The single-argument keys that are NOT affected, and why
 *
 * Three fixed SESSION keys deliberately stay in the single-argument space, and they are safe for a reason
 * that is worth stating rather than rediscovering: each is a hand-picked constant sharing the prefix
 * `7412200228220…` — `ROLE_CATALOG_LOCK_KEY` (`./catalogLock.ts`) (`…039`), `applyMigrations`' migration lock (`…022`) and
 * the test harness's provisioning lock (`…023`). All three are far above `int4`, and `hashtext` returns
 * `int4` — so a per-entity lock can never hash onto one of them. That prefix IS their namespace, and the
 * five per-entity locks registered below are what had no namespace at all.
 */

/**
 * Every advisory-lock class in the cluster, by the concern that owns it.
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
} as const;

/** One registered advisory-lock class. */
export type AdvisoryLockClass = (typeof ADVISORY_LOCK_CLASSES)[keyof typeof ADVISORY_LOCK_CLASSES];
