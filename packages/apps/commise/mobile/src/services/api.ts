/**
 * The mobile app's low-level identity transport.
 *
 * ⚠️ IT PARSES, IT NO LONGER CASTS (`docs/CODING_STANDARDS.md` §15 / ADR-0014). `apiRequest` used to be
 * `apiRequest<T>(…): Promise<T>` ending in `return payload as T`, so its ONE statement about a response was a
 * type argument that erases at runtime — the caller named a shape and nothing checked it. It now takes the
 * published zod for the endpoint's success body and returns a value it has established rather than asserted, so
 * a drifted identity response fails here, naming the field, instead of surfacing as an `undefined` deep inside
 * a screen. The error envelope is read through `apiErrorSchema` for the same reason: `payload.code` selects
 * what the caller sees, and that was a control-flow decision taken on an unchecked string.
 *
 * ⚠️ AND IT IS DELIBERATELY NOT A CLIENT. There is no `packages/clients/identity-service`, so this file, the
 * web app's `src/lib/apiClient.ts`, and `@commise/features-account`'s `ProfileServiceClient` are three
 * hand-rolled transports to one service. `ProfileServiceClient` is the one with typed errors and a published
 * contract on both directions; the surviving reason THIS exists is the avatar presign, which that client does
 * not cover. Collapsing the three is recorded as follow-up, not attempted here.
 */
import { apiErrorSchema } from '@kitchensink/schema-identity';
import type { z } from 'zod';

import { env } from '../config/env.js';

// Identity endpoints (`/api/v1/users/me`) are served by the IDENTITY service, which is a separate deployable on
// a separate host from the recipe service (sandbox/prod route them to distinct subdomains — `identity.{stage}`
// vs `recipe.{stage}` — and there is no cross-service proxy). So identity calls must target their OWN origin,
// mirroring the web split.
//
// This used to fall back to the recipe origin and then to a literal `https://api.commise.io`. Both were
// unsafe guesses: the first sends `/api/v1/users/me` to a service that does not serve it (a 404 that reads as
// a profile-screen bug), and the second is a production hostname nothing in this repo provisions. The
// origin is now required and validated — see `../config/env.ts`.
export const API_BASE_URL = env.EXPO_PUBLIC_IDENTITY_API_URL;

export type GetToken = () => Promise<string | null>;

export class ApiError extends Error {
    readonly statusCode: number;
    readonly code?: string;
    constructor(message: string, statusCode: number, code?: string) {
        super(message);
        this.name = 'ApiError';
        this.statusCode = statusCode;
        this.code = code;
    }
}

/**
 * Per-call transport options.
 *
 * @notWireShape This module's own request options (method, body, extra headers) — a caller-facing argument bag,
 *   not a shape the identity service sends or receives, so there is nothing in `@kitchensink/schema-identity`
 *   to import or derive it from. §15.2 rule 4 explicitly keeps this kind of type local.
 */
interface RequestOptions {
    method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
    body?: unknown;
    headers?: Record<string, string>;
}

/**
 * Issue an authenticated identity request and PARSE the success body against the published contract.
 *
 * @param getToken - Mints the bearer token (native template — see `../auth/nativeToken.ts`).
 * @param path - The endpoint path, beginning with `/`.
 * @param schema - The published response schema for this endpoint's success body.
 * @param opts - Method, body and extra headers.
 * @returns The VALIDATED response body.
 * @throws {ApiError} when unauthenticated or on any non-2xx status; a `ZodError` when the body does not match
 *   the published contract — a drift to surface, not swallow.
 * @sideEffect Performs an authenticated network request.
 */
export async function apiRequest<S extends z.ZodType>(
    getToken: GetToken,
    path: string,
    schema: S,
    opts: RequestOptions = {},
): Promise<z.output<S>> {
    const token = await getToken();

    if (!token) {
        throw new ApiError('Not authenticated', 401, 'unauthenticated');
    }

    const response = await fetch(`${API_BASE_URL}${path}`, {
        method: opts.method ?? 'GET',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
            ...opts.headers,
        },
        body: opts.body ? JSON.stringify(opts.body) : undefined,
    });

    const raw: unknown = await response.json().catch(() => undefined);

    if (!response.ok) {
        // `safeParse`, not `parse`: a non-2xx body is frequently not our envelope at all — the shared
        // internet-facing ALB serves an HTML page for 502/503/504 during every deploy (ADR-0003) — and throwing
        // from the error path would replace a recoverable `ApiError` with a parse failure. An unrecognized body
        // degrades to mapping by status alone, which is still correct.
        const parsed = apiErrorSchema.safeParse(raw);
        const envelope = parsed.success ? parsed.data : undefined;

        throw new ApiError(envelope?.message ?? `Request failed: ${response.status}`, response.status, envelope?.code);
    }

    return schema.parse(raw) as z.output<S>;
}
