import type { Page } from '@playwright/test';
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
 * @param initial - What the fake server holds before the first request.
 * @returns A handle to observe and steer it.
 * @sideEffect Registers a route on the page.
 */
export async function mockSettingsApi(
    page: Page,
    initial: UserSettings = SETTINGS_DEFAULTS,
): Promise<MockedSettingsApi> {
    let held: UserSettings = { ...initial };
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
 * Open `url` and wait until the page has READ the settings and rendered them.
 *
 * ⚠️ Pressing a key straight after a full page load races the read: until it answers, the query shows the published
 * default (shortcut on), so `/` can fire for a cook who turned it off. A spec that asserts "off" must wait for the
 * read first. The two animation frames let the query's update commit, because a response is not yet a render and the
 * listener is attached or removed by an effect.
 *
 * @param page - The page.
 * @param url - Where to go.
 * @sideEffect Navigates the page.
 */
export async function gotoAfterSettingsRead(page: Page, url: string): Promise<void> {
    const read = page.waitForResponse(
        (response) =>
            response.request().method() === 'GET' && new URL(response.url()).pathname.endsWith('/users/me/settings'),
    );

    await page.goto(url);
    await read;
    await page.evaluate(
        () =>
            new Promise<void>((resolve) => {
                requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
            }),
    );
}
