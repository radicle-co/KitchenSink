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
import type { UserProfile, UserUpdateInput } from '@kitchensink/schema-identity';

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
    };
}
