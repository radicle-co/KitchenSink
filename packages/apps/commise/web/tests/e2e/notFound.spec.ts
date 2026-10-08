import { expect, test } from '@playwright/test';

import { isHome, pathnameOf, route } from './utils/basePath';
import { signInWithTicket } from './utils/auth';

/**
 * The app's own 404 page, for a signed-in viewer (E2, `docs/design/uiOverhaul/evaluateShellAndLists.md`; spec
 * `specShellAndLists.md` §N).
 *
 * Unknown URLs got Next's bare built-in page — no app styles, no brand, no way home — because a segment's
 * `not-found.tsx` only catches a `notFound()` thrown beneath it, never an unmatched URL. A catch-all route under
 * `[locale]` now throws it, so the app's page renders, inside the shell. Each case asserts the page's `h1`, the app
 * navigation, that the way home works, and that the page tells crawlers not to index it. The STATUS is not asserted:
 * `[locale]/loading.tsx` makes the production server stream, so Next answers a streamed `notFound()` with 200 plus a
 * `noindex` robots tag, while `next dev` answers 404 — see `src/app/[locale]/[...rest]/page.tsx`. The signed-out case
 * lives in `routeProtection.spec.ts`, which owns the anonymous session.
 *
 * Selectors are role/label only (repo policy); no `data-testid`, no `waitForTimeout`.
 */

const TITLE = 'We couldn’t find that page.';

for (const path of ['/this-page-does-not-exist', '/recipes/rec_seed/typo']) {
    test(`${path} is a 404 inside the app shell, with a way home`, async ({ page }) => {
        await signInWithTicket(page);

        await page.goto(route(path));

        await expect(page.getByRole('heading', { level: 1, name: TITLE })).toBeVisible();
        await expect(page.locator('meta[name="robots"][content="noindex"]')).toHaveCount(1);
        await expect(page.getByRole('navigation').first()).toBeVisible();

        await page.getByRole('link', { name: 'Back to Home' }).click();
        await expect.poll(() => isHome(pathnameOf(page))).toBe(true);
    });
}
