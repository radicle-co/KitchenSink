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
    // ⛔ THREE BREAST VARIANTS, not four different cuts, and the difference is load-bearing. Food's search
    // runs `plainto_tsquery`, which ANDs its lexemes: a query of `chicken breast` becomes
    // `'chicken' & 'breast'`, so `Chicken, broilers or fryers, THIGH…` does not match on the full-text
    // branch however much it shares a first word. Only rows whose USDA name carries BOTH lexemes reliably
    // come back, so the probe needs siblings of ITSELF rather than of its head term.
    'chicken breast',
    'chicken breast roasted',
    'chicken breast grilled',
    // Kept for head-term diversity, and because a cut that is not the probe is what proves the search is
    // discriminating rather than returning everything.
    'chicken thigh',
    'butter',
    'olive oil',
    // ⚠️ `egg` alone came back UNRESOLVED from a live run — USDA offered candidates the service could not
    // pick between. Specific enough to settle, and the rejection path is exercised whether or not it does.
    'whole egg',
    'milk',
    'wheat flour',
    'granulated sugar',
];

/** How long to wait for the worker, and how often to ask. */
export const CATALOG_DEADLINE_MS = 180_000;
export const CATALOG_POLL_MS = 3_000;

/** A name, the row it became, and where that row ended up. */
export interface CatalogEntry {
    readonly name: string;
    readonly id: string;
    readonly status: CatalogItemStatus;
}

/** What a seeding run produced. */
export interface CatalogOutcome {
    /** Names that reached `RESOLVED` — the only ones a catalog search can return. */
    readonly resolved: readonly CatalogEntry[];
    /** Names that settled anywhere else. Reported, never silently dropped. */
    readonly rejected: readonly CatalogEntry[];
}

/** Which ids are settled, which are still coming, and which will never settle. */
export interface CatalogProgress {
    readonly resolved: readonly string[];
    readonly pending: readonly string[];
    readonly failed: readonly string[];
}

/**
 * Split a set of items by lifecycle. Pure.
 *
 * `UNRESOLVED` is grouped with the terminal failures rather than with `PENDING`: the source returned
 * candidates nothing could pick between, and no amount of waiting changes that. It is NOT fatal — see
 * {@link seedFoodCatalog} — but it must never be waited on.
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

/** One candidate the service offered for an ambiguous name. */
export interface CatalogCandidate {
    readonly candidateId: string;
    readonly name: string;
}

/**
 * Which candidate to pick for an ambiguous food. Pure.
 *
 * ⛔ THE SERVICE'S OWN FIRST, never a choice of ours. `UNRESOLVED` is not a failure — it is the food
 * service working as designed: USDA returned several rows and the service declines to guess, deferring to
 * the disambiguation flow a user would see. Measured on a live preview, SEVEN of ten ordinary names came
 * back that way, `butter` and `wheat flour` among them, so a seed that waits for auto-resolution seeds
 * almost nothing.
 *
 * Taking the first entry the service returns is not inventing data: every candidate is a real USDA food
 * from that food's own set, and the pick is validated against it server-side. It is not necessarily the
 * BEST one — `candidateViewSchema` publishes no rank — and for a fixture whose purpose is "a searchable
 * row carrying macros" that distinction does not matter. It would matter for a nutrition ASSERTION about
 * a specific food, and no suite makes one.
 */
export function pickCandidate(candidates: readonly CatalogCandidate[]): string | undefined {
    return candidates[0]?.candidateId;
}

/**
 * The floor a seeded catalog must clear to be worth running a suite against.
 *
 * ⚠️ NOT "every name resolved". Whether a given name is ambiguous is a fact about USDA's data, not about
 * this repository — `egg` came back `UNRESOLVED` on the first live run because the source offered
 * candidates the service could not pick between, and failing the whole seed on that makes a third party's
 * catalogue a build dependency. What matters is whether the catalog can answer the questions the suite
 * asks, and that is exactly what these two numbers state.
 */
export const MIN_RESOLVED_FOODS = 5;

