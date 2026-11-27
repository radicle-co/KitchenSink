import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { AXE_TAGS } from '@commise/ui/testing/axe-tags';

import { route } from './utils/basePath';
import { makeCollection, makeRecipeDetail, mockRecipeApi, readViewerAppId } from './utils/recipeApi';
import { signInWithTicket } from './utils/auth';

/**
 * Automated accessibility check of the pages people use most, in a real browser: home, a recipe and the collections
 * list. Every page must show no WCAG 2.1 A or AA violation, colour contrast included (jsdom cannot judge it, so the
 * component tier turns it off and this spec owns it).
 *
 * Rules that already fail on a page are listed in {@link KNOWN}, one entry per rule per page, each with the issue that
 * tracks the fix. The list can only shrink: a new violation anywhere fails the spec, and an entry whose rule no longer
 * fails fails it too, so a fixed page cannot keep its exemption.
 *
 * Known limit: an entry names a rule, not an element, so a second element that breaks the same rule on the same page
 * passes. Narrow the entry to the element when a page has more than one.
 */

/** A rule that fails today on one page: the rule id, the page's path, and the issue that tracks the fix. */
interface KnownViolation {
    readonly page: PagePath;
    readonly rule: string;
    readonly issue: number;
}

const KNOWN: readonly KnownViolation[] = [
    { page: '/recipes/[id]', rule: 'label-content-name-mismatch', issue: 520 },
    { page: '/collections', rule: 'label-content-name-mismatch', issue: 520 },
];

type PagePath = '/' | '/recipes/[id]' | '/collections';

const RECIPE_ID = 'ec000000-0000-4000-8000-000000000031';
const RECIPE_TITLE = 'Axe Check Soup';

/** Checks a page: its violated rules must be exactly the known ones for it, and a failure names the elements. */
async function expectOnlyKnown(page: Page, at: PagePath): Promise<void> {
    const { violations } = await new AxeBuilder({ page }).withTags([...AXE_TAGS]).analyze();
    const known = KNOWN.filter((entry) => entry.page === at).map((entry) => entry.rule);
    const where = violations.map(
        (violation) => `${violation.id}: ${violation.nodes.map((node) => node.html).join(' | ')}`,
    );

    expect(violations.map((violation) => violation.id).sort(), `axe on ${at}:\n${where.join('\n')}`).toEqual(
        [...known].sort(),
    );
}

test.describe('accessibility (axe, WCAG 2.1 A and AA)', () => {
    test.beforeEach(async ({ page }) => {
        await signInWithTicket(page);
        const viewerId = await readViewerAppId(page);
        await mockRecipeApi(page, {
            viewerId,
            recipes: [makeRecipeDetail({ id: RECIPE_ID, ownerId: viewerId, title: RECIPE_TITLE })],
            collections: [makeCollection({ id: 'col_axe', ownerId: viewerId, name: 'Axe collection' })],
        });
    });

    test('home has no violation', async ({ page }) => {
        await page.goto(route('/'));
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

        await expectOnlyKnown(page, '/');
    });

    test('a recipe has no violation', async ({ page }) => {
        await page.goto(route(`/recipes/${RECIPE_ID}`));
        await expect(page.getByRole('heading', { level: 1, name: RECIPE_TITLE })).toBeVisible();

        await expectOnlyKnown(page, '/recipes/[id]');
    });

    test('the collections list has no violation', async ({ page }) => {
        await page.goto(route('/collections'));
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        await expect(page.getByText('Axe collection')).toBeVisible();

        await expectOnlyKnown(page, '/collections');
    });
});
