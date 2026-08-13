/**
 * `ProfileServiceClient` (DA10-c) — the typed client for the Commise identity/account profile endpoints
 * (`GET`/`PATCH`/`DELETE /api/v1/users/me`, plus `POST /api/v1/users/me/avatar/presign`), given the SAME shape as
 * `@kitchensink/recipe-service-client`'s
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
 * `@kitchensink/schema-identity` (a generated leaf whose only dependency is zod) exists to remove it.
 *
 * ⚠️ AND IT NOW RUNS THAT PACKAGE'S ZOD, WHICH IT PREVIOUSLY ONLY IMPORTED TYPES FROM. Until this change every
 * method's sole exit was `return JSON.parse(text) as T` — so `getMe`, `patchMe` and `deleteMe` ASSERTED
 * `UserProfile` / `DeleteUserMeResponse` and verified nothing. The old header's closing line said the runtime
 * zod was available "so a caller that wants to validate this boundary can do so", which is the shape of the
 * problem ADR-0014 names: the contract was present, importable, and never executed, so a response that had
 * drifted surfaced as a mystery `undefined` inside a React component instead of a loud failure at the edge
 * naming the field. Every boundary here is now parsed — inbound AND outbound — against the same definitions
 * the identity service validates with.
 *
 * Platform-specific side effects (e.g. the web app's redirect-to-sign-in on a `401`, or a `credentials`
 * policy) are NOT baked in here — they are injected via {@link ProfileServiceClientOptions.onUnauthorized}
 * / `.credentials`, so this class stays platform-agnostic and is usable, unmodified, from both the web
 * server/client boundary and the mobile app.
 */
// The RUNTIME zod, not just the types: the same definitions the identity service validates with, so this
// boundary is CHECKED in both directions rather than asserted (§15.2 rules 2 and 4, ADR-0014).
import {
    apiErrorSchema,
    avatarPresignQuerySchema,
    avatarPresignResponseSchema,
    deleteUserMeResponseSchema,
    patchUserMeRequestSchema,
    userProfileSchema,
} from '@kitchensink/schema-identity';
import type {
    ApiErrorBody,
    AvatarPresignQuery,
    AvatarPresignResponse,
    DeleteUserMeResponse,
    UserProfile,
    UserUpdateInput,
} from '@kitchensink/schema-identity';
import type { z } from 'zod';

import {
    BadRequestError,
    ForbiddenError,
    InvalidRequestError,
    NotFoundError,
    ProfileServiceClientError,
    UnauthorizedError,
    UnexpectedResponseError,
} from './errors.js';
import { reportContractSkewOnce } from './contractSkew.js';

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
 * `POST /api/v1/users/me/avatar/presign` — where the viewer's avatar upload is authorized.
 *
 * Under {@link PROFILE_ME_PATH} because it is served by the same `me` resource
 * (`packages/services/identity/src/users/avatar-upload.controller.ts`), and derived from that constant so the two
 * cannot drift apart.
 */
export const AVATAR_PRESIGN_PATH = `${PROFILE_ME_PATH}/avatar/presign`;

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
    /**
     * Where a CONTRACT SKEW warning goes; defaults to `console.warn`.
     *
     * Injectable for the same reason `fetch` is — a test must be able to observe the warning without a global spy —
     * and because a host with structured logging (the web app's server runtime) may want it routed there. See
     * `./contractSkew.ts` for why a skew WARNS rather than refusing.
     *
     * @sideEffect Whatever the caller's sink does.
     */
    readonly warn?: (message: string) => void;
}

export class ProfileServiceClient {
    private readonly baseUrl: string;
    private readonly token: TokenSource | undefined;
    private readonly fetchImpl: typeof fetch;
    private readonly credentials: RequestCredentials | undefined;
    private readonly onUnauthorized: (() => void) | undefined;
    private readonly warn: (message: string) => void;

    /** @param options - Base URL, optional token, an optional `fetch` double, credentials, and 401 hook. */
    public constructor(options: ProfileServiceClientOptions) {
        this.baseUrl = options.baseUrl.replace(/\/+$/, '');
        this.token = options.token;
        this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
        this.credentials = options.credentials;
        this.onUnauthorized = options.onUnauthorized;
        this.warn =
            options.warn ??
            ((message: string): void => {
                console.warn(message);
            });
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
        return this.send('GET', PROFILE_ME_PATH, userProfileSchema, undefined, options);
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
        // The OUTBOUND parse matters more here than anywhere else in this client, because
        // `patchUserMeRequestSchema` is a `z.strictObject`: the identity service REJECTS an unknown key on this
        // route with a `400` rather than stripping it. So a caller that misspells `displayName` used to spend a
        // round trip to learn that, and — before the schema was strict — would have got a `200` with no write.
        // Running the same strict schema here fails at the call site that built the body, with the field path.
        const body = this.request('patchMe', patchUserMeRequestSchema, input);

        return this.send('PATCH', PROFILE_ME_PATH, userProfileSchema, body, options);
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
        return this.send('DELETE', PROFILE_ME_PATH, deleteUserMeResponseSchema, undefined, options);
    }

