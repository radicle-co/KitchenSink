/**
 * `ProfileServiceClient` (DA10-c) — the typed client for the Commise identity/account profile endpoints
 * (`GET`/`PATCH`/`DELETE /api/v1/users/me`), given the SAME shape as `@kitchensink/recipe-service-client`'s
 * `RecipeServiceClient`: an injected {@link TokenSource} (a literal token or a per-request callback, so a
 * rotated Clerk session token is always current), typed methods returning DTOs from
 * `@kitchensink/identity-service`, and typed errors (`./errors.js`) for `400`/`401`/`403`/`404`. Replaces
 * the loose `profileClient.ts` `updateProfile(transport, input)` free function + hand-passed
 * `ProfileTransport` — this class OWNS the endpoint contract (`PROFILE_ME_PATH`) instead of a caller having
 * to independently mint a token and adapt its own transport to a bare `.patch()` shape.
 *
 * Deliberately plain `fetch` (no `ky`) — unlike the recipe client, this surface is 3 simple endpoints with no
 * pagination risk. Adding `ky` here would be scope the endpoint doesn't need (YAGNI).
 *
 * ⚠️ ITS TYPES COME FROM `@kitchensink/schema-identity`, NOT FROM THE SERVICE PACKAGE. This module used to
 * `import type { UserProfile, UserUpdateInput } from '@kitchensink/identity-service'` — the whole NestJS
 * service, with drizzle, `pg`, the AWS SDK and `@sentry/nestjs` in its graph — declared as a RUNTIME
 * dependency of a package the mobile bundle ships. The types erase at compile time, so nothing broke; the
 * dependency EDGE from a mobile-bound package to a server package is what was wrong, and
 * `@kitchensink/schema-identity` (a generated leaf whose only dependency is zod) exists to remove it. The
 * same package also exports the RUNTIME zod for these shapes, so a caller that wants to validate this
 * boundary can do so against the same definition rather than a second one.
 *
 * Platform-specific side effects (e.g. the web app's redirect-to-sign-in on a `401`, or a `credentials`
 * policy) are NOT baked in here — they are injected via {@link ProfileServiceClientOptions.onUnauthorized}
 * / `.credentials`, so this class stays platform-agnostic and is usable, unmodified, from both the web
 * server/client boundary and the mobile app.
 */
import type { DeleteUserMeResponse, UserProfile, UserUpdateInput } from '@kitchensink/schema-identity';

import {
    BadRequestError,
    ForbiddenError,
    NotFoundError,
    ProfileServiceClientError,
    UnauthorizedError,
    UnexpectedResponseError,
} from './errors.js';

/**
 * The single authoritative path for reading/updating/deleting the current user's profile.
 *
 * The identity service exposes this as `@Controller('v1/users')` with `@Get`/`@Patch`/`@Delete('me')`
 * (`packages/services/identity/src/users/users.controller.ts`) — i.e. `GET`/`PATCH`/`DELETE /api/v1/users/me`.
 * There is deliberately no `/api/v1/profiles/me` route; the web and mobile clients had historically drifted to
 * different paths, and this constant is now the one place either platform encodes it.
 */
export const PROFILE_ME_PATH = '/api/v1/users/me';

/**
 * A bearer token supplied either as a literal or a (sync/async) per-request callback. The callback
 * receives `{ forceRefresh }` for a caller-driven re-mint (e.g. mobile always force-refreshes for the
 * profile read; see `mobile/src/hooks/useUserProfile.ts`). Mirrors
 * `@kitchensink/recipe-service-client`'s `TokenSource` exactly.
 */
export type TokenSource = string | ((options?: { readonly forceRefresh?: boolean }) => string | Promise<string>);

/**
 * The identity service's `DELETE /api/v1/users/me` response body.
 *
 * A one-line ALIAS over the service's own `DeleteUserMeResponse`, not a re-declaration: this file previously
 * hand-wrote the three fields, which is exactly the second representation of one wire shape CODING_STANDARDS §15
 * forbids. The name is kept because it is this package's published surface.
 */
export type DeleteAccountResult = DeleteUserMeResponse;

/** Per-call options accepted by every {@link ProfileServiceClient} method. */
export interface ProfileRequestOptions {
    /** Forwarded to a callback {@link TokenSource} — `true` to force a fresh (non-cached) token. */
    readonly forceRefresh?: boolean;
}

/** Construction options. */
export interface ProfileServiceClientOptions {
    /** The identity API base origin, e.g. `https://identity.commise.app` (no trailing `/v1`). */
    readonly baseUrl: string;
    /** A user session or M2M bearer token (literal or per-request callback). */
    readonly token?: TokenSource;
    /** Injectable `fetch` (defaults to the global `fetch`) — enables test doubles. */
    readonly fetch?: typeof fetch;
    /** Forwarded as `RequestInit.credentials` on every request (omitted by default). */
    readonly credentials?: RequestCredentials;
    /**
     * Invoked when a request resolves `401`, BEFORE the typed {@link UnauthorizedError} is thrown. The web
     * app uses this to reproduce its prior redirect-to-sign-in side effect; mobile has no such policy and
     * omits it. Kept OUT of this class's own request logic so the client stays platform-agnostic.
     *
     * @sideEffect Whatever the caller's callback does (e.g. a client-side navigation).
     */
    readonly onUnauthorized?: () => void;
}

