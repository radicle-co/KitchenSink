import type { UserProfile, UserUpdateInput } from '@kitchensink/identity-service';

/**
 * The single authoritative path for updating the current user's profile.
 *
 * The identity service exposes this as `@Patch('me')` under `@Controller('v1/users')`
 * (packages/services/identity/src/users/users.controller.ts) — i.e. `PATCH /v1/users/me`,
 * body validated by `PatchUserMeBodyDto` (`displayName?`, `avatarUrl?`). There is deliberately
 * no `/v1/profiles/me` route; the web and mobile clients had drifted to different paths, and
 * this constant is now the one place either platform encodes it.
 */
export const PROFILE_ME_PATH = '/v1/users/me';

/**
 * Minimal transport contract the shared profile client needs. Each platform adapts its own
 * HTTP layer (web `buildApiClient`, mobile `apiRequest`) to this shape — authentication,
 * base-path handling, and error mapping stay platform-specific; only the endpoint + method +
 * request/response contract is shared here.
 */
export interface ProfileTransport {
    patch<T>(path: string, body: unknown): Promise<T>;
}

/**
 * Update the current user's profile against `PATCH /v1/users/me`.
 *
 * @sideEffect Issues an authenticated HTTP request via the supplied transport.
 */
export function updateProfile(transport: ProfileTransport, input: UserUpdateInput): Promise<UserProfile> {
    return transport.patch<UserProfile>(PROFILE_ME_PATH, input);
}
