/**
 * REQ-NF-003 / ATP-NF-003-A — timed "complete recipe" creation scenario (real Nest app + Docker Postgres
 * + LocalStack S3).
 *
 * **Scope note — read before extending or "fixing" this test.** `system-design.md`'s Decomposition View
 * assigns REQ-NF-003 to `SYS-016` (Web Client) and `SYS-017` (Mobile Client) — NOT to any recipe-service
 * component (`requirements.md`: `SC-001 → REQ-NF-003`, distinct from `SC-009 → REQ-NF-002`, which IS a
 * recipe-service p95-latency requirement already covered by `tests/load/sc009ReadWrite.load.js` +
 * `saveUnderArchive.load.js`). REQ-NF-003 is a human-clock UI usability target — "a user... in under 5
 * minutes of elapsed time" — that genuinely requires a person (or a scripted Playwright/Maestro flow)
 * driving the web/mobile UI end to end, including the photo-picker interaction; no backend-only test can
 * honestly claim to VERIFY that. Fabricating a "structured create log" feature in `recipes.service.ts` to
 * make this look closed would be dishonest twice over: recipe-service emits no such log today (adding one
 * would be a production behavior change, not an additive test), and even a real one would not prove a
 * HUMAN can finish the journey in 5 minutes.
 *
 * What THIS test legitimately proves, at the one layer recipe-service owns: `ATP-NF-003-A`'s own
 * mechanics — "the test harness records a timestamp when the Create Recipe action is invoked... the
 * execution log is written as JSON containing `startTime`, `endTime`, and `elapsedMs` fields" — applied to
 * the backend leg of the "complete recipe" journey (Glossary: >=1 ingredient, >=1 instruction, >=1
 * photo — `POST /api/v1/recipes` with content, then the presign → upload → confirm photo flow). If the
 * backend leg were slow or broken, no UI-level 5-minute budget could ever be met regardless of how fast a
 * human fills the form; this is the regression tripwire for THAT half of the budget, not a substitute for
 * the SYS-016/SYS-017 UI-level acceptance test the requirement is actually owned by.
 *
 * Runs only when the harness DB is configured — otherwise skipped in lockstep with the global setup.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { bootRecipeApp, hasDatabaseUrl, type BootedRecipeApp } from '../../../tests/e2e/harness.js';

/** The dev-bypass owner ULID this suite creates recipes + photos as. */
const OWNER = '01JCOMPLETERECIPETIMING0001';

/** ATP-NF-003-A's own budget: a complete recipe in under 5 minutes of elapsed time. */
const FIVE_MINUTES_MS = 5 * 60 * 1000;

/** A REAL, decodable 1×1 PNG (base64) — see `photos/upload.integration.test.ts` for why a genuine image is used. */
const REAL_PNG_BYTES = new Uint8Array(
    Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
        'base64',
    ),
);

/** A CreateRecipeRequest body satisfying the Glossary "complete recipe" content bar (minus the photo, attached separately): >=1 ingredient, >=1 instruction. */
const COMPLETE_RECIPE_PAYLOAD = {
    title: 'ATP-NF-003 Complete Recipe',
    description: 'Created by the REQ-NF-003 timed backend-leg integration spec.',
    servings: 4,
    prepTimeMinutes: 10,
    cookTimeMinutes: 20,
    totalTimeMinutes: 30,
    tags: ['integration'],
    dietaryFlags: [],
    ingredients: [
        {
            ingredientId: '00000000-0000-4000-8000-0000000000aa',
            name: 'Flour',
            quantity: { kind: 'exact', value: 2 },
            unit: 'cups',
        },
    ],
    steps: [{ instruction: 'Combine and bake.' }],
};

interface RecipeBody {
    id: string;
}

interface UploadUrlBody {
    uploadUrl: string;
    key: string;
}

/** The ATP-NF-003-A execution-log shape: "JSON containing startTime, endTime, and elapsedMs fields". */
interface Atp003ExecutionLog {
    scenario: 'ATP-NF-003-A';
    startTime: string;
    endTime: string;
    elapsedMs: number;
}

describe.skipIf(!hasDatabaseUrl)('complete-recipe creation — backend-leg timing (REQ-NF-003 / ATP-NF-003-A)', () => {
    let booted: BootedRecipeApp;
    let baseUrl: string;

    beforeAll(async () => {
        booted = await bootRecipeApp({ devAuthUserId: OWNER });
        baseUrl = booted.baseUrl;
    });

    afterAll(async () => {
        await booted?.close();
    });

    it('completes create + ingredient + instruction + photo well inside the 5-minute budget, and records the ATP-NF-003-A JSON execution log', async () => {
        // "the test harness records a timestamp when the Create Recipe action is invoked" (ATP-NF-003-A).
        const startedAt = new Date();

        // 1. Create the recipe with >=1 ingredient and >=1 instruction in one call.
        const createRes = await fetch(`${baseUrl}/api/v1/recipes`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(COMPLETE_RECIPE_PAYLOAD),
        });
        expect(createRes.status).toBe(201);
        const recipeId = ((await createRes.json()) as RecipeBody).id;

        // 2. Attach >=1 photo — the third Glossary "complete recipe" element (presign → PUT → confirm).
        const presignRes = await fetch(`${baseUrl}/api/v1/recipes/${recipeId}/photos/upload-url`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                fileName: 'dish.png',
                contentType: 'image/png',
                fileSize: REAL_PNG_BYTES.byteLength,
            }),
        });
        expect(presignRes.status).toBe(200);
        const presigned = (await presignRes.json()) as UploadUrlBody;

        const putRes = await fetch(presigned.uploadUrl, {
            method: 'PUT',
            headers: { 'content-type': 'image/png' },
            body: REAL_PNG_BYTES,
        });
        expect(putRes.ok).toBe(true);

        const confirmRes = await fetch(`${baseUrl}/api/v1/recipes/${recipeId}/photos/confirm`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ key: presigned.key, contentType: 'image/png' }),
        });
        expect(confirmRes.status).toBe(201);

        // "...and stops when success confirmation is rendered" — the confirm response IS the backend's
        // success confirmation for the last of the three Glossary elements.
        const endedAt = new Date();
        const elapsedMs = endedAt.getTime() - startedAt.getTime();

        const executionLog: Atp003ExecutionLog = {
            scenario: 'ATP-NF-003-A',
            startTime: startedAt.toISOString(),
            endTime: endedAt.toISOString(),
            elapsedMs,
        };
        // "the execution log is written as JSON containing startTime, endTime, and elapsedMs fields"
        // (ATP-NF-003-A) — written for reproducibility, exactly as the scenario specifies.
        console.info(JSON.stringify(executionLog));

        // The assertion itself: a real mutation-testable tripwire, not a tautology — a backend regression
        // that stalls create, presign, upload, or confirm (e.g. a lock held too long, a synchronous
        // thumbnail pipeline blocking the response) pushes `elapsedMs` up and eventually breaches this,
        // exactly the failure mode that would silently eat into a human user's 5-minute budget.
        expect(elapsedMs).toBeGreaterThan(0);
        expect(elapsedMs).toBeLessThan(FIVE_MINUTES_MS);
        expect(executionLog.startTime <= executionLog.endTime).toBe(true);
    });
});
