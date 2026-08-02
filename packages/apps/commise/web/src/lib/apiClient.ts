import { withBasePath } from '@/lib/basePath';
import { IDENTITY_SERVICE_BASE_URL } from '@/lib/identityServiceClient';
import { navigateTo } from '@/lib/navigation';

interface RequestOptions extends RequestInit {
    accessToken?: string;
}

/**
 * A typed API error carrying the HTTP status and (when present) the service's error `code`, so callers
 * can branch on the failure instead of string-matching a bare `Error` message. Mirrors the mobile
 * client's `ApiError` (`mobile/src/services/api.ts`) so both platforms surface failures the same way.
 */
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

export async function apiClient<T>(endpoint: string, options: RequestOptions = {}): Promise<T> {
    const { accessToken, headers, ...rest } = options;

    const response = await fetch(`${IDENTITY_SERVICE_BASE_URL}${endpoint}`, {
        ...rest,
        headers: {
            'Content-Type': 'application/json',
            ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
            ...headers,
        },
        credentials: 'include',
    });

    if (!response.ok) {
        if (response.status === 401 && typeof window !== 'undefined') {
            // Prefix the sign-in target with the base path; `window.location.pathname` already carries
            // the prefix (the browser is at /pr-{N}/…), so do NOT prefix the redirect_url value.
            navigateTo(`${withBasePath('/sign-in')}?redirect_url=${encodeURIComponent(window.location.pathname)}`);
        }

        const payload = (await response.json().catch(() => ({}))) as { message?: string; code?: string };
        throw new ApiError(payload.message ?? `HTTP ${response.status}`, response.status, payload.code);
    }

    // A no-content success (`204`, or a `202 Accepted` with an empty body — e.g. `DELETE /api/v1/users/me`)
    // has nothing to parse; `response.json()` on an empty body throws. Read the body once and treat any
    // empty 2xx as void, so a successful account deletion resolves (and the caller's signOut runs) rather
    // than surfacing a spurious parse error. A non-empty 2xx must be valid JSON per the contract.
    const text = await response.text();

    if (text.length === 0) {
        return undefined as T;
    }

    return JSON.parse(text) as T;
}

export function buildApiClient(accessToken: string) {
    return {
        get: <T>(endpoint: string) => apiClient<T>(endpoint, { accessToken, method: 'GET' }),
        post: <T>(endpoint: string, body?: unknown) =>
            apiClient<T>(endpoint, { accessToken, method: 'POST', body: JSON.stringify(body) }),
        patch: <T>(endpoint: string, body?: unknown) =>
            apiClient<T>(endpoint, { accessToken, method: 'PATCH', body: JSON.stringify(body) }),
        delete: <T>(endpoint: string) => apiClient<T>(endpoint, { accessToken, method: 'DELETE' }),
    };
}
