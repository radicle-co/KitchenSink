/**
 * U9 — the parse-job user story through the PUBLIC surface only (real app + DB + LocalStack).
 *
 * The e2e slice of the tier matrix: no direct database writes, no simulated worker — exactly what a
 * client can do. The paste is accepted, the poll answers pending (no worker consumes the queue in this
 * harness — pending IS the honest state), an edit re-drives, and the failure modes a client must handle
 * (400 with the offending line named, 404 on an unknown job) answer the published envelope. The
 * worker-in-the-loop and cross-race proofs live in `__tests__/integration/parseJobs/`.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { bootRecipeApp, hasDatabaseUrl, type BootedRecipeApp } from './harness.js';

const OWNER = '01JPARSEJOBE2EOWNER00000AA';

interface JobView {
    id: string;
    status: string;
    createdAt: string;
    expiresAt: string;
    lines: { lineIndex: number; sourceLine: string; status: string; proposal: unknown }[];
}

describe.skipIf(!hasDatabaseUrl)('parse jobs (e2e)', () => {
    let booted: BootedRecipeApp;
    let baseUrl: string;

    beforeAll(async () => {
        booted = await bootRecipeApp({ devAuthUserId: OWNER });
        baseUrl = booted.baseUrl;
    });

    afterAll(async () => {
        await booted.close();
    });

    it('paste → 202 → poll shows every line pending → edit re-drives the line', async () => {
        const created = await fetch(`${baseUrl}/api/v1/recipe-parse-jobs`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ text: '2 cups flour\n3 large eggs\n1 tsp vanilla' }),
        });

        expect(created.status).toBe(202);

        const job = (await created.json()) as JobView;

        expect(job.status).toBe('running');
        expect(job.lines).toHaveLength(3);
        expect(new Date(job.expiresAt).getTime()).toBeGreaterThan(Date.now());

        const polled = await fetch(`${baseUrl}/api/v1/recipe-parse-jobs/${job.id}`);

        expect(polled.status).toBe(200);

        const view = (await polled.json()) as JobView;

        expect(view.lines.map((line) => line.status)).toEqual(['pending', 'pending', 'pending']);
        expect(view.lines.every((line) => line.proposal === null)).toBe(true);

        const edited = await fetch(`${baseUrl}/api/v1/recipe-parse-jobs/${job.id}/lines/2`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ sourceLine: '2 tsp vanilla extract' }),
        });

        expect(edited.status).toBe(202);

        const afterEdit = (await edited.json()) as JobView;

        expect(afterEdit.lines[2]?.sourceLine).toBe('2 tsp vanilla extract');
        expect(afterEdit.lines[2]?.status).toBe('pending');
    });

    it('an inadmissible paste answers 400 naming the offending line; an unknown job answers the envelope 404', async () => {
        const rejected = await fetch(`${baseUrl}/api/v1/recipe-parse-jobs`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ text: `fine\n${'x'.repeat(1001)}` }),
        });

        expect(rejected.status).toBe(400);
        expect(JSON.stringify(await rejected.json())).toContain('line 1');

        const missing = await fetch(`${baseUrl}/api/v1/recipe-parse-jobs/3f2504e0-4f89-11d3-9a0c-0305e82c3301`);

        expect(missing.status).toBe(404);
        expect(((await missing.json()) as { code: string }).code).toBe('PARSE_JOB_NOT_FOUND');
    });
});
