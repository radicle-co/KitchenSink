/**
 * The one authoritative `QueryClient` configuration for the Commise apps.
 *
 * Both platforms mounted `new QueryClient()` with no `defaultOptions`, which is how a `404` came to cost a
 * cook ~7s of exponential backoff and the API four requests (see `retryPolicy.ts` for the full account).
 * Fixing that in each root would have produced two copies of one decision agreeing by inspection — the exact
 * drift `@commise/features-account`'s `queries.ts` was written to end for the profile cache's `staleTime`.
 * So the two composition roots ask for a client instead of configuring one.
 *
 * ⛔ THIS IS THE BROWSER CLIENT, AND THE SSR PREFETCH PAGES ARE DELIBERATELY NOT ON IT. Six App Router pages
 * (`[locale]/recipes/page.tsx`, `recipes/[id]/page.tsx`, `collections/page.tsx`, `discover/page.tsx`, and the
 * `account`/`profile` pages) still build a bare `new QueryClient()` for their server-side prefetch, and
 * "finishing the migration" by converting them is a REGRESSION, not a tidy-up. TanStack's retry default is
 * `config.retry ?? (isServer ? 0 : 3)`, so a server render currently retries NOTHING. Setting `retry`
 * explicitly overrides that `0`, which would grant three retries with 1s/2s/4s backoff INSIDE an awaited
 * `prefetchQuery` during a server render — up to ~7s of added server latency per page on any 5xx, which is
 * worse than the defect this module fixes. If a server-side policy is ever wanted it needs its own factory
 * and its own reasoning about the request's deadline, not this one.
 *
 * ⛔ MUTATIONS ARE LEFT AT TANSTACK'S DEFAULT OF NO RETRY, deliberately, and that is a decision rather than
 * an omission. Replaying a non-idempotent write without an idempotency key is a worse failure than the one
 * this policy fixes, and `hooks.ts`'s live-ingredient-search mutation already records the concrete case: a
 * retry there would double the quota cost of exactly the refusal (`SourceBusyError`) that means the quota is
 * spent. Do not "complete" the config by adding a mutation retry.
 *
 * ⚠️ NO JITTER YET, and that is a deferral rather than a decision.
 * `docs/engineering/ENGINEERING_EXCELLENCE.md` asks for "exponential backoff with full jitter", and
 * TanStack's default `retryDelay` (`min(1000 * 2**n, 30000)`) has none — so on a deploy, a restart or a 5xx
 * incident every mounted client retries in lockstep at +1s/+2s/+4s. That herd is real here rather than
 * theoretical: non-prod runs ONE Fargate task per service (ADR-0008's Spot, ADR-0010's single per-PR API
 * task), so the recovering task takes the whole burst. It is deferred because it changes timing for every
 * query in both apps and is not the defect being fixed — a separable change with its own measurement. This
 * note IS the tracking: the specs that used to carry this defect pointed at a task that never owned it, and
 * an untracked deferral is how that happens.
 *
 * @pattern Factory — hides a construction DECISION (the shared defaults + the retry policy) rather than
 *     wrapping `new`; a caller mounts a configured cache without learning what configures it.
 */
import { QueryClient } from '@tanstack/react-query';

import { shouldRetryQuery } from './retryPolicy.js';

/**
 * Build the app's `QueryClient`.
 *
 * @sideEffect Allocates a query cache. Call it ONCE per app, from the composition root, inside a
 *   `useState` initialiser — a client rebuilt on a render pass silently discards every cached query.
 * @returns A fresh client carrying the shared retry policy.
 */
export function createAppQueryClient(): QueryClient {
    return new QueryClient({
        defaultOptions: {
            queries: {
                retry: shouldRetryQuery,
            },
        },
    });
}
