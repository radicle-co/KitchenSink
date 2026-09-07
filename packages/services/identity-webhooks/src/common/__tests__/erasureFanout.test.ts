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

import { runErasureFanout, type ErasureFanoutConfig } from '../erasureFanout.js';

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
    /**
     * The DEFAULT protocol router (U18): recipe erasure → food begin → recipe food-references → food
     * complete. Each fake names its step so ordering and payloads are assertable.
     */
    function protocolRouter(calls: Array<{ url: string; auth: string; body: unknown }>) {
        return vi.fn(async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
            const u = String(url);
            // `init?.headers` short-circuiting to undefined would make the index access throw a TypeError
            // instead of recording the call, so default it before indexing (oxlint no-unsafe-optional-chaining).
            const headers = (init?.headers ?? {}) as Record<string, string>;
            calls.push({
                url: u,
                auth: String(headers['Authorization']),
                body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
            });

            if (u.endsWith('/account/erasure') && u.includes('recipe')) {
                return jsonResponse(202, { jobId: 'job_1', status: 'queued', triggerSource: 'service' });
            }

            if (u.endsWith('/account/erasure/begin')) {
                return jsonResponse(200, { authoredFoodIds: ['f-kept', 'f-gone'] });
            }

            if (u.endsWith('/account/food-references')) {
                return jsonResponse(200, { referencedFoodIds: ['f-kept'] });
            }

            return jsonResponse(200, {
                requesterId: TARGET.userId,
                deletedRequesterRows: 2,
                deletedAuthoredFoods: 1,
                keptAuthoredFoods: 1,
            });
        });
    }

    it('runs recipe erasure, then the U18 food protocol — begin, reference check, complete — with the RIGHT audiences', async () => {
        const calls: Array<{ url: string; auth: string; body: unknown }> = [];
        const fetchImpl = protocolRouter(calls);

        const result = await runErasureFanout(TARGET, config(), { fetchImpl });

        // Ordering: recipe erasure first (R9), then the food protocol's three steps.
        expect(calls.map((call) => call.url)).toEqual([
            'https://recipe.example.test/api/v1/internal/account/erasure',
            'https://food.example.test/api/v1/internal/account/erasure/begin',
            'https://recipe.example.test/api/v1/internal/account/food-references',
            'https://food.example.test/api/v1/internal/account/erasure',
        ]);

        // The begin step's ids feed the reference check; its answer feeds the completion body.
        expect(calls[2]!.body).toEqual({ foodIds: ['f-kept', 'f-gone'] });
        expect(calls[3]!.body).toEqual({ referencedFoodIds: ['f-kept'] });

        // Audience binding per TARGET service: food steps carry the food audience, the recipe-hosted
        // reference check carries RECIPE's — a captured token still cannot cross services.
        expect(decodeJwt(calls[0]!.auth.replace('Bearer ', '')).aud).toBe(SERVICE_ERASURE_TOKEN_AUDIENCE);
        expect(decodeJwt(calls[1]!.auth.replace('Bearer ', '')).aud).toBe(SERVICE_ERASURE_TOKEN_AUDIENCE_FOOD);
        expect(decodeJwt(calls[2]!.auth.replace('Bearer ', '')).aud).toBe(SERVICE_ERASURE_TOKEN_AUDIENCE);
        expect(decodeJwt(calls[3]!.auth.replace('Bearer ', '')).aud).toBe(SERVICE_ERASURE_TOKEN_AUDIENCE_FOOD);
        expect(decodeJwt(calls[0]!.auth.replace('Bearer ', '')).sub).toBe(TARGET.userId);

        expect(result.recipe).toMatchObject({ service: 'recipe', ok: true, jobStatus: 'queued' });
        expect(result.food).toMatchObject({
            service: 'food',
            ok: true,
            deletedRequesterRows: 2,
            deletedAuthoredFoods: 1,
            keptAuthoredFoods: 1,
        });
    });

    it('skips the reference check entirely when the owner authored no foods', async () => {
        const calls: Array<{ url: string; auth: string; body: unknown }> = [];
        const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
            const u = String(url);
            calls.push({ url: u, auth: '', body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined });

            if (u.includes('recipe')) {
                return jsonResponse(202, { status: 'queued', triggerSource: 'service' });
            }

            if (u.endsWith('/begin')) {
                return jsonResponse(200, { authoredFoodIds: [] });
            }

            return jsonResponse(200, { requesterId: TARGET.userId, deletedRequesterRows: 0 });
        });

        const result = await runErasureFanout(TARGET, config(), { fetchImpl });

        expect(calls.map((call) => call.url)).toEqual([
            'https://recipe.example.test/api/v1/internal/account/erasure',
            'https://food.example.test/api/v1/internal/account/erasure/begin',
            'https://food.example.test/api/v1/internal/account/erasure',
        ]);
        expect(calls[2]!.body).toEqual({ referencedFoodIds: [] });
        expect(result.food.ok).toBe(true);
    });

    it('⛔ a failed reference check fails the FOOD leg — never a blind delete of possibly-referenced foods', async () => {
        const fetchImpl = vi.fn(async (url: string | URL | Request): Promise<Response> => {
            const u = String(url);

            if (u.includes('recipe') && u.endsWith('/account/erasure')) {
                return jsonResponse(202, { status: 'queued', triggerSource: 'service' });
            }

            if (u.endsWith('/begin')) {
                return jsonResponse(200, { authoredFoodIds: ['f-1'] });
            }

            if (u.endsWith('/food-references')) {
                return jsonResponse(500, { error: 'boom' });
            }

            throw new Error('the completion step must not run after a failed reference check');
        });

        const result = await runErasureFanout(TARGET, config(), { fetchImpl });

        expect(result.food).toMatchObject({ service: 'food', ok: false, httpStatus: 500 });
        expect(result.food.detail).toContain('food-references');
    });

    it('surfaces an already-erased recipe account as ok with jobStatus=completed (idempotent no-op)', async () => {
        const fetchImpl = vi.fn(async (url: string | URL | Request): Promise<Response> => {
            const u = String(url);

            if (u.includes('recipe') && u.endsWith('/account/erasure')) {
                return jsonResponse(200, { status: 'completed', triggerSource: 'service' });
            }

            if (u.endsWith('/begin')) {
                return jsonResponse(200, { authoredFoodIds: [] });
            }

            return jsonResponse(200, { requesterId: TARGET.userId, deletedRequesterRows: 0 });
        });

        const result = await runErasureFanout(TARGET, config(), { fetchImpl });

        expect(result.recipe).toMatchObject({ ok: true, jobStatus: 'completed' });
        expect(result.food).toMatchObject({ ok: true, deletedRequesterRows: 0 });
    });

    it('reports a recipe HTTP error as ok=false WITHOUT throwing, and still attempts the food leg', async () => {
        const fetchImpl = vi.fn(async (url: string | URL | Request): Promise<Response> => {
            const u = String(url);

            if (u.includes('recipe') && u.endsWith('/account/erasure')) {
                return jsonResponse(500, { error: 'boom' });
            }

            if (u.endsWith('/begin')) {
                return jsonResponse(200, { authoredFoodIds: [] });
            }

            return jsonResponse(200, { requesterId: TARGET.userId, deletedRequesterRows: 1 });
        });

        const result = await runErasureFanout(TARGET, config(), { fetchImpl });

        expect(result.recipe).toMatchObject({ service: 'recipe', ok: false, httpStatus: 500 });
        // Food is independent data — it must still be erased even when the recipe leg failed.
        expect(result.food).toMatchObject({ ok: true, deletedRequesterRows: 1 });
        // Recipe erasure + food begin + food complete (no authored foods, so no reference check).
        expect(fetchImpl).toHaveBeenCalledTimes(3);
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
