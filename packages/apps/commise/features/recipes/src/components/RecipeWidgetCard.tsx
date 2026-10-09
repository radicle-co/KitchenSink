/**
 * @module @commise/features-recipes — the web shell of Home's "Recent recipes" block: an H2 heading row with "See all"
 * at its end (`docs/design/uiOverhaul/buildSpec.md` §4.2), then the block's content. It carries no surface of its own
 * — the heading sits on the page canvas and the cards are the only boxes (§1.6 "No box in a box").
 */
import { useMessages } from '@commise/i18n/react';
import type { FC } from 'react';

import { recipeMessages } from '../messages.js';
import type { RecipeWidgetCardProps } from './props.js';

/**
 * Whether a click should be handed to `onPress` rather than followed: a plain primary click only.
 *
 * @param event - The click.
 * @returns `true` for a plain primary click.
 */
function isPlainClick(event: React.MouseEvent<HTMLAnchorElement>): boolean {
    return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

export const RecipeWidgetCard: FC<RecipeWidgetCardProps> = ({ title, seeAll, children }) => {
    const { home } = useMessages(recipeMessages);

    return (
        <section aria-label={title} className="flex flex-col gap-4">
            <div className="flex items-center justify-between gap-3">
                <h2 className="text-section-title text-ink">{title}</h2>
                {seeAll === undefined ? null : (
                    <a
                        href={seeAll.href}
                        aria-label={home.seeAllLabel}
                        onClick={(event) => {
                            if (seeAll.href === undefined || isPlainClick(event)) {
                                event.preventDefault();
                                seeAll.onPress();
                            }
                        }}
                        className="inline-flex min-h-11 shrink-0 items-center rounded-full px-3 text-label text-action-text hover:bg-ink/6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
                    >
                        {home.seeAll}
                    </a>
                )}
            </div>
            {children}
        </section>
    );
};
