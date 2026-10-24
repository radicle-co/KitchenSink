import type { Page } from '@playwright/test';

/** A running simulated outage, and the switch that ends it. */
export interface Outage {
    /** End the outage: every later request falls through to the routes registered before it. */
    readonly end: () => void;
}

/**
 * Answer every browser request matching `url` with a `503` until the spec calls {@link Outage.end}.
 *
 * ⛔ An outage the SPEC ends, never a countdown. The app retries a `503` query with backoff, so a "fail the
 * first N requests" double would couple the spec to the retry count and heal itself mid-retry, which proves
 * the retry policy rather than the recovery path. Ending it by hand means the load error always renders,
 * and a later success can only come from the viewer's own retry.
 *
 * Registered after `mockRecipeApi` on purpose: Playwright asks the most recently registered route first, and
 * `route.fallback()` hands the request to the mock once the outage is over.
 *
 * @sideEffect Installs a `page.route` handler for the rest of the page's life.
 * @param page - The page whose requests to intercept.
 * @param url - The glob or pattern of the requests to refuse.
 * @returns The running outage.
 */
export async function simulateOutage(page: Page, url: string | RegExp): Promise<Outage> {
    let active = true;

    await page.route(url, async (outageRoute) => {
        if (!active) {
            await outageRoute.fallback();

            return;
        }

        await outageRoute.fulfill({ status: 503, json: { message: 'simulated outage' } });
    });

    return {
        end: () => {
            active = false;
        },
    };
}
