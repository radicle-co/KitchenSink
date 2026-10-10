import { useMutation, useQueryClient } from '@tanstack/react-query';

import { foodServiceKeys } from '../queries.js';
import type { CreateAuthoredFoodInput } from '../types.js';
import { useFoodServiceClient } from './foodServiceProvider.js';
import { useFoodServiceSubject } from './useFoodServiceSubject.js';

/**
 * `POST /api/v1/foods/authored`: create one of the cook's own foods (plan 002 S5).
 *
 * Both outcomes clear the cook's progressive answers from the app's cache, whose database frame holds the cook's own
 * foods, so the next search finds the food: `created` made it, and `duplicate` names one the cache may not have held
 * (`docs/design/rowEditorOpenDecisions.md`, S5 list contract L4.6). They are RESET rather than invalidated: an
 * invalidated answer shows its old foods and then changes under the cook. The reset is not awaited, so the create does
 * not wait on a search.
 *
 * @returns The mutation; `mutate(input)` creates the food.
 */
export function useCreateAuthoredFood() {
    const client = useFoodServiceClient();
    const subject = useFoodServiceSubject();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (input: CreateAuthoredFoodInput) => client.createAuthoredFood(input),
        onSuccess: () => {
            void queryClient.resetQueries({ queryKey: foodServiceKeys.progressiveSearches(subject) });
        },
    });
}
