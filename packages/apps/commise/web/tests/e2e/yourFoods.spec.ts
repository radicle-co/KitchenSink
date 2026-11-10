import { expect, test } from '@playwright/test';

import { route } from './utils/basePath';
import { signInWithTicket } from './utils/auth';

/**
 * "Your foods" (private foods spec F19 and revision 4): Profile's row carries the count of new staff decisions in its
 * name, and the list shows each of the cook's foods with its status. Food-service is intercepted with the schema
 * package's `ownFoodList` shape. Role/label selectors only. Serial (Clerk-authed).
 *
 * NOT RUN in the session that wrote it (no Playwright runs there).
 */
test.describe('Your foods', () => {
    test('Profile’s row names the new decisions, and opens the list with each food’s status', async ({ page }) => {
        await signInWithTicket(page);
        await page.route('**/api/v1/foods/authored**', (intercepted) =>
            intercepted.request().url().includes('/search')
                ? intercepted.fallback()
                : intercepted.fulfill({
                      json: {
                          items: [
                              {
                                  id: 'food_a',
                                  name: 'E2E Oat milk',
                                  publicationState: 'notApproved',
                                  updatedAt: '2026-11-09T10:00:00.000Z',
                              },
                              {
                                  id: 'food_b',
                                  name: 'E2E Spice mix',
                                  publicationState: 'private',
                                  updatedAt: '2026-11-08T10:00:00.000Z',
                              },
                          ],
                          unseenDecisions: 1,
                      },
                  }),
        );

        await page.goto(route('/profile'));
        await page.getByRole('link', { name: 'Your foods, 1 new decision' }).click();

        await expect(page.getByRole('heading', { name: 'Your foods' })).toBeVisible();
        await expect(page.getByText('E2E Oat milk')).toBeVisible();
        await expect(page.getByText('Not approved')).toBeVisible();
        await expect(page.getByText('E2E Spice mix')).toBeVisible();
    });
});