    /**
     * `POST /api/v1/users/me/avatar/presign` — authorize a direct-to-S3 avatar upload.
     *
     * Image bytes never traverse the identity service: it signs a short-lived `PUT` bound to the exact `type` and
     * `size`, so the caller PUTs the blob itself and then persists `publicUrl` via {@link patchMe}. Presigning is on
     * THIS client — rather than in each app — because this is the funnel that parses both directions against
     * `@kitchensink/schema-identity` and reports contract skew; mobile previously reached this endpoint through its
     * own `services/api.ts` transport, where neither applied (GR-017 §17-b.5).
     *
     * @param query - The blob's real MIME type and exact byte length (`blob.size`), which S3 enforces against the
     *   signature. The allowed-type list and the byte cap are the CONTROLLER's, deliberately not restated in the
     *   schema, so an unlisted type or an oversized image is a {@link BadRequestError} rather than a local rejection.
     * @param options - Per-call token/refresh options.
     * @returns The presigned `PUT` URL and the durable public URL the object will be readable at.
     * @throws {InvalidRequestError} when the type/size cannot satisfy the published contract — no request is sent;
     *   {@link BadRequestError} when the controller refuses the type or size; {@link UnauthorizedError} on auth
     *   failure.
     * @sideEffect Performs an authenticated HTTP request.
     */
    public async presignAvatar(
        query: AvatarPresignQuery,
        options?: ProfileRequestOptions,
    ): Promise<AvatarPresignResponse> {
        const { type, size } = this.request('presignAvatar', avatarPresignQuerySchema, query);
        // `size` is re-stringified because a query string is strings on the wire; `avatarPresignQuerySchema` coerces
        // it back to a number on the service's side of the same definition. `URLSearchParams` does the encoding — a
        // MIME type's `/` must not reach the query raw.
        const search = new URLSearchParams({ type, size: String(size) });

        return this.send(
            'POST',
            `${AVATAR_PRESIGN_PATH}?${search.toString()}`,
            avatarPresignResponseSchema,
            undefined,
            options,
        );
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

    /**
     * Issue an authenticated request and PARSE the response against `schema`.
     *
     * Parse-don't-validate at the wire boundary. This method's entire success path used to be
     * `return JSON.parse(text) as T`, which asserts a shape instead of establishing one — so a drifted identity
     * response reached a React component as a missing field rather than failing here, at the edge, naming it.
     *
     * The empty-body short-circuit is kept and is NOT a hole: it exists for a genuinely bodyless success (a
     * `204`), and none of this client's three routes has one — `DELETE /api/v1/users/me` answers `202` WITH a
     * body, which is exactly why `deleteUserMeResponseSchema` exists. A `204` on any of them would be a contract
     * change, and the `undefined` it produces is what the method's own return type would then have to admit.
     *
     * @param method - HTTP method.
     * @param path - The endpoint path.
     * @param schema - The published response schema for this endpoint's success body.
     * @param body - Optional JSON body (already parsed against its request schema by the caller).
     * @param options - Per-call token/refresh options.
     * @returns The VALIDATED response body.
     * @throws the typed error for the status, or a `ZodError` when the body does not match the published
     *   contract — a drift the caller should surface, not swallow.
     * @sideEffect Performs an authenticated HTTP request.
     */
    private async send<S extends z.ZodType>(
        method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
        path: string,
        schema: S,
        body: unknown,
        options?: ProfileRequestOptions,
    ): Promise<z.output<S>> {
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

        // DRIFT LAYER 3, consumer half (GR-017 §17-b.5). Fired here — after a response, from the ONE funnel every
        // method goes through — rather than from the constructor, because web mints a client per hook call and per
        // server-rendered request, so a constructor probe would put `/health` on the sign-in path. Latched once per
        // origin per process, fire-and-forget, and it cannot throw: see `./contractSkew.ts`.
        //
        // ⚠️ Deliberately NOT gated on `response.ok`. A skew is MORE likely to surface as a failing request than a
        // succeeding one — a client sending a field the deployed service no longer accepts gets a 400 — so gating on
        // success would mute the signal in exactly the case it is for.
        reportContractSkewOnce({ baseUrl: this.baseUrl, fetch: this.fetchImpl, warn: this.warn });

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
            return undefined as z.output<S>;
        }

        return schema.parse(JSON.parse(text)) as z.output<S>;
    }

    /**
     * Parse an OUTBOUND body against the request schema the identity service publishes.
     *
     * @param operation - The method name, for the error message.
     * @param schema - The published request schema for this endpoint.
     * @param body - The caller's body.
     * @returns The parsed body.
     * @throws {InvalidRequestError} when it does not satisfy the published contract — deliberately not a
     *   {@link BadRequestError}, which means "the server said 400" and is a different fault with a different fix.
     */
    private request<S extends z.ZodType>(operation: string, schema: S, body: unknown): z.output<S> {
        const parsed = schema.safeParse(body);

        if (!parsed.success) {
            throw new InvalidRequestError(operation, parsed.error);
        }

        return parsed.data as z.output<S>;
    }

    /**
     * Map a non-success response to the typed error for its status, reading its body through the envelope the
     * identity service publishes.
     *
     * The local `interface ErrorPayload { message?; code? }` this replaces was a second declaration of
     * `apiErrorSchema`, and it had already DRIFTED in two directions the type system could not see: it made both
     * wire-REQUIRED fields optional, and it dropped `details` entirely — the field a validation rejection uses to
     * carry per-field constraint messages, i.e. the one thing a form needs to show the user which input is wrong.
     *
     * `safeParse` with a fallback, not `parse`: a non-2xx body is often not our envelope at all (the shared ALB
     * serves an HTML page for `502`/`503`/`504` during every deploy, ADR-0003), and throwing from the
     * error-mapping path would replace a recoverable typed error with a parse failure. An unrecognized body
     * degrades to mapping by status alone, which the switch below still does correctly.
     */
    private async toError(response: Response): Promise<ProfileServiceClientError> {
        const raw: unknown = await response.json().catch(() => undefined);
        const parsed = apiErrorSchema.safeParse(raw);
        const payload: Partial<ApiErrorBody> = parsed.success ? parsed.data : {};
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
