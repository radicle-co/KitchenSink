'use client';

/**
 * @module @commise/features-recipes — the header the web version history's LOADING and FAILED states share (D3, D13;
 * `docs/design/uiOverhaul/buildSpec.md` §6.6).
 *
 * The SAME `LargeTitleHeader` the settled list draws — the back control and the title — so the page does not move when
 * the history lands, and a failed read still has its way back in its usual place.
 *
 * Presentational: props → JSX. The header's words are the list's own.
 */
import { useMessages } from '@commise/i18n/react';
import { LargeTitleHeader } from '@commise/ui/large-title-header';
import { useId, type FC } from 'react';

import { recipeVersionMessages } from './messages.js';

/** The header, as the settled list draws it, minus the recipe subtitle that is not known yet. */
export const RecipeVersionListHeader: FC<{
    readonly onBack?: (() => void) | undefined;
    readonly backHref?: string | undefined;
}> = ({ onBack, backHref }) => {
    const { versionList } = useMessages(recipeVersionMessages);
    const headingId = useId();

    return (
        <LargeTitleHeader
            headingId={headingId}
            title={versionList.heading}
            {...(onBack === undefined
                ? {}
                : {
                      back: {
                          label: versionList.backToRecipe,
                          parent: versionList.backToRecipe,
                          onPress: onBack,
                          ...(backHref === undefined ? {} : { href: backHref }),
                      },
                  })}
        />
    );
};
