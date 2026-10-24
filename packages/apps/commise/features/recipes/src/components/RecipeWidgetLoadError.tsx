/**
 * @module @commise/features-recipes — the web load error of Home's "Recent recipes" block: under the real heading, "We
 * couldn't load your recent recipes." and **Try again** (`docs/design/uiOverhaul/buildSpec.md` §4.2 Load error). The
 * rest of Home still renders. With no retry the button is not drawn, never a dead one.
 */
import { useMessages } from '@commise/i18n/react';
import { Button } from '@commise/ui/button';
import type { FC } from 'react';

import { recipeMessages } from '../messages.js';
import type { RecipeWidgetLoadErrorProps } from './props.js';
import { RecipeWidgetCard } from './RecipeWidgetCard.js';

export const RecipeWidgetLoadError: FC<RecipeWidgetLoadErrorProps> = ({ onRetry, seeAll }) => {
    const { widgetTitle, home } = useMessages(recipeMessages);

    return (
        <RecipeWidgetCard title={widgetTitle} {...(seeAll === undefined ? {} : { seeAll })}>
            <div role="status" className="flex flex-col items-start gap-3">
                <p className="text-body text-ink-muted">{home.loadError}</p>
                {onRetry === undefined ? null : (
                    <Button variant="secondary" icon="rotateCcw" onPress={onRetry}>
                        {home.retry}
                    </Button>
                )}
            </div>
        </RecipeWidgetCard>
    );
};