/** A minimal error-body shape the identity service's exception filter emits. */
interface ErrorPayload {
    readonly message?: string;
    readonly code?: string;
}

export class ProfileServiceClient {
    private readonly baseUrl: string;
    private readonly token: TokenSource | undefined;
    private readonly fetchImpl: typeof fetch;
    private readonly credentials: RequestCredentials | undefined;
    private readonly onUnauthorized: (() => void) | undefined;

    /** @param options - Base URL, optional token, an optional `fetch` double, credentials, and 401 hook. */
    public constructor(options: ProfileServiceClientOptions) {
        this.baseUrl = options.baseUrl.replace(/\/+$/, '');
        this.token = options.token;
        this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
        this.credentials = options.credentials;
        this.onUnauthorized = options.onUnauthorized;
    }

    /**
     * `GET /api/v1/users/me` — read the signed-in viewer's identity profile.
     *
     * @param options - Per-call token/refresh options.
     * @returns The viewer's profile (`user` + `account`).
     * @throws {UnauthorizedError} on auth failure.
     * @sideEffect Performs an authenticated HTTP request.
     */
    public async getMe(options?: ProfileRequestOptions): Promise<UserProfile> {
        return this.send<UserProfile>('GET', PROFILE_ME_PATH, undefined, options);
    }

    /**
     * `PATCH /api/v1/users/me` — update the signed-in viewer's profile.
     *
     * @param input - The fields to update.
     * @param options - Per-call token/refresh options.
     * @returns The updated profile.
     * @throws {BadRequestError} on validation failure; {@link UnauthorizedError} on auth failure.
     * @sideEffect Performs an authenticated HTTP request.
     */
    public async patchMe(input: UserUpdateInput, options?: ProfileRequestOptions): Promise<UserProfile> {
        return this.send<UserProfile>('PATCH', PROFILE_ME_PATH, input, options);
    }

    /**
     * `DELETE /api/v1/users/me` — request deletion of the signed-in viewer's account (`202 Accepted`).
     *
     * @param options - Per-call token/refresh options.
     * @returns The accepted-deletion acknowledgement.
     * @throws {UnauthorizedError} on auth failure.
     * @sideEffect Performs an authenticated HTTP request.
     */
    public async deleteMe(options?: ProfileRequestOptions): Promise<DeleteAccountResult> {
        return this.send<DeleteAccountResult>('DELETE', PROFILE_ME_PATH, undefined, options);
    }

    /**
     * Resolve the current bearer token, forwarding `forceRefresh` to a callback {@link TokenSource}. A
     * callback that itself rejects/throws (e.g. mobile's "no session token available" guard) propagates
     * BEFORE any request is sent — the caller's own fail-fast policy, not this client's.
     */
    private async resolveToken(forceRefresh: boolean): Promise<string | undefined> {
        if (this.token === undefined) {
            return undefined;
        }

        return typeof this.token === 'function' ? this.token({ forceRefresh }) : this.token;
    }

    private async send<T>(
        method: 'GET' | 'PATCH' | 'DELETE',
        path: string,
        body: unknown,
        options?: ProfileRequestOptions,
    ): Promise<T> {
        const token = await this.resolveToken(options?.forceRefresh ?? false);
        const headers: Record<string, string> = { accept: 'application/json' };

        if (token !== undefined) {
            headers['authorization'] = `Bearer ${token}`;
        }

        if (body !== undefined) {
            headers['content-type'] = 'application/json';
        }

        const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
            method,
            headers,
            body: body !== undefined ? JSON.stringify(body) : undefined,
            ...(this.credentials !== undefined ? { credentials: this.credentials } : {}),
        });

        if (response.status === 401) {
            this.onUnauthorized?.();
        }

        if (!response.ok) {
            throw await this.toError(response);
        }

        // A no-content success, or a `202 Accepted` read as text first (matching the identity service's
        // `DELETE /api/v1/users/me`, which DOES return a JSON body on 202 — this only short-circuits a genuinely
        // empty body, e.g. a `204`).
        const text = await response.text();

        if (text.length === 0) {
            return undefined as T;
        }

        return JSON.parse(text) as T;
    }

    private async toError(response: Response): Promise<ProfileServiceClientError> {
        const payload = await response
            .json()
            .then((value: unknown) => value as ErrorPayload)
            .catch(() => ({}) as ErrorPayload);
        const message = payload.message ?? `Request failed: ${response.status}`;

        switch (response.status) {
            case 400:
                return new BadRequestError(message, payload.code);
            case 401:
                return new UnauthorizedError(message, payload.code);
            case 403:
                return new ForbiddenError(message, payload.code);
            case 404:
                return new NotFoundError(message, payload.code);
            default:
                return new UnexpectedResponseError(response.status, message);
        }
    }
}
