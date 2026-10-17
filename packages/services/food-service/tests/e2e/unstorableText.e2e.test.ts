/**
 * LOCAL e2e — a NUL (U+0000) in an authored food's text is the caller's `400`, not a `500`, against a REAL PostgreSQL.
 * Boots the real app as `food_app` (ADR-0039) behind the REAL `FoodAuthGuard` over genuinely-signed RS256 tokens.
 * Target: LOCAL (§7.1a).
 *
 * ⛔ THE DEFECT: PostgreSQL `text` cannot hold a NUL, so `POST /api/v1/foods/authored` and `PUT /api/v1/foods/{id}`
 * passed the schema, failed at the bind with SQLSTATE `22021`, and answered `500` with a Sentry issue — any signed-in
 * caller could raise both at will. The filter now answers `VALIDATION_FAILED` (`normalizeUnstorableText`); the
 * filter integration test proves the Sentry half with the database mocked.
 */
import 'reflect-metadata';

import type { BootedServiceApp } from '@kitchensink/service-test-harness';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/sources/usda/usda.adapter.js', async () => {
    const { StubSourceAdapter } = await import('../support/StubSourceAdapter.js');

    return { UsdaSourceAdapter: StubSourceAdapter };
});

import { foodErrorSchema, foodResponseSchema } from '../../src/foods/foods.schema.js';
import { generateClerkKeypair, mintToken } from '../support/jwt.js';
import { foodDb } from '../support/roleDb.js';
import { bootFoodApp, callFoodApi, type FoodApiResponse } from './harness.js';

const APP_AZP = 'https://app.example.com';
const AUTHOR_ULID = '01J9ZK8N7QF3B2X4M6T0V5C1NA';

const keypair = generateClerkKeypair();
const authorToken = mintToken(keypair.privateKeyPem, {
    sub: 'user_nul_author',
    externalId: AUTHOR_ULID,
    azp: APP_AZP,
});

/** The caller's text around the NUL, which must never come back in an error body. */
const CALLER_TEXT = 'Grandma spice blend';

/** A complete, valid authored-food body; `over` replaces the fields under test. */
function authoredFood(over: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        name: 'Protein blend',
        description: 'Homemade shake mix',
        macros: { calories: 380, proteinG: 70, carbsG: 12, fatG: 6 },
        portions: [{ label: '1 scoop', gramWeight: 30 }],
        ...over,
    };
}

/**
 * Assert the answer is the published `VALIDATION_FAILED` and carries none of the caller's text or the SQL.
 *
 * @param response - The API's answer.
 */
function expectRefusedText(response: FoodApiResponse): void {
    expect(response.status).toBe(400);
    expect(foodErrorSchema.parse(response.body)).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(response.text).not.toContain(CALLER_TEXT);
    expect(response.text).not.toContain('insert into');
    expect(response.text).not.toContain('update');
}

describe('a NUL in an authored food’s text answers 400, LOCAL e2e', () => {
    let booted: BootedServiceApp;

    beforeAll(async () => {
        booted = await bootFoodApp({ clerkJwtKey: keypair.publicKeyPem, authorizedParties: [APP_AZP] });
    });

    afterAll(async () => {
        await booted?.close();
    });

    beforeEach(async () => {
        await foodDb().truncate();
    });

    it('⛔ refuses a NUL in the name on create, stores nothing, and the next create still succeeds', async () => {
        const refused = await callFoodApi(booted.baseUrl, 'POST', '/api/v1/foods/authored', {
            token: authorToken,
            body: authoredFood({ name: `${CALLER_TEXT}\u0000` }),
        });

        expectRefusedText(refused);

        // The pooled connection the failed statement used must come back clean, and the refusal must have stored
        // nothing: the same author's valid create of the same name is a `201`, not a `DUPLICATE_AUTHORED_NAME`.
        const accepted = await callFoodApi(booted.baseUrl, 'POST', '/api/v1/foods/authored', {
            token: authorToken,
            body: authoredFood({ name: CALLER_TEXT }),
        });

        expect(accepted.status).toBe(201);
    });

    it('⛔ refuses a NUL in the description on update and leaves the stored food unchanged', async () => {
        const created = await callFoodApi(booted.baseUrl, 'POST', '/api/v1/foods/authored', {
            token: authorToken,
            body: authoredFood(),
        });
        const { id } = foodResponseSchema.parse(created.body);

        const refused = await callFoodApi(booted.baseUrl, 'PUT', `/api/v1/foods/${id}`, {
            token: authorToken,
            body: authoredFood({ description: `${CALLER_TEXT}\u0000` }),
        });

        expectRefusedText(refused);

        const stored = await callFoodApi(booted.baseUrl, 'GET', `/api/v1/foods/${id}`, { token: authorToken });

        expect(stored.status).toBe(200);
        expect(stored.text).toContain('Homemade shake mix');
        expect(stored.text).not.toContain(CALLER_TEXT);
    });
});
