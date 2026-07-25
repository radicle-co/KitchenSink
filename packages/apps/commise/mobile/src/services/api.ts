// Identity endpoints (`/v1/users/me`, `/v1/accounts/me`) are served by the IDENTITY service, which is a
// separate deployable on a separate host from the recipe service (sandbox/prod route them to distinct
// subdomains — `identity.{stage}` vs `recipe.{stage}` — and there is no cross-service proxy). So identity
// calls must target their OWN origin, not the recipe origin in `EXPO_PUBLIC_API_URL`. This mirrors the web
// split (`NEXT_PUBLIC_API_BASE_URL` for identity vs `NEXT_PUBLIC_API_URL` for recipe). Fall back to the
// recipe origin only for back-compat with a single-gateway deployment, then to the prod default.
export const API_BASE_URL =
    process.env.EXPO_PUBLIC_IDENTITY_API_URL ?? process.env.EXPO_PUBLIC_API_URL ?? 'https://api.commise.io';

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
