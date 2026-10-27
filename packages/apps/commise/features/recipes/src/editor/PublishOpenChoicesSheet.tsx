'use client';

/**
 * @module @commise/features-recipes/editor — `PublishOpenChoicesSheet` (web): what the editor asks before publishing a
 * recipe whose lines have no food yet (`docs/design/uiRefreshWorkshop5/redesignCanvas/ingredientMatching.md`, R23).
 * Publishing stays allowed. The sheet says the open lines are saved as written and do not count toward nutrition, names
 * a line still being checked, and says how many lines count; Choose now and Publish anyway are the two ways on.
 *
 * On the design-system `Sheet`, not `ConfirmDialog`: that primitive is for a destructive step, and publishing is not one.
 * At narrow the two actions stack, Publish anyway LAST, nearest the thumb; from the `nav` width they share a row, the
 * primary at its end. The DOM order is the visual order at every width, so Tab and the eye agree (U11).
 *
 * Choose now hands off AFTER the sheet is gone (`onDismissed`), not on the press: the host opens the first open line and asks
 * it for focus, and the sheet's own close then returns focus to its opener (Publish). Handing off on the press lost that
 * race and left the cook on Publish. The state is only the intent to hand off, so the component still renders props.
 *
 * Presentational: props in, markup out; the words are `openChoicesCopyOf`'s. The native leaf is
 * `./PublishOpenChoicesSheet.native.tsx`.
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import { Button } from '@commise/ui/button';
import { Sheet } from '@commise/ui/sheet';
import { useState, type FC } from 'react';

import { editorMessages } from './messages.js';
import { openChoicesCopyOf } from './openChoicesCopy.js';
import type { PublishOpenChoicesSheetProps } from './publishOpenChoicesSheetProps.js';

/** The publish-with-open-choices sheet. */
export const PublishOpenChoicesSheet: FC<PublishOpenChoicesSheetProps> = ({
    open,
    facts,
    onChooseNow,
    onPublishAnyway,
    onOpenChange,
}) => {
    const copy = openChoicesCopyOf(facts, useMessages(editorMessages), useLocale());
    const [choosing, setChoosing] = useState(false);

    return (
        <Sheet
            open={open}
            onOpenChange={onOpenChange}
            onDismissed={() => {
                if (choosing) {
                    setChoosing(false);
                    onChooseNow();
                }
            }}
            title={copy.title}
            closeLabel={copy.close}
            size="content"
            footer={
                <div className="flex flex-col gap-3 nav:flex-row nav:justify-end">
                    <Button
                        variant="secondary"
                        icon="list"
                        width="fill"
                        onPress={() => {
                            setChoosing(true);
                            onOpenChange(false);
                        }}
                    >
                        {copy.chooseNow}
                    </Button>
                    <Button icon="check" width="fill" onPress={onPublishAnyway}>
                        {copy.publishAnyway}
                    </Button>
                </div>
            }
        >
            <div className="flex flex-col gap-3">
                <p className="text-body text-ink">{copy.body}</p>
                {copy.checking !== undefined && <p className="text-list text-ink-muted">{copy.checking}</p>}
                <p className="text-list text-ink-muted">{copy.later}</p>
            </div>
        </Sheet>
    );
};
