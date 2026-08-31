/**
 * Contract-conformance test for the parse-job resource (plan U9, ADR-0014).
 *
 * Drives the REAL booted app and parses the live `202`/`200` bodies against the PUBLISHED schema package
 * (`@kitchensink/schema-recipe`) — the copy web and mobile compile against — so the served shape and the
 * shipped contract are proven to be one object, not two that happen to agree. The sibling suites
 * (`recipesContract`, `photosContract`, …) establish the tier; this one covers the U9 surface.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseJobResponseSchema } from '@kitchensink/schema-recipe';

import { bootRecipeApp, hasDatabaseUrl, type BootedRecipeApp } from '../../../tests/e2e/harness.js';

const OWNER = '01JPARSEJOBCONTRACT00000AA';

describe.skipIf(!hasDatabaseUrl)('parse-job shape — client ↔ server contract conformance', () => {
    let booted: BootedRecipeApp;
    let baseUrl: string;

    beforeAll(async () => {
        booted = await bootRecipeApp({ devAuthUserId: OWNER });
        baseUrl = booted.baseUrl;
    });

    afterAll(async () => {
        await booted.close();
    });

    it('the 202 create body and the 200 poll body both parse against the PUBLISHED ParseJob schema', async () => {
        const created = await fetch(`${baseUrl}/api/v1/recipe-parse-jobs`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ text: '2 cups flour\n1 tsp salt' }),
        });

        expect(created.status).toBe(202);

        const createdBody: unknown = await created.json();
        const parsedCreate = parseJobResponseSchema.safeParse(createdBody);

        expect(parsedCreate.success, JSON.stringify(parsedCreate.success ? '' : parsedCreate.error.issues)).toBe(true);

        const id = (createdBody as { id: string }).id;
        const polled = await fetch(`${baseUrl}/api/v1/recipe-parse-jobs/${id}`);

        expect(polled.status).toBe(200);

        const polledParse = parseJobResponseSchema.safeParse(await polled.json());

        expect(polledParse.success, JSON.stringify(polledParse.success ? '' : polledParse.error.issues)).toBe(true);
    });
});
