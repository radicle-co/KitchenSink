import type { Frame, Page, Request } from '@playwright/test';
import { patchUserSettingsRequestSchema, SETTINGS_DEFAULTS, type UserSettings } from '@kitchensink/schema-identity';

/** What {@link mockSettingsApi} lets a spec observe and steer. */
export interface MockedSettingsApi {
    /** The settings the fake server holds right now. */
    readonly current: () => UserSettings;
    /** The `PATCH` bodies the page sent, in order. */
    readonly patches: readonly unknown[];
    /**
     * Make `PATCH`es fail with `status` (or stop failing them, with `undefined`).
     *
     * ⚠️ Use a `4xx`. The app's mutation retry policy replays a `5xx` with backoff (`@commise/query`), so a `503` shows
     * its failure message only after several seconds. A `403` is what the real service answers for a closed account.
     */
    readonly failWrites: (status: number | undefined) => void;
}

/**
 * Stand in for the identity service's `GET`/`PATCH /api/v1/users/me/settings` at the network edge (ADR-0059).
 *
 * A small STATEFUL fake rather than a canned body, because the behaviour under test is that a choice persists: the
 * `PATCH` is validated against the service's own published request schema, merged into what the "server" holds, and
 * answered resolved, so a reload reads it back. A write the real service would refuse (an unknown key) is a `400` here
 * too.
 *
 * ⚠️ Register it AFTER `mockRecipeApi`: Playwright runs the most recently registered matching route first, and
 * `mockRecipeApi` owns the whole `/api/v1/` space.
 *
 * @param page - The page to intercept.
 * @param initial - The settings the fake server holds before the first request; any left out are the published defaults.
 * @returns A handle to observe and steer it.
 * @sideEffect Registers a route on the page.
 */
export async function mockSettingsApi(page: Page, initial: Partial<UserSettings> = {}): Promise<MockedSettingsApi> {
    let held: UserSettings = { ...SETTINGS_DEFAULTS, ...initial };
    let failingWith: number | undefined;
    const patches: unknown[] = [];

    await page.route('**/api/v1/users/me/settings', async (route) => {
        const request = route.request();

        if (request.method() === 'GET') {
            return route.fulfill({ json: held });
        }

        if (request.method() !== 'PATCH') {
            return route.fulfill({ status: 405, json: { code: 'METHOD_NOT_ALLOWED', message: 'Not allowed.' } });
        }

        const body: unknown = request.postDataJSON();

        patches.push(body);

        if (failingWith !== undefined) {
            return route.fulfill({ status: failingWith, json: { code: 'FORBIDDEN', message: 'Account is closed' } });
        }

        const parsed = patchUserSettingsRequestSchema.safeParse(body);

        if (!parsed.success) {
            return route.fulfill({ status: 400, json: { code: 'BAD_REQUEST', message: 'Validation failed' } });
        }

        held = { ...held, ...parsed.data };

        return route.fulfill({ json: held });
    });

    return {
        current: () => held,
        patches,
        failWrites: (status) => {
            failingWith = status;
        },
    };
}

/**
 * Open `url` and wait until the NEW page has read the settings and rendered them.
 *
 * ⚠️ Pressing a key straight after a full page load races the read: until it answers, the query holds the published
 * default as a placeholder and `useSearchShortcut` keeps `/` OFF, so a spec that expects `/` to work must wait for the
 * read first.
 *
 * ⛔ The read waited on is one the NEW document issued, not any settings `GET`. Leaving Profile straight after the switch
 * leaves the save's settle-refetch (`onSettled` invalidates the settings) in flight on the OLD page, and it answers
 * before the new document has even committed. Matching it ended the wait while the new page's own read was still
 * pending, and `/` was pressed with no listener (`profileSettings.spec.ts` "turns / back on", red in CI; a local trace
 * of the failure shows the Profile refetch answering, then the Recipes read starting seconds later). Playwright reports events in protocol
 * order, and the new document can issue no request before it commits, so the wait counts only requests seen after the
 * main frame next navigates. ⚠️ That event also fires for a same-document URL change, so an old page that changed its
 * own URL during the `goto` would count too; no caller's page does.
 *
 * The two animation frames let the query's update commit, because a response is not yet a render and the listener is
 * attached or removed by an effect.
 *
 * @param page - The page.
 * @param url - Where to go.
 * @sideEffect Navigates the page.
 */
export async function gotoAfterSettingsRead(page: Page, url: string): Promise<void> {
    const fromNewDocument = new Set<Request>();
    let committed = false;

    const onNavigated = (frame: Frame): void => {
        if (frame === page.mainFrame()) {
            committed = true;
        }
    };

    const onRequest = (request: Request): void => {
        if (committed) {
            fromNewDocument.add(request);
        }
    };

    page.on('framenavigated', onNavigated);
    page.on('request', onRequest);

    try {
        const read = page.waitForResponse(
            (response) =>
                fromNewDocument.has(response.request()) &&
                response.request().method() === 'GET' &&
                new URL(response.url()).pathname.endsWith('/users/me/settings'),
        );

        await page.goto(url);
        await read;
    } finally {
        page.off('framenavigated', onNavigated);
        page.off('request', onRequest);
    }

    await page.evaluate(
        () =>
            new Promise<void>((resolve) => {
                requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
            }),
    );
}
