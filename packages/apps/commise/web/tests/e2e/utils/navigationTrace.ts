/**
 * Navigation-settling utilities for the e2e suite — the missing half of every "redirects to sign-in"
 * assertion in this repo.
 *
 * ## The failure this exists to catch (production, 2026-08-07)
 *
 * `commise.app/en` bounced forever between `/en` and `/en/sign-in?redirect_url=%2Fen`. Every test passed.
 * `tests/e2e/routeProtection.spec.ts` asserted the outcome like this:
 *
 *     await expect.poll(() => isRoute(pathnameOf(page), '/sign-in')).toBe(true);
 *
 * `expect.poll` resolves on the FIRST sample where the predicate holds. In an infinite bounce that happens on
 * roughly every other sample, so the assertion was satisfied *by the loop*. The one content assertion
 * (`expect(page.getByRole('textbox', { name: /email/i })).toBeVisible()`) is also a retrying check, and the
 * loop genuinely renders that field on every visit to `/{locale}/sign-in` — so it too passed. Nothing in the
 * suite counted navigations, waited for the URL to stop changing, or bounded a redirect chain.
 *
 * A momentary URL sample is not a destination. These helpers assert the *settled* state instead.
 *
 * ## Why the settle detector polls for STABILITY rather than sleeping
 *
 * `page.waitForTimeout()` is banned (CLAUDE.md / CODING_STANDARDS), and rightly — a fixed sleep is both flaky
 * and slow. So {@link waitForNavigationTraceToSettle} polls the trace LENGTH and requires it to be unchanged
 * for several consecutive samples. A settled page reaches that in a few hundred milliseconds; a looping page
 * never does, and the poll's own timeout is the failure. The condition is the inverse of the one that made
 * the original assertions loop-blind: it cannot be satisfied by a lucky sample.
 */
import type { Page } from '@playwright/test';

/** A growing record of main-frame navigations, in order. */
export interface NavigationTrace {
    readonly urls: readonly string[];
}

export interface NavigationVerdict {
    readonly settled: boolean;
    readonly findings: readonly string[];
}

/**
 * The most times one pathname may legitimately appear in a trace.
 *
 * Next's App Router plus Clerk's client bootstrap re-navigate to the same URL as part of normal startup — the
 * healthy production trace captured on 2026-08-07 was `/en`, `/en`, `/en/sign-in`, `/en/sign-in`, i.e. every
 * pathname exactly twice. Three or more visits is not startup noise.
 */
const MAX_VISITS_PER_PATHNAME = 2;

/**
 * Start recording main-frame navigations for a page.
 *
 * Attach this BEFORE `page.goto`, or the first hops are lost. Sub-frame navigations are ignored: only the
 * main frame can express a redirect loop.
 *
 * @param page - The page to observe.
 * @returns A live trace whose `urls` grows as the page navigates.
 * @sideEffect Registers a `framenavigated` listener on `page`.
 */
export function trackMainFrameNavigations(page: Page): NavigationTrace {
    const urls: string[] = [];

    page.on('framenavigated', (frame) => {
        if (frame === page.mainFrame()) {
            urls.push(frame.url());
        }
    });

    return { urls };
}

/**
 * Judge a completed navigation trace. Pure.
 *
 * @param input - The recorded URLs, the pathname the page is expected to have come to rest on, and the total
 *   navigation budget for the interaction.
 * @returns Whether the trace settled where it should have, with a finding per violation.
 */
export function classifyNavigationTrace(input: {
    readonly urls: readonly string[];
    readonly expectedFinalPathname: string;
    readonly maxNavigations: number;
}): NavigationVerdict {
    const { urls, expectedFinalPathname, maxNavigations } = input;
    const findings: string[] = [];

    if (urls.length === 0) {
        return { settled: false, findings: ['no main-frame navigation was recorded — the page never loaded'] };
    }

    if (urls.length > maxNavigations) {
        findings.push(
            `${urls.length} main-frame navigations exceeds the budget of ${maxNavigations} — the page is bouncing:\n  ` +
                urls.join('\n  '),
        );
    }

    const visits = new Map<string, number>();

    for (const url of urls) {
        const pathname = new URL(url).pathname;
        const count = (visits.get(pathname) ?? 0) + 1;

        visits.set(pathname, count);

        if (count > MAX_VISITS_PER_PATHNAME) {
            findings.push(`navigation LOOP: ${pathname} was visited ${count} times:\n  ${urls.join('\n  ')}`);
            break;
        }
    }

    const finalPathname = new URL(urls[urls.length - 1] as string).pathname;

    if (finalPathname !== expectedFinalPathname && finalPathname !== `${expectedFinalPathname}/`) {
        findings.push(`came to rest on ${finalPathname}, expected ${expectedFinalPathname}`);
    }

    return { settled: findings.length === 0, findings };
}

/**
 * Wait until the page STOPS navigating, then return the trace.
 *
 * Polls the trace length and requires it unchanged across `stableSamples` consecutive reads. A looping page
 * never reaches that, so this rejects — which is the whole point: the failure mode is a timeout, not a lucky
 * sample.
 *
 * @param trace - A trace from {@link trackMainFrameNavigations}.
 * @param options - `stableSamples` consecutive unchanged reads required; `intervalMs` between reads;
 *   `timeoutMs` overall budget.
 * @returns The recorded URLs once navigation has settled.
 * @throws When the page is still navigating after `timeoutMs`.
 * @sideEffect Waits on wall-clock time while sampling the trace.
 */
export async function waitForNavigationTraceToSettle(
    trace: NavigationTrace,
    options: { stableSamples?: number; intervalMs?: number; timeoutMs?: number } = {},
): Promise<readonly string[]> {
    const stableSamples = options.stableSamples ?? 5;
    const intervalMs = options.intervalMs ?? 400;
    const timeoutMs = options.timeoutMs ?? 20_000;

    const deadline = Date.now() + timeoutMs;
    let lastLength = -1;
    let stable = 0;

    while (Date.now() < deadline) {
        await new Promise((resolve) => {
            setTimeout(resolve, intervalMs);
        });

        if (trace.urls.length === lastLength) {
            stable += 1;

            if (stable >= stableSamples) {
                return [...trace.urls];
            }
        } else {
            lastLength = trace.urls.length;
            stable = 0;
        }
    }

    throw new Error(
        `the page never stopped navigating within ${timeoutMs}ms (${trace.urls.length} navigations so far):\n  ` +
            trace.urls.join('\n  '),
    );
}
