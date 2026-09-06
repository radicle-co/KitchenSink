/**
 * SEED THE PER-PR FOOD CATALOG — by asking the food service to sync a list of names from USDA.
 *
 * ## Why this exists
 *
 * ADR-0006 gives every `pr-{N}` preview its own fresh logical database, and nothing seeds the food half.
 * `GET /api/v1/foods/search?query=flour` answers `{"results":[]}` on a live, healthy preview — which is
 * ADR-0006's own open consequence showing up in a test, and why the recipe↔food linkage suite is gated off.
 *
 * ## Why THIS door, and not the two obvious alternatives
 *
 * `POST /api/v1/foods/batch` is a production path: any authenticated caller, no admin scope, up to 100
 * names, and the service's own worker fetches them from USDA exactly as it would for a real user. That is
 * the owner's ruling applied literally — data enters through the APIs and flows, so seeding exercises them.
 *
 * ⛔ NOT the bulk seed CLI (`npm run seed:usda-bulk`): it needs a `DATABASE_URL` to the in-VPC RDS, which a
 * GitHub runner cannot reach without a bastion, and an operator-downloaded dataset. ⛔ NOT ADR-0029's
 * authored-foods door either: those rows are private to their author until promoted, and the caller-invariant
 * `GET /api/v1/foods/nutrition?ids=` route the linkage suite reads EXCLUDES them
 * (`user_id IS NULL OR visibility = 'promoted'`), so the seed would be invisible to the very assertion it
 * exists to satisfy.
 *
 * ## It is ASYNCHRONOUS, and the poll is mandatory
 *
 * `batch` enqueues; a Postgres-backed queue plus `pg_notify` wakes a Fargate consumer that calls USDA and
 * persists. Search only returns `RESOLVED` rows, so searching too early answers `[]` — indistinguishable
 * from the empty catalog this exists to fill. Hence a bounded poll with a loud failure rather than a sleep.
 */

/** What one name's lifecycle looks like to a caller. */
export type CatalogItemStatus = 'PENDING' | 'RESOLVED' | 'UNRESOLVED' | 'NOT_FOUND' | 'FAILED';

/** A batch item as the service reports it. */
export interface CatalogItem {
    readonly id: string;
    readonly status: CatalogItemStatus;
}

/**
 * The names a run seeds.
 *
 * ⚠️ THE CUTS ARE NOT INTERCHANGEABLE. The linkage suite searches for a probe, then re-searches on the
 * probe's own HEAD TERM (`name.split(',')[0]`), and requires MORE THAN ONE result both times. A USDA
 * merge-winner name looks like `Chicken, broilers or fryers, breast…`, so the head term is `Chicken` — and
 * that assertion only holds if several distinct rows share it. Seeding one chicken cut and nine unrelated
 * staples would satisfy the first search and fail the second, for a reason nothing in the failure explains.
 *
 * The staples are there so a preview's catalog is useful beyond that one suite — the recipe typeahead and
 * the k6 food scenarios read the same rows.
 */
export const CATALOG_SEED_NAMES: readonly string[] = [
    'chicken breast',
    'chicken thigh',
    'chicken drumstick',
    'chicken wing',
    'butter',
    'olive oil',
    'egg',
    'milk',
    'wheat flour',
    'granulated sugar',
];

/** How long to wait for the worker, and how often to ask. */
export const CATALOG_DEADLINE_MS = 180_000;
export const CATALOG_POLL_MS = 3_000;

/** Which ids are settled, which are still coming, and which the source refused. */
export interface CatalogProgress {
    readonly resolved: readonly string[];
    readonly pending: readonly string[];
    readonly failed: readonly string[];
}

/**
 * Split a set of items by lifecycle. Pure.
 *
 * ⛔ `UNRESOLVED` counts as FAILED here, and that is deliberate. It means the source returned candidates the
 * service could not pick between — a real outcome for an ambiguous name, and a fine one for a user staring
 * at a disambiguation list, but useless as a fixture: it will never become `RESOLVED` on its own, so waiting
 * for it would burn the whole deadline and then report a timeout instead of the name that was a bad choice.
 */
export function classifyCatalog(items: readonly CatalogItem[]): CatalogProgress {
    const resolved: string[] = [];
    const pending: string[] = [];
    const failed: string[] = [];

    for (const item of items) {
        if (item.status === 'RESOLVED') {
            resolved.push(item.id);
        } else if (item.status === 'PENDING') {
            pending.push(item.id);
        } else {
            failed.push(item.id);
        }
    }

    return { resolved, pending, failed };
}

/** The pieces this needs from the world, injected so the unit tests run instantly and offline. */
export interface CatalogSeedDeps {
    readonly batch: (names: readonly string[]) => Promise<readonly CatalogItem[]>;
    readonly status: (id: string) => Promise<CatalogItem>;
    readonly now: () => number;
    readonly sleep: (ms: number) => Promise<void>;
    readonly deadlineMs?: number;
    readonly pollMs?: number;
    readonly log?: (message: string) => void;
}

/**
 * Ask for every name, then wait until each is settled.
 *
 * ⛔ THROWS on a name the source refused, and on the deadline. Neither is a state a caller can proceed
 * through: a suite that ran against a half-filled catalog would produce failures about search relevance
 * rather than about the one fact that explains them, and this repository has already paid for a tier that
 * reported green over an absent fixture.
 *
 * @sideEffect One batch request, then repeated status polls.
 */
export async function seedFoodCatalog(names: readonly string[], deps: CatalogSeedDeps): Promise<readonly string[]> {
    const deadlineMs = deps.deadlineMs ?? CATALOG_DEADLINE_MS;
    const pollMs = deps.pollMs ?? CATALOG_POLL_MS;
    const log = deps.log ?? ((): void => undefined);
    const started = deps.now();

    const first = classifyCatalog(await deps.batch(names));

    if (first.failed.length > 0) {
        throw new Error(
            `the source refused ${first.failed.length} of ${names.length} names: ${first.failed.join(', ')}`,
        );
    }

    const resolved = new Set(first.resolved);
    let waiting = [...first.pending];

    log(`catalog seed: ${resolved.size} inline, ${waiting.length} pending`);

    while (waiting.length > 0) {
        if (deps.now() - started >= deadlineMs) {
            throw new Error(
                `${waiting.length} of ${names.length} foods were still PENDING after ${deadlineMs}ms. The food ` +
                    'worker fetches from USDA through a Fargate task; the usual causes are the worker not ' +
                    'running on this stage, a missing USDA_API_KEY secret, or the source rate limit.',
            );
        }

        await deps.sleep(pollMs);

        const still: string[] = [];

        for (const id of waiting) {
            const item = await deps.status(id);

            if (item.status === 'RESOLVED') {
                resolved.add(id);
            } else if (item.status === 'PENDING') {
                still.push(id);
            } else {
                throw new Error(
                    `food ${id} settled as ${item.status} — it will never resolve, so the name is a bad fixture`,
                );
            }
        }

        waiting = still;
        log(`catalog seed: ${resolved.size} resolved, ${waiting.length} still pending`);
    }

    return [...resolved];
}
