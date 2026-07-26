/**
 * Unit tests for the cross-service erasure FAN-OUT gateway (CR-002 / U4b — R7/R9/R11).
 *
 * The fan-out is the deletion-worker's anti-corruption gateway: it turns one domain erasure event
 * (`{ userId }`) into two verified service-principal HTTP calls — recipe FIRST (so the election-bearing
 * job exists before the Clerk `user.deleted` echo lands, R9), then food (`eraseUser`, R11). It NEVER
 * throws on a leg failure: it returns a per-leg result so the caller (worker → SQS retry; reconciliation →
 * incompleteness metric) decides. These tests pin the ordering, the per-service audience binding, the
 * bearer/URL wiring, and the failure surfacing.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { exportPKCS8, decodeJwt } from 'jose';
import { generateKeyPair } from 'jose';
import {
    SERVICE_ERASURE_TOKEN_ALG,
    SERVICE_ERASURE_TOKEN_AUDIENCE,
    SERVICE_ERASURE_TOKEN_AUDIENCE_FOOD,
} from '@kitchensink/recipe-core';

import { runErasureFanout, type ErasureFanoutConfig } from '../erasure-fanout.js';

let signingKeyPem: string;

beforeAll(async () => {
    const { privateKey } = await generateKeyPair(SERVICE_ERASURE_TOKEN_ALG, { extractable: true });
    signingKeyPem = await exportPKCS8(privateKey);
});

const config = (): ErasureFanoutConfig => ({
    signingKeyPem,
    recipeBaseUrl: 'https://recipe.example.test',
    foodBaseUrl: 'https://food.example.test',
});

const TARGET = { userId: '01JOWNER00000000000000000A', eventId: 'evt_1', actor: 'identity-deletion-worker' };

/** A canned JSON `Response`. */
const jsonResponse = (status: number, body: unknown): Response =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('runErasureFanout', () => {
    it('calls recipe FIRST then food, each at its internal route with a Bearer token of the RIGHT audience', async () => {
        const calls: Array<{ url: string; auth: string }> = [];
        const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
            const u = String(url);
            calls.push({ url: u, auth: String((init?.headers as Record<string, string>)['Authorization']) });

            return u.includes('recipe')
                ? jsonResponse(202, { jobId: 'job_1', status: 'queued', triggerSource: 'service' })
                : jsonResponse(200, { requesterId: TARGET.userId, deletedRequesterRows: 2 });
        });

        const result = await runErasureFanout(TARGET, config(), { fetchImpl });

        // Ordering: recipe before food (R9 — job exists before the echo).
        expect(calls[0]!.url).toBe('https://recipe.example.test/v1/internal/account/erasure');
        expect(calls[1]!.url).toBe('https://food.example.test/v1/internal/account/erasure');

        // Audience binding: the recipe leg's token pins the recipe audience, the food leg's the food one.
        const recipeToken = calls[0]!.auth.replace('Bearer ', '');
        const foodToken = calls[1]!.auth.replace('Bearer ', '');
        expect(decodeJwt(recipeToken).aud).toBe(SERVICE_ERASURE_TOKEN_AUDIENCE);
        expect(decodeJwt(foodToken).aud).toBe(SERVICE_ERASURE_TOKEN_AUDIENCE_FOOD);
        // Both bind the same target owner.
        expect(decodeJwt(recipeToken).sub).toBe(TARGET.userId);
        expect(decodeJwt(foodToken).sub).toBe(TARGET.userId);

        expect(result.recipe).toMatchObject({ service: 'recipe', ok: true, jobStatus: 'queued' });
        expect(result.food).toMatchObject({ service: 'food', ok: true, deletedRequesterRows: 2 });
    });

    it('surfaces an already-erased recipe account as ok with jobStatus=completed (idempotent no-op)', async () => {
        const fetchImpl = vi.fn(async (url: string | URL | Request): Promise<Response> =>
            String(url).includes('recipe')
                ? jsonResponse(200, { status: 'completed', triggerSource: 'service' })
                : jsonResponse(200, { requesterId: TARGET.userId, deletedRequesterRows: 0 }),
        );

        const result = await runErasureFanout(TARGET, config(), { fetchImpl });

        expect(result.recipe).toMatchObject({ ok: true, jobStatus: 'completed' });
        expect(result.food).toMatchObject({ ok: true, deletedRequesterRows: 0 });
    });

    it('reports a recipe HTTP error as ok=false WITHOUT throwing, and still attempts the food leg', async () => {
        const fetchImpl = vi.fn(async (url: string | URL | Request): Promise<Response> =>
            String(url).includes('recipe')
                ? jsonResponse(500, { error: 'boom' })
                : jsonResponse(200, { requesterId: TARGET.userId, deletedRequesterRows: 1 }),
        );

        const result = await runErasureFanout(TARGET, config(), { fetchImpl });

        expect(result.recipe).toMatchObject({ service: 'recipe', ok: false, httpStatus: 500 });
        // Food is independent data — it must still be erased even when the recipe leg failed.
        expect(result.food).toMatchObject({ ok: true, deletedRequesterRows: 1 });
        expect(fetchImpl).toHaveBeenCalledTimes(2);
    });

    it('reports a food NETWORK error (fetch throws) as ok=false with a detail, not an unhandled rejection', async () => {
        const fetchImpl = vi.fn(async (url: string | URL | Request): Promise<Response> => {
            if (String(url).includes('recipe')) {
                return jsonResponse(202, { jobId: 'j', status: 'queued', triggerSource: 'service' });
            }

            throw new Error('ECONNREFUSED');
        });

        const result = await runErasureFanout(TARGET, config(), { fetchImpl });

        expect(result.recipe.ok).toBe(true);
        expect(result.food.ok).toBe(false);
        expect(result.food.detail).toContain('ECONNREFUSED');
    });
});
