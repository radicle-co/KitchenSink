import { env } from '../config/env.js';

// Identity endpoints (`/v1/users/me`, `/v1/accounts/me`) are served by the IDENTITY service, which is a
// separate deployable on a separate host from the recipe service (sandbox/prod route them to distinct
// subdomains — `identity.{stage}` vs `recipe.{stage}` — and there is no cross-service proxy). So identity
// calls must target their OWN origin, mirroring the web split.
//
// This used to fall back to the recipe origin and then to a literal `https://api.commise.io`. Both were
// unsafe guesses: the first sends `/v1/users/me` to a service that does not serve it (a 404 that reads as
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

interface RequestOptions {
    method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
    body?: unknown;
    headers?: Record<string, string>;
}

export async function apiRequest<T>(getToken: GetToken, path: string, opts: RequestOptions = {}): Promise<T> {
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

    if (response.status === 204) {
        return undefined as T;
    }

    const payload = (await response.json().catch(() => ({}))) as {
        message?: string;
        code?: string;
    };

    if (!response.ok) {
        throw new ApiError(payload.message ?? `Request failed: ${response.status}`, response.status, payload.code);
    }

    return payload as T;
}

// `/v1/users/me` (read/update/delete) now goes through the typed `ProfileServiceClient` (DA10-c) —
// `useUserProfile.ts` constructs it directly with `API_BASE_URL` above. `getAccount` is the one surviving
// low-level caller of `apiRequest` below.
export const getAccount = (getToken: GetToken) => apiRequest(getToken, '/v1/accounts/me');
