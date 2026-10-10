/**
 * `useUpdateProfile` — the mobile binding of the shared profile write (`PATCH /api/v1/users/me`):
 * `profileMutations(client).update()` from `@commise/features-account`, over the app's one identity client. Web binds
 * the same factory to its own client, so the two platforms send the same body and refresh the same read
 * (CODING_STANDARDS §14).
 *
 * DA10-c: goes through the typed `ProfileServiceClient` built by the shared {@link useProfileServiceClient}
 * factory, which owns the identity origin and the native token policy. A mutation accepts a CACHED token
 * (only the profile READ force-refreshes).
 *
 * @sideEffect The mutation sends an authenticated PATCH and invalidates the profile query.
 */
import { useMutation } from '@tanstack/react-query';
import { profileMutations } from '@commise/features-account';

import { useProfileServiceClient } from './useProfileServiceClient.js';

export function useUpdateProfile() {
    return useMutation(profileMutations(useProfileServiceClient()).update());
}
