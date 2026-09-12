/**
 * The per-user rate limits on food's browser-reachable routes (plan 002 S3, R42), and the one throttler they run on.
 *
 * Food's aggregate lane limiter protects the SOURCE's quota and cannot tell one cook from another. These limits bound
 * what ONE caller can do: a runaway retry loop, a stuck client, a scraper. They are far above a person's real use and
 * far below abuse, because a false positive blocks a cook while a loose-but-bounded limit costs almost nothing. They
 * are not a quota: with N cooks the service still serves N times these numbers.
 *
 * ⚠️ The counters live in each task's memory, as recipe's do. With N API tasks a caller can reach N times a limit.
 *
 * @module
 */
import type { ThrottlerOptions } from '@nestjs/throttler';

/** The window every limit here counts over. `@nestjs/throttler` v6 takes milliseconds. */
export const THROTTLE_WINDOW_MS = 60_000;

/**
 * The single registered throttler. Each capped route restates its own limit through its decorator, so no route
 * ever inherits a limit by accident.
 */
export const DEFAULT_THROTTLER_NAME = 'default';

/**
 * Live source searches one caller may make per window.
 *
 * A cook presses a button for each one (the route is never a typeahead), so a real peak is a handful a minute while
 * fixing a pasted recipe. R42 sets the bar from the other side: no looser than the per-user budget the recipe service
 * applies to the proxy route this one replaces (`@WriteRateLimit`, whose default is `RATE_LIMIT_WRITE` in its
 * `throttleDefaults.ts`). `packages/infra/global/__tests__/liveSearchCapParity.test.ts` holds that line until S6
 * deletes the recipe route; from then on this is the only per-user cap on the path.
 */
export const LIVE_SEARCH_PER_USER_LIMIT = 300;

/** The `ThrottlerModule.forRoot(…)` registration `FoodsModule` and the mocked integration harness both use. */
export const throttlerModuleOptions: ThrottlerOptions[] = [
    { name: DEFAULT_THROTTLER_NAME, ttl: THROTTLE_WINDOW_MS, limit: LIVE_SEARCH_PER_USER_LIMIT },
];
