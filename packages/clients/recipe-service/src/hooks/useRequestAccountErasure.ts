import { useMutation } from '@tanstack/react-query';

import type { ErasureRequest } from '../types.js';
import { useRecipeServiceClient } from './recipeServiceProvider.js';

/**
 * `POST /api/v1/account/erasure` — request IRREVERSIBLE GDPR account erasure.
 *
 * The variables argument is REQUIRED (it was optional): `confirmationPhrase` is the intent gate, so a
 * `mutate()` with nothing to confirm could only ever have produced a `400`. Both call sites — web's
 * `AccountEraseForm` and mobile's `AccountDangerZone` — already pass the collected phrase and donate election.
 */
export function useRequestAccountErasure() {
    const client = useRecipeServiceClient();

    return useMutation({
        mutationFn: (request: ErasureRequest) => client.requestAccountErasure(request),
    });
}
