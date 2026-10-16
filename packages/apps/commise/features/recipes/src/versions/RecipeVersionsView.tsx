'use client';

/**
 * @module @commise/features-recipes/versions — the SETTLED version history, composed once for web and mobile
 * (`docs/design/uiOverhaul/buildSpec.md` §6.6): the version list, the Preview modal and the Compare sheet over one
 * {@link useRecipeVersions} session.
 *
 * Orchestration: every piece it draws is a leaf pair that resolves per platform — plain `.tsx` with no native twin. The app keeps what
 * differs — the read boundary and its loading and failed states, and the way back: both hand the list `onBack`
 * (web adds `backHref` for a real link), so Back looks the same in the loading, failed and settled states.
 *
 * @pattern Composite — the list, the preview and the compare over one session
 */
import type { FC } from 'react';

import { RecipeVersionList } from './RecipeVersionList.js';
import { useRecipeVersions } from './useRecipeVersions.js';
import { VersionCompareView } from './VersionCompareView.js';
import { VersionPreviewModal } from './VersionPreviewModal.js';

/** Props for {@link RecipeVersionsView}. */
export interface RecipeVersionsViewProps {
    /** The recipe whose history to show. */
    readonly recipeId: string;
    /** Back to the recipe, drawn in the list's header; absent draws none. */
    readonly onBack?: () => void;
    /** Web: the recipe's address, so a modified click on Back still works. */
    readonly backHref?: string;
}

export const RecipeVersionsView: FC<RecipeVersionsViewProps> = ({ recipeId, onBack, backHref }) => {
    const { list, preview, compare } = useRecipeVersions({ recipeId });

    return (
        <>
            <RecipeVersionList
                {...list}
                {...(onBack === undefined ? {} : { onBack })}
                {...(backHref === undefined ? {} : { backHref })}
            />
            <VersionPreviewModal {...preview} />
            <VersionCompareView {...compare} />
        </>
    );
};
