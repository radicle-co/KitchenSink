/**
 * `useSuspenseUserProfile` — the SUSPENSE read of the signed-in viewer's profile.
 *
 * ⛔ ITS OWN FILE because the repo allows ONE hook per file, and that rule earns its keep here: the
 * non-suspense `useUserProfile` next door carries an `enabled` gate this one CANNOT have, and two hooks
 * sharing a file is how a caller reaches for the wrong one.
 */
import { profileQueries } from '@commise/features-account';
import { useSuspenseQuery } from '@tanstack/react-query';

import { useProfileServiceClient } from './useProfileServiceClient.js';

/**
 * Read the viewer's profile, suspending until it settles.
 *
 * ⛔ NO `enabled` GATE, AND THAT IS NOT AN OMISSION. A suspense read cannot be disabled — a disabled one has
 * no data and never settles, so it would suspend forever. The signed-in gate is STRUCTURAL instead:
 * `AuthGate` renders its children only in the `authenticated` case, and every consumer of this hook sits
 * inside it. `useUserProfile`'s `enabled: Boolean(isSignedIn)` is belt-and-braces over that same structure.
 *
 * ⚠️ Both hooks resolve the SAME `profileQueries(client).me({ forceRefresh: true })` options, so they share
 * one cache entry and one `staleTime` — they are two ways to read one query, never two queries.
 */
export function useSuspenseUserProfile() {
    const client = useProfileServiceClient();

    return useSuspenseQuery(profileQueries(client).me({ forceRefresh: true }));
}
