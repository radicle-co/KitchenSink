'use client';

/**
 * Loading boundary for the recipe-editor route segment (`/[locale]/recipes/[id]/edit`). Its parent segment's boundary is the
 * recipe page's skeleton, which is the wrong shape for the editor, whose sections depend on the recipe; so it draws the
 * shared `LoadingNotice` (specSharedSystem.md §18). The label comes from a client hook, hence `'use client'`.
 */
import { recipeLoadMessages } from '@commise/features-recipes/detail';
import { useMessages } from '@commise/i18n/react';
import { LoadingNotice } from '@commise/ui/loading-notice';

export default function RecipeEditLoading(): React.JSX.Element {
    const copy = useMessages(recipeLoadMessages);

    return <LoadingNotice label={copy.loadingLabel} />;
}
