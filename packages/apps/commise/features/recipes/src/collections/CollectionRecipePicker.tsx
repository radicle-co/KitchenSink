'use client';

/**
 * @module @commise/features-recipes/collections — the web add-recipes picker frame (the ADD half of T072 / FR-009; slice 5
 * of the UI overhaul, `docs/design/uiOverhaul/buildSpec.md` §5.3).
 *
 * A full-height `Sheet` titled "Add to {name}" (a 640 px dialog, 80% of the window tall, from 840): a sticky search field
 * in the sheet's toolbar, the body the host's read boundary renders in the scroll region, and a pinned **Done** (`check`,
 * primary, `lg`) that says what changed — "Done · 2 added, 1 removed", a zero part left out. Each toggle saves at once, so
 * × and Escape do what Done does: nothing is unsaved.
 *
 * It fetches nothing and holds no state. It stays mounted around whichever body arrives — the rows, a skeleton, a load
 * error — so the search field keeps its focus and Done stays reachable in every state. A polite live region, always
 * mounted, says "Added {title}" and "Removed {title}".
 *
 * Presentational: the frame of the picker; the host supplies the body and runs every request.
 *
 * @pattern Adapter over the design-system `Sheet`
 */
import { useMessages } from '@commise/i18n/react';
import { Button } from '@commise/ui/button';
import { LiveRegion } from '@commise/ui/live-region';
import { SearchField } from '@commise/ui/search-field';
import { Sheet } from '@commise/ui/sheet';
import { useId, type FC } from 'react';

import { fillTemplate } from '../format/fillTemplate.js';
import type { CollectionRecipePickerProps } from './detailModel.js';
import { collectionMessages } from './messages.js';
import { doneLabelOf } from './pickerModel.js';

export const CollectionRecipePicker: FC<CollectionRecipePickerProps> = ({
    open,
    onClose,
    collectionName,
    query,
    onQueryChange,
    summary,
    announcement,
    children,
}) => {
    const { picker } = useMessages(collectionMessages);
    const searchId = useId();

    return (
        <Sheet
            open={open}
            onOpenChange={(next) => {
                if (!next) {
                    onClose();
                }
            }}
            title={fillTemplate(picker.title, { name: collectionName })}
            closeLabel={picker.close}
            size="full"
            toolbar={{
                heading: <span className="text-overline uppercase text-ink-muted">{picker.toolbarHeading}</span>,
                controls: (
                    <SearchField
                        id={searchId}
                        label={picker.searchLabel}
                        labelVisibility="hidden"
                        clearLabel={picker.clearSearch}
                        placeholder={picker.searchPlaceholder}
                        value={query}
                        onChangeText={onQueryChange}
                    />
                ),
            }}
            footer={
                <Button icon="check" size="lg" width="fill" onPress={onClose}>
                    {doneLabelOf(summary, picker)}
                </Button>
            }
        >
            <LiveRegion
                politeness="polite"
                visuallyHidden
                {...(announcement === undefined ? {} : { occurrence: announcement.occurrence })}
            >
                {announcement?.text ?? ''}
            </LiveRegion>
            {children}
        </Sheet>
    );
};
