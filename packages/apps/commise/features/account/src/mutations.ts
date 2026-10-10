/**
 * `mutationOptions` factory module for `@commise/features-account` — the write-side sibling of `queries.ts`. The one
 * profile write both apps make (`PATCH /api/v1/users/me`) is declared here once, so web's display-name sheet and
 * mobile's display name and photo send the same thing and refresh the same read (`profileServiceKeys.me`, which the
 * header, the sidebar's profile row and the Home greeting all read).
 *
 * Each app binds it to its own client — web's mints a token per call from Clerk's session, mobile's from the native
 * token template — exactly as each binds `profileQueries`.
 *
 * @pattern Factory — `mutationOptions` built from a configured client; the mutation it yields is the Command
 */
import { mutationOptions } from '@tanstack/react-query';
import { SETTINGS_DEFAULTS } from '@kitchensink/schema-identity';
import type {
    PatchUserSettingsRequest,
    UserProfile,
    UserSettings,
    UserUpdateInput,
} from '@kitchensink/schema-identity';

import type { ProfileServiceClient } from './profileServiceClient.js';
import { profileServiceKeys } from './queries.js';

/**
 * `mutationOptions` factories for the viewer-profile writes.
 *
 * @param client - The configured {@link ProfileServiceClient} the mutation calls through.
 * @returns One builder per write.
 */
export function profileMutations(client: ProfileServiceClient) {
    return {
        /**
         * `PATCH /api/v1/users/me` with the given fields; on success the profile read is invalidated, so every surface
         * showing the name or photo refetches.
         *
         * @sideEffect The mutation sends an authenticated PATCH and invalidates the profile query.
         */
        update: () =>
            mutationOptions<UserProfile, Error, UserUpdateInput>({
                mutationFn: (body) => client.patchMe(body),
                onSuccess: (_profile, _body, _onMutateResult, context) =>
                    context.client.invalidateQueries({ queryKey: profileServiceKeys.me }),
            }),

        /**
         * `PATCH /api/v1/users/me/settings` with the settings to change, applied OPTIMISTICALLY (ADR-0059).
         *
         * The cache takes the new value at once, so a switch answers the tap. A failed write rolls it back to the
         * snapshot taken before the write, and settling either way refetches, so the cache ends on what the server
         * holds. Offline, the mutation pauses and resumes; a caller never branches on connectivity.
         *
         * The in-flight read is cancelled first: a response that was already on its way would land after the
         * optimistic value and put the old one back.
         *
         * @sideEffect Writes the settings cache, sends an authenticated PATCH, and refetches settings on settle.
         */
        patchSettings: () =>
            mutationOptions<
                UserSettings,
                Error,
                PatchUserSettingsRequest,
                { readonly previous: UserSettings | undefined }
            >({
                mutationFn: (body) => client.patchSettings(body),
                onMutate: async (body, context) => {
                    await context.client.cancelQueries({ queryKey: profileServiceKeys.settings });

                    const previous = context.client.getQueryData<UserSettings>(profileServiceKeys.settings);

                    context.client.setQueryData<UserSettings>(profileServiceKeys.settings, {
                        ...(previous ?? SETTINGS_DEFAULTS),
                        ...body,
                    });

                    return { previous };
                },
                onError: (_error, _body, onMutateResult, context) => {
                    // `setQueryData(key, undefined)` is a no-op, so a write that started from the placeholder rolls
                    // back to the defaults the placeholder was showing.
                    context.client.setQueryData<UserSettings>(
                        profileServiceKeys.settings,
                        onMutateResult?.previous ?? SETTINGS_DEFAULTS,
                    );
                },
                onSettled: (_settings, _error, _body, _onMutateResult, context) =>
                    context.client.invalidateQueries({ queryKey: profileServiceKeys.settings }),
            }),
    };
}
