/**
 * The per-user rate limits on food's browser-reachable routes (plan 002 S3, R42), and the one throttler they run on.
 *
 * Food's aggregate lane limiter protects the SOURCE's quota and cannot tell one cook from another. These limits bound
 * what ONE caller can do: a runaway retry loop, a stuck client, a scraper. They are far above a person's real use and
 * far below abuse, because a false positive blocks a cook while a loose-but-bounded limit costs almost nothing. They
 * are not a quota: with N cooks the service still serves N times these numbers.
 *
 * ⚠️ The per-minute counters live in each task's memory, as recipe's do. With N API tasks a caller can reach N times a
 * per-minute limit. They cut a burst before it reaches the database. The bound that holds across tasks is the hourly
 * source budget below, kept in the database.
 *
 * @module
 */
import type { ThrottlerOptions } from '@nestjs/throttler';

/** The window the per-minute limits count over. `@nestjs/throttler` v6 takes milliseconds. */
export const THROTTLE_WINDOW_MS = 60_000;

/**
 * The single registered throttler. Each capped route restates its own limit through its decorator, so no route
 * ever inherits a limit by accident.
 */
export const DEFAULT_THROTTLER_NAME = 'default';

/**
 * The default throttler's own limit in {@link throttlerModuleOptions}, which `ThrottlerModule.forRoot` requires. No
 * route reaches it: no throttler guard is bound globally, and each route that binds one states its own limit through
 * its decorator (`throttle.decorators.ts`).
 */
export const DEFAULT_THROTTLER_LIMIT = 300;

/**
 * Split searches one caller may make per window, on EACH of `GET /api/v1/foods/catalog/search` and
 * `/authored/search` (plan 002 S3, R42): the throttler counts per route.
 *
 * The picker searches as the cook types, once per settled query on both routes. R42 set the figure: no looser than
 * the per-user budget recipe applied to the proxy route these replaced, which plan 002 S6 deleted.
 *
 * ⚠️ The origin counts only what reaches it: a catalog search the edge answers from its cache is never counted.
 */
export const SEARCH_PER_USER_LIMIT = 120;

/**
 * Resolves one caller may make per window (security review C2).
 *
 * A cook resolves an ingredient by picking one candidate, a few a minute while fixing a pasted recipe. The cap stops
 * a runaway client or a scripted caller. It does not protect the source's quota: each resolve calls the source once
 * per pick, and the shared window charges every call before it is made, which is what bounds the quota.
 */
export const RESOLVE_PER_USER_LIMIT = 30;

/**
 * Remote picks one caller may make per window (ADR-0055 point 10). A remote pick is a pick, as a resolve is, so it
 * takes the resolve's bound; each one fetches its item at most once, which the hourly source budget counts.
 */
export const ADOPT_PER_USER_LIMIT = RESOLVE_PER_USER_LIMIT;

/**
 * Source calls one requester may cause per window, across resolve, the remote pick and the remote searches the cache
 * could not answer (plan 002, the hourly cap owed before S6). The owner confirmed the figure on 2026-10-02.
 *
 * Every cook and the worker share one source window: ⌊0.9 × 1,000⌋ = 900 USDA calls an hour (`sourceCeiling.ts`). A
 * heavy session, fixing about ten pasted recipes an hour, is at most about 60 remote searches the cache cannot answer
 * and 30 single-pick resolves: 90 calls. A search the cache answers is never charged (ADR-0055 point 6). 120 leaves
 * that a third of headroom. The window is fixed from a requester's first charge, so across a window
 * boundary one requester can spend 240 calls in one trailing hour, 27% of the shared window; it takes four accounts
 * to empty it. `__tests__/throttle.config.test.ts` holds the arithmetic.
 *
 * Calls are charged before they are made, and the calls a request did not make are refunded when it ends
 * (`requesterSourceBudget.interceptor.ts`), so a resolve of an already-resolved food, a busy source or a request the
 * pipe refuses costs nothing once it has answered.
 */
export const REQUESTER_SOURCE_BUDGET_PER_HOUR = 120;

/** The source budget's window, in seconds: an hour, the window USDA declares. */
export const REQUESTER_SOURCE_BUDGET_WINDOW_SECONDS = 3_600;

/**
 * The wait a caller is told when the budget cannot be read, in seconds. The request is refused as busy (`503`), never
 * admitted uncounted: the same answer, and the same wait, as a resolve whose source window is busy.
 */
export const REQUESTER_SOURCE_BUDGET_RETRY_SECONDS = 30;

/** The `ThrottlerModule.forRoot(…)` registration `FoodsModule` and the mocked integration harness both use. */
export const throttlerModuleOptions: ThrottlerOptions[] = [
    { name: DEFAULT_THROTTLER_NAME, ttl: THROTTLE_WINDOW_MS, limit: DEFAULT_THROTTLER_LIMIT },
];
