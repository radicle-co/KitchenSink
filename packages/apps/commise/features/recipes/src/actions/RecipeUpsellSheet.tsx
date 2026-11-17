'use client';

/**
 * @module @commise/features-recipes/actions — the web Premium sheet for "Private" in the recipe editor (build spec §6.4,
 * §7.7 item 2). A free-tier cook who cannot have Private is told the plain fact for their case (every slot used, or a
 * recipe from a public web page; `variant`) and offered **See Premium** and **Not now**: both secondary `md` buttons, equal in size and weight, side by side, nothing
 * pre-selected (DSA Art. 25: it is true, and it does not distort the choice). The subscription surface is not built yet
 * (010), so the host closes the sheet on See Premium. The twin of `CollectionUpsellSheet`; the detail menu's Make private
 * reuses this one (D10).
 *
 * Presentational: it sends nothing; the host decides what follows.
 *
 * @pattern Adapter over the design-system `Sheet`
 */
import { SUBSCRIPTION_ENTRY_POINTS_ON } from '@commise/features-account';
import { useMessages } from '@commise/i18n/react';
import { Button } from '@commise/ui/button';
import { Sheet } from '@commise/ui/sheet';
import type { FC } from 'react';

import { fillTemplate } from '@commise/i18n';
import { recipeActionMessages } from './messages.js';
import type { RecipeUpsellSheetProps } from './model.js';

/** The web Premium sheet for a private recipe. */
export const RecipeUpsellSheet: FC<RecipeUpsellSheetProps> = ({ open, variant, onOpenChange, onSeePremium }) => {
    const { upsell } = useMessages(recipeActionMessages);
    const words = upsell.noSlot;
    const body = fillTemplate(words.body, { total: variant.total });

    return (
        <Sheet
            open={open}
            onOpenChange={onOpenChange}
            title={words.title}
            closeLabel={upsell.close}
            size="content"
            footer={
                <div className="flex gap-3">
                    {SUBSCRIPTION_ENTRY_POINTS_ON ? (
                        <div className="flex-1">
                            <Button variant="secondary" icon="star" width="fill" onPress={onSeePremium}>
                                {upsell.seePremium}
                            </Button>
                        </div>
                    ) : null}
                    <div className="flex-1">
                        <Button variant="secondary" icon="x" width="fill" onPress={() => onOpenChange(false)}>
                            {upsell.notNow}
                        </Button>
                    </div>
                </div>
            }
        >
            <p className="text-body text-ink-muted">{body}</p>
        </Sheet>
    );
};
