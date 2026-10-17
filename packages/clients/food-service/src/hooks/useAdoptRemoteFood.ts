import { useMutation } from '@tanstack/react-query';

import { useFoodServiceClient } from './foodServiceProvider.js';

/**
 * `POST /api/v1/foods/remote/adopt`: turn a picked remote hit into its catalog root (ADR-0055 point 10). The remote pick
 * runs it and then commits the line as any catalog pick (`@commise/features-recipes`'s `useLineCommit`).
 *
 * ⛔ `retry: false`, explicitly. The app's mutation default retries a `429` or a `503` (`@commise/query`'s
 * `shouldRetryMutation`), and an adopt can spend a source call, which is never repeated automatically (plan 002 R65,
 * control C5). A cook who chooses the hit again retries it, and the command is idempotent on the item.
 *
 * @returns The mutation; `mutateAsync(reference)` answers the root's id.
 */
export function useAdoptRemoteFood() {
    const client = useFoodServiceClient();

    return useMutation({
        mutationFn: (reference: string) => client.adoptRemoteFood(reference),
        retry: false,
    });
}