/**
 * Names whose FIRST WORD they share — the proxy for a shared USDA head term.
 *
 * The linkage suite re-searches on a result's own head term (`name.split(',')[0]`) and requires more than
 * one hit. A USDA merge-winner name is `Chicken, broilers or fryers, breast…`, so two of our own
 * `chicken …` names resolving is what makes that satisfiable. Pure.
 */
export function sharedHeadTermCount(entries: readonly CatalogEntry[]): number {
    const byHead = new Map<string, number>();

    for (const entry of entries) {
        const head = entry.name.split(' ')[0]?.toLowerCase() ?? '';
        byHead.set(head, (byHead.get(head) ?? 0) + 1);
    }

    return Math.max(0, ...byHead.values());
}

/**
 * The query a seeded catalog must be able to answer with MORE THAN ONE row.
 *
 * ⛔ It is the literal string `recipeFoodLinkage.e2e.test.ts` searches for, and the coupling is deliberate.
 * "Usable" is not an abstract property — it is precisely "the search the suite will issue returns enough
 * rows", and food's search ANDs its lexemes (`plainto_tsquery`) with a trigram branch beside it, so
 * whether four `chicken …` names all match `chicken breast` is a question about the data USDA returned
 * rather than about the names we asked for. Guessing costs a ten-minute round trip; asking costs one HTTP
 * call at the end of the seed.
 */
export const CATALOG_PROBE_QUERY = 'chicken breast';

/** How many rows that probe must return — the suite asserts strictly more than one. */
export const MIN_PROBE_RESULTS = 2;

/**
 * Why the seeded catalog cannot answer the probe, if it cannot. Empty means it can. Pure.
 *
 * Separate from {@link findCatalogShortfalls} because it needs an answer from the SERVICE, and keeping the
 * judgement pure is what lets the caller decide when to pay for that call.
 */
export function findProbeShortfall(query: string, resultCount: number): readonly string[] {
    if (resultCount >= MIN_PROBE_RESULTS) {
        return [];
    }

    return [
        `searching the seeded catalog for "${query}" returned ${resultCount} row(s); the linkage suite ` +
            `requires more than one. Food's search ANDs its lexemes, so names that merely share a first ` +
            `word may not match — seed more variants of the probe itself.`,
    ];
}

/**
 * Why a seeded catalog is not usable, if it is not. Empty means it is. Pure.
 *
 * ⛔ This is the postcondition, and it replaces "every name must resolve". A suite run against a catalog
 * that quietly came up short fails about search relevance instead of about the one fact that explains it —
 * so the check has to be here, stated as what the suite needs rather than as what the source happened to
 * return.
 */
export function findCatalogShortfalls(outcome: CatalogOutcome): readonly string[] {
    const violations: string[] = [];

    if (outcome.resolved.length < MIN_RESOLVED_FOODS) {
        violations.push(
            `only ${outcome.resolved.length} of ${outcome.resolved.length + outcome.rejected.length} foods ` +
                `RESOLVED; at least ${MIN_RESOLVED_FOODS} are needed for a catalog worth searching`,
        );
    }

    if (sharedHeadTermCount(outcome.resolved) < 2) {
        violations.push(
            "no two resolved foods share a head term — the linkage suite re-searches on a result's own " +
                'head term and requires more than one hit, so a catalog without a pair cannot satisfy it',
        );
    }

    return violations;
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
    /** The disambiguation half — omit to skip it (the unit tests that are not about it do). */
    readonly candidates?: (id: string) => Promise<readonly CatalogCandidate[]>;
    readonly resolve?: (id: string, candidateId: string) => Promise<void>;
}

/**
 * Ask for every name, then wait until each is settled, and report what each one became.
 *
 * ⛔ It THROWS only on the DEADLINE. A name the source settled as `UNRESOLVED`/`NOT_FOUND`/`FAILED` is
 * reported, not fatal: whether a name is ambiguous is a fact about USDA's data rather than about this
 * repository, and failing a whole seed on it makes a third party's catalogue a build dependency. Whether
 * what DID resolve is enough is a separate question, asked by {@link findCatalogShortfalls}, because it is
 * a question about the suite's needs and not about the source's answers.
 *
 * ⚠️ The name is carried through so a failure names the FIXTURE rather than an opaque id. The first live
 * run reported `food 01M1T9…7 settled as UNRESOLVED`, which said nothing about which of ten names to fix.
 * Items come back in request order (`FoodsService.batchAdd` pushes over its dedup Map, whose iteration is
 * insertion-ordered), and the seeded names are unique, so zipping is sound.
 *
 * @sideEffect One batch request, then repeated status polls.
 */
