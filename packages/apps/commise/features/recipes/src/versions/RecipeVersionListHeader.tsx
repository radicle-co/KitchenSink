'use client';

/**
 * @module @commise/features-recipes — the header the web version history's LOADING and FAILED states share (D3, D13;
 * `docs/design/uiOverhaul/buildSpec.md` §6.6).
 *
 * The SAME `LargeTitleHeader` the settled list draws — the back control and the title — so the page does not move when
 * the history lands, and a failed read still has its way back in its usual place.
 *
 * Presentational: props → JSX. The header's words are the list's own. Its Back is the eyebrow from 840; below it the page's
 * pinned bar carries the same `back`, which the caller builds once (`versionBackOf`).
 */
import { useMessages } from '@commise/i18n/react';
import { LargeTitleHeader, type HeaderBack } from '@commise/ui/large-title-header';
import type { FC } from 'react';

import { recipeVersionMessages } from './messages.js';

/** The header, as the settled list draws it, minus the recipe subtitle that is not known yet. */
export const RecipeVersionListHeader: FC<{
    /** The H1's id (`VERSION_TITLE_ID`): the container's frame watches it. */
    readonly headingId: string;
    readonly back: HeaderBack | undefined;
}> = ({ headingId, back }) => {
    const { versionList } = useMessages(recipeVersionMessages);

    return (
        <LargeTitleHeader headingId={headingId} title={versionList.heading} {...(back === undefined ? {} : { back })} />
    );
};
