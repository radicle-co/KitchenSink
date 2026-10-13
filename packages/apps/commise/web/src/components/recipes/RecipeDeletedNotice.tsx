'use client';

/**
 * My recipes' "Recipe deleted" (owner decision 2026-10-13, 4): said once, on the page a delete lands on, from the flag the
 * detail page put in the address (`recipesAfterDeleteHref`). It draws nothing; the words are the snackbar's.
 */
import { recipeActionMessages } from '@commise/features-recipes';
import { useMessages } from '@commise/i18n/react';
import type { FC } from 'react';

import { useAddressNotice } from '@/hooks/useAddressNotice';

import { RECIPE_DELETED_PARAM, arrivedAfterDelete } from '@/components/recipes/recipesAfterDeleteHref';

/** Says "Recipe deleted" when a delete landed the cook here. */
export const RecipeDeletedNotice: FC = () => {
    const { detailActions } = useMessages(recipeActionMessages);

    useAddressNotice(RECIPE_DELETED_PARAM, (value) =>
        arrivedAfterDelete(value) ? detailActions.recipeDeleted : undefined,
    );

    return null;
};