export async function seedFoodCatalog(names: readonly string[], deps: CatalogSeedDeps): Promise<CatalogOutcome> {
    const deadlineMs = deps.deadlineMs ?? CATALOG_DEADLINE_MS;
    const pollMs = deps.pollMs ?? CATALOG_POLL_MS;
    const log = deps.log ?? ((): void => undefined);
    const started = deps.now();

    const items = await deps.batch(names);
    const nameOf = new Map(items.map((item, index) => [item.id, names[index] ?? item.id]));
    const settled = new Map<string, CatalogItemStatus>();
    let waiting: string[] = [];

    for (const item of items) {
        if (item.status === 'PENDING') {
            waiting.push(item.id);
        } else {
            settled.set(item.id, item.status);
        }
    }

    log(`catalog seed: ${settled.size} settled inline, ${waiting.length} pending`);

    while (waiting.length > 0) {
        if (deps.now() - started >= deadlineMs) {
            const stuck = waiting.map((id) => nameOf.get(id) ?? id);

            throw new Error(
                `${waiting.length} of ${names.length} foods were still PENDING after ${deadlineMs}ms ` +
                    `(${stuck.join(', ')}). The food worker fetches from USDA through a Fargate task; the ` +
                    'usual causes are the worker not running on this stage, a missing USDA_API_KEY secret, ' +
                    'or the source rate limit.',
            );
        }

        await deps.sleep(pollMs);

        const still: string[] = [];

        for (const id of waiting) {
            const item = await deps.status(id);

            if (item.status === 'PENDING') {
                still.push(id);
            } else {
                settled.set(id, item.status);
            }
        }

        waiting = still;
        log(`catalog seed: ${settled.size} settled, ${waiting.length} still pending`);
    }

    const entries = [...settled].map(([id, status]) => ({ id, status, name: nameOf.get(id) ?? id }));
    const disambiguated = await disambiguate(entries, deps, log);

    return {
        resolved: disambiguated.filter((entry) => entry.status === 'RESOLVED'),
        rejected: disambiguated.filter((entry) => entry.status !== 'RESOLVED'),
    };
}

/**
 * Walk the disambiguation flow for every `UNRESOLVED` food, exactly as a user's client would.
 *
 * ⛔ This is the step that makes the seed work at all. Without it a live preview resolved 3 of 10 names.
 *
 * Failures here are per-food and non-fatal: a food with an empty candidate set, or a `PATCH` the service
 * refuses, leaves that name unresolved and reported. Whether what remains is enough is the postcondition's
 * question, not this function's.
 *
 * @sideEffect One candidates read and one resolve write per ambiguous food.
 */
async function disambiguate(
    entries: readonly CatalogEntry[],
    deps: CatalogSeedDeps,
    log: (message: string) => void,
): Promise<readonly CatalogEntry[]> {
    if (deps.candidates === undefined || deps.resolve === undefined) {
        return entries;
    }

    const settled: CatalogEntry[] = [];

    for (const entry of entries) {
        if (entry.status !== 'UNRESOLVED') {
            settled.push(entry);
            continue;
        }

        try {
            const pick = pickCandidate(await deps.candidates(entry.id));

            if (pick === undefined) {
                log(`catalog seed: "${entry.name}" is UNRESOLVED and offered no candidates`);
                settled.push(entry);
                continue;
            }

            await deps.resolve(entry.id, pick);
            log(`catalog seed: "${entry.name}" disambiguated to candidate ${pick}`);
            settled.push({ ...entry, status: 'RESOLVED' });
        } catch (error) {
            log(`catalog seed: could not disambiguate "${entry.name}": ${String(error)}`);
            settled.push(entry);
        }
    }

    return settled;
}
