/**
 * @module @commise/features-recipes — the web first run of Home's "Recent recipes" block
 * (`docs/design/uiOverhaul/buildSpec.md` §4.2): one line, then **Add your first recipe**, **Paste ingredients** and the
 * ghost link **Or find one on Discover**. Pure: the host decides where each leads.
 */
import { useMessages } from '@commise/i18n/react';
import { Button } from '@commise/ui/button';
import { Icon } from '@commise/ui/icon';
import type { FC } from 'react';

import { recipeMessages } from '../messages.js';
import type { RecipeWidgetEmptyStateProps } from './props.js';

export const RecipeWidgetEmptyState: FC<RecipeWidgetEmptyStateProps> = ({ firstRun }) => {
    const { home } = useMessages(recipeMessages);

    return (
        <div className="flex flex-col items-start gap-3">
            <p className="text-body text-ink-muted">{home.recentEmptyBody}</p>
            {firstRun === undefined ? null : (
                <>
                    <div className="flex w-full flex-col gap-3 @regular/main:w-auto @regular/main:flex-row">
                        <Button icon="pencilLine" size="lg" width="fill" onPress={firstRun.onCreateRecipe}>
                            {home.firstRecipe}
                        </Button>
                        {firstRun.onPasteIngredients === undefined ? null : (
                            <Button
                                variant="secondary"
                                icon="clipboardPaste"
                                size="lg"
                                width="fill"
                                onPress={firstRun.onPasteIngredients}
                            >
                                {home.pasteIngredients}
                            </Button>
                        )}
                    </div>
                    <a
                        href={firstRun.discoverHref}
                        onClick={(event) => {
                            if (
                                firstRun.discoverHref === undefined ||
                                (event.button === 0 &&
                                    !event.metaKey &&
                                    !event.ctrlKey &&
                                    !event.shiftKey &&
                                    !event.altKey)
                            ) {
                                event.preventDefault();
                                firstRun.onFindOnDiscover();
                            }
                        }}
                        className="inline-flex min-h-11 items-center gap-2 rounded-full px-3 text-label text-action-text hover:bg-ink/6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
                    >
                        <Icon name="compass" size={20} />
                        {home.findOnDiscover}
                    </a>
                </>
            )}
        </div>
    );
};
