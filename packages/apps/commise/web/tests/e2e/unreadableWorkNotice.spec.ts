import { expect, test, type Page } from '@playwright/test';

import { signInWithTicket } from './utils/auth';
import { route } from './utils/basePath';
import { makeRecipeDetail, mockRecipeApi, readViewerAppId } from './utils/recipeApi';
import { openRecipeEditor } from './utils/recipeEditor';

/**
 * The "unreadable work" notice, as only a browser shows it (`specSharedSystem.md` §17; ADR-0057). When the outbox or
 * the editor's draft store holds bytes it cannot read, it sets them aside under a quarantine key and tells the cook
 * ONCE that work on this device could not be opened, with one Dismiss control. A reload with nothing new set aside shows
 * nothing.
 *
 * Bytes are planted in the tab's `sessionStorage` (web's device store, D7) BEFORE the app first reads them, by an init
 * script that plants only once per tab: it leaves a flag behind, so the reload below does not plant again and the
 * second load truly has nothing unreadable to find. The recipe-service contract is intercepted (`utils/recipeApi`);
 * selectors are role and label only (repo policy).
 */

const TITLE = 'Some work on this device couldn’t be opened';
const BODY =
    'We can’t show it or send it, and it can’t be recovered. Recipes saved to your account are safe. Check My recipes for your latest changes.';

/** Bytes no strict parse of either format accepts: valid JSON never ends mid-list. */
const UNREADABLE = '{"formatVersion":1,"records":[';

/** The recipe the editor opens: the draft store is read only for a recipe that exists (a new one has no draft yet). */
const DRAFT_ID = 'ec000000-0000-4000-8000-0000000000d1';

/** The two stores that report through the one notice. Each is read on a different page. */
const STORES = [
    {
        name: 'the outbox',
        storeKey: (subject: string) => `sync.outbox.v1.${subject}`,
        quarantineKey: (subject: string) => `sync.outbox.quarantine.${subject}`,
        open: async (page: Page) => {
            await page.goto(route('/'));
            await expect(page.getByRole('region', { name: 'Home' })).toBeVisible();
        },
    },
    {
        name: 'the editor draft store',
        storeKey: (subject: string) => `editor.draft.v1.${subject}`,
        quarantineKey: (subject: string) => `editor.draft.quarantine.${subject}`,
        open: async (page: Page) => {
            await openRecipeEditor(page, DRAFT_ID);
        },
    },
] as const;

/** The Clerk user id: the subject both stores namespace their keys by. */
async function readClerkSubject(page: Page): Promise<string> {
    await page.waitForFunction(() => {
        const clerk = (window as unknown as { Clerk?: { loaded?: boolean; user?: { id?: string } | null } }).Clerk;

        return clerk?.loaded === true && typeof clerk.user?.id === 'string';
    });

    return page.evaluate(() => (window as unknown as { Clerk: { user: { id: string } } }).Clerk.user.id);
}

/** How many unreadable blobs the quarantine key holds (a JSON list of raw strings, oldest first). */
async function quarantinedCount(page: Page, key: string): Promise<number> {
    return page.evaluate((storageKey) => {
        const raw = window.sessionStorage.getItem(storageKey);

        return raw === null ? 0 : (JSON.parse(raw) as unknown[]).length;
    }, key);
}

for (const store of STORES) {
    test.describe(`the unreadable-work notice — ${store.name}`, () => {
        test('tells the cook once, goes away on Dismiss, and stays quiet on a reload that sets nothing new aside', async ({
            page,
        }) => {
            await signInWithTicket(page);
            const subject = await readClerkSubject(page);
            const viewerId = await readViewerAppId(page);
            await mockRecipeApi(page, {
                viewerId,
                paidFeatures: 'granted',
                recipes: [makeRecipeDetail({ id: DRAFT_ID, ownerId: viewerId, title: 'Green Curry', status: 'draft' })],
            });

            // Plant once per tab. `about:blank` (where `mockRecipeApi` leaves the page) has an opaque origin, so the
            // script guards its own storage access.
            await page.addInitScript(
                ({ storeKey, flag, bytes }) => {
                    try {
                        if (window.sessionStorage.getItem(flag) === null) {
                            window.sessionStorage.setItem(flag, 'planted');
                            window.sessionStorage.setItem(storeKey, bytes);
                        }
                    } catch {
                        // An opaque origin has no storage; the app's own document does.
                    }
                },
                { storeKey: store.storeKey(subject), flag: 'e2e.unreadable.planted', bytes: UNREADABLE },
            );

            await store.open(page);

            // Said once, with the spec copy, and the bytes are safe under the quarantine key rather than dropped.
            const notice = page.getByRole('status').filter({ hasText: TITLE });
            await expect(notice).toHaveCount(1);
            await expect(notice).toContainText(BODY);
            expect(await quarantinedCount(page, store.quarantineKey(subject))).toBe(1);

            await page.getByRole('button', { name: 'Dismiss' }).click();

            await expect(notice).toHaveCount(0);
            await expect(page.getByRole('button', { name: 'Dismiss' })).toHaveCount(0);

            // The reload reads an EMPTY store (the bytes moved to the quarantine), so nothing new is set aside. Waiting
            // for the page to be usable first keeps "no notice" from passing before the app has read anything.
            await page.reload();
            await expect(page.getByRole('main')).toBeVisible();

            await expect(notice).toHaveCount(0);
            expect(await quarantinedCount(page, store.quarantineKey(subject))).toBe(1);
        });
    });
}
