/**
 * The Matvaretabellen publisher feed (plan U28, KTD-26): the whole English table in one GET of `/api/en/foods.json`.
 * Mattilsynet publishes it as a static file and invites callers to cache it, so one call per sync, under the
 * source's own daily ceiling, is the whole of our load on it.
 *
 * The request goes through the source's {@link RateLimitedFetch}, typed to Matvaretabellen, so it is charged against
 * this source's window and no other. The deadline covers the body as well as the headers, since `fetch` aborts a
 * body read when its signal fires.
 *
 * @pattern Strategy — the publisher origin of the Matvaretabellen mirror feed
 * @module
 */
import { SourceApiError } from '../foodSource.errors.js';
import type { MirrorFeed, MirrorPull } from '../mirror/mirrorFeed.js';
import { apiAccessOf } from '../sourceRegister.js';
import type { RateLimitedFetch } from '../transport/RateLimitedTransport.js';
import { parseMatvaretabellenFoods } from './matvaretabellenFoods.js';

/** The deadline for one pull, headers and body. The 2026-10-01 file is 13.7 MB, 912 KB gzipped. */
export const MATVARETABELLEN_PULL_TIMEOUT_MS = 60_000;

/** The listing's path under the register's base URL. */
const FOODS_PATH = '/en/foods.json';

/** Options for {@link matvaretabellenFeed}. */
export interface MatvaretabellenFeedOptions {
    /** The deadline for one pull; defaults to {@link MATVARETABELLEN_PULL_TIMEOUT_MS}. */
    readonly timeoutMs?: number;
}

/**
 * The publisher feed.
 *
 * @param limitedFetch - Matvaretabellen's rate-limited `fetch`. Named so no call here reads as a bare `fetch`.
 * @param options - The deadline.
 * @returns The feed.
 */
export function matvaretabellenFeed(
    limitedFetch: RateLimitedFetch<'matvaretabellen'>,
    options: MatvaretabellenFeedOptions = {},
): MirrorFeed {
    const timeoutMs = options.timeoutMs ?? MATVARETABELLEN_PULL_TIMEOUT_MS;

    return {
        source: 'matvaretabellen',

        /**
         * @returns Every food the publisher lists.
         * @throws {SourceBusyError} when the source is at its ceiling or blocked; the publisher is not called.
         * @throws {SourceApiError} carrying the status when the publisher answers other than 2xx.
         * @throws {MirrorFeedFormatError} when the body is not the foods document.
         * @throws {DOMException} named `TimeoutError` when the deadline passes.
         * @sideEffect One GET to the publisher, charged against its window.
         */
        async pull(): Promise<MirrorPull> {
            const response = await limitedFetch(`${apiAccessOf('matvaretabellen').baseUrl}${FOODS_PATH}`, {
                signal: AbortSignal.timeout(timeoutMs),
            });

            if (!response.ok) {
                throw new SourceApiError(
                    'matvaretabellen',
                    response.status,
                    `Matvaretabellen answered ${String(response.status)}`,
                );
            }

            return parseMatvaretabellenFoods(await response.text());
        },
    };
}
