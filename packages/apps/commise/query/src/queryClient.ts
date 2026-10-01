/**
 * The one authoritative `QueryClient` configuration for the Commise apps.
 *
 * Both platforms mounted `new QueryClient()` with no `defaultOptions`, which is how a `404` came to cost a
 * cook ~7s of exponential backoff and the API four requests (see `retryPolicy.ts` for the full account).
 * Fixing that in each root would have produced two copies of one decision agreeing by inspection — the exact
 * drift `@commise/features-account`'s `queries.ts` was written to end for the profile cache's `staleTime`.
 * So the two composition roots ask for a client instead of configuring one.
 *
 * ⛔ THE SSR PREFETCH PAGES ARE DELIBERATELY NOT ON THIS FACTORY. Six App Router pages (`[locale]/recipes/page.tsx`,
 * `recipes/[id]/page.tsx`, `collections/page.tsx`, `discover/page.tsx`, and the `account`/`profile` pages) build a
 * bare `new QueryClient()` for their server-side prefetch, and "finishing the migration" by converting them is a
 * REGRESSION, not a tidy-up: TanStack's retry default is `config.retry ?? (isServer ? 0 : 3)`, and an explicit
 * `retry` would grant three retries with 1s/2s/4s backoff INSIDE an awaited `prefetchQuery` — up to ~7s of added
 * server latency per page on any 5xx.
 *
 * ⛔ AND THE CLIENT THIS FACTORY BUILDS RETRIES NOTHING DURING THE SERVER RENDER PASS. `RecipeProviders` builds it in
 * a `'use client'` component, which Next ALSO renders on the server, so a query read there ran the browser policy:
 * `RecipeAuthNotReadyError` is retryable because Clerk hydrates its session a moment after mount — but Clerk only
 * ever hydrates in a browser, so on the server every one of those retries was guaranteed to fail and each held the
 * HTML stream open behind its backoff. The environment is therefore a construction decision this factory makes:
 * `'server'` restores TanStack's own server default of no retries, `'browser'` applies the policy. It defaults from
 * TanStack's `isServer`, so a composition root still calls it with no argument.
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
import { QueryClient, isServer } from '@tanstack/react-query';

import { retryAfterDelayMs, shouldRetryMutation, shouldRetryQuery } from './retryPolicy.js';

/** Where the client renders: the Next server pass, or a browser / React Native runtime. */
export type QueryClientEnvironment = 'server' | 'browser';

/**
 * Build the app's `QueryClient`.
 *
 * @param environment - Where it renders; defaults from TanStack's `isServer`, which is what a composition root wants.
 * @sideEffect Allocates a query cache. Call it ONCE per app, from the composition root, inside a
 *   `useState` initialiser — a client rebuilt on a render pass silently discards every cached query.
 * @returns A fresh client carrying the shared retry policy for its environment.
 */
export function createAppQueryClient(
    environment: QueryClientEnvironment = isServer ? 'server' : 'browser',
): QueryClient {
    return new QueryClient({
        defaultOptions: {
            queries: {
                retry: environment === 'server' ? 0 : shouldRetryQuery,
                // ⛔ `offlineFirst` BUYS EXACTLY ONE THING: THE FIRST ATTEMPT FIRES. It does NOT make an
                // offline read reach an error state, and an earlier version of this comment claimed it did.
                // Measured against the pinned `query-core`, offline, through a real observer:
                //
                //     mode + retry                | calls | status  | fetchStatus
                //     'online'       + shouldRetry|     0 | pending | paused
                //     'offlineFirst' + shouldRetry|     1 | pending | paused   ← this config
                //     'always'       + shouldRetry|     4 | error   | idle
                //
                // Because this factory also sets `retry`, the first attempt fails, sleeps, and then
                // `retryer.js:100` (`canContinue() ? void 0 : pause()`, and `canContinue` at `:51` requires
                // `onlineManager.isOnline()`) parks it. So a genuine outage still ends at `paused`.
                //
                // ⚠️ WHAT IT DOES CLOSE is the case this defect is most often REACHED through:
                // `mobile/src/query/connectivity.ts` drives `onlineManager` from NetInfo and treats a NULLISH
                // `isConnected` as offline — "fail safe", right for writes — so a device that is merely
                // UNSURE marked every uncached read unrunnable. Under `'online'` that read never fired at
                // all; now it fires and, on a device that is actually connected, succeeds.
                //
                // ⚠️ STATED DEFERRAL, NOT A FIX: `fetchStatus: 'paused'` has no owner in this codebase.
                // `QueryBoundary` models pending/failed/settled and `paused` collapses into pending, so on a
                // real outage an uncached surface still renders its loading state indefinitely. No
                // `networkMode` value can supply that owner — the choice is whether `paused` becomes a
                // fourth `QueryBoundary` branch or the retry predicate becomes connectivity-aware (which
                // would cost `retryPolicy.ts` its stated purity). `'always'` is NOT the answer: it burns the
                // full backoff while provably offline and forfeits the pause-and-resume-on-reconnect that
                // `connectivity.ts` exists for. Pinned by `queryClient.test.ts`'s offline probe, which
                // asserts BOTH halves — the attempt that now happens and the pause that still does.
                //
                // ⚠️ Mutations deliberately stay at `'online'`: a paused WRITE that resumes on reconnect is
                // the intended behaviour, and `connectivity.ts`'s docstring already states it. The asymmetry
                // is the decision, not an oversight.
                networkMode: 'offlineFirst',
            },
            // ⛔ MUTATIONS RETRY TOO, BUT ONLY WHERE REPLAY CANNOT DUPLICATE A WRITE. TanStack's default is
            // never — correct for a `502` or a dropped socket, which can arrive AFTER the row was written —
            // and `shouldRetryMutation` keeps that for every class except the ones the server refuses
            // without processing. Without this a throttled write failed at the user rather than waiting.
            mutations: {
                retry: shouldRetryMutation,
                retryDelay: retryAfterDelayMs,
            },
        },
    });
}
