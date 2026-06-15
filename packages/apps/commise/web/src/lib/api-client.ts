import { navigateTo } from '@/lib/navigation';
import { withBasePath } from '@/lib/base-path';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000';

interface RequestOptions extends RequestInit {
    accessToken?: string;
}

export async function apiClient<T>(endpoint: string, options: RequestOptions = {}): Promise<T> {
    const { accessToken, headers, ...rest } = options;

    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
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

        const error = await response.json().catch(() => ({ message: 'Request failed' }));
        throw new Error(error.message ?? `HTTP ${response.status}`);
    }

    if (response.status === 204) {
        return undefined as T;
    }

    return response.json();
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
