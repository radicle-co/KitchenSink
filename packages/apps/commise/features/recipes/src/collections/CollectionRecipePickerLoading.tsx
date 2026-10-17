/**
 * @module @commise/features-recipes — the web add-recipes picker body while the caller's recipes load, rendered inside the
 * `CollectionRecipePicker` frame by the composing app's read boundary: a status that says what is loading, over six
 * skeleton rows the height of a real row (`docs/design/uiOverhaul/buildSpec.md` §5.3), so the list does not jump when the
 * rows arrive.
 *
 * Presentational: the picker's loading body.
 */
import { useMessages } from '@commise/i18n/react';
import type { FC } from 'react';

import { collectionMessages } from './messages.js';

/** How many skeleton rows the loading body draws. */
const SKELETON_ROWS = 6;

export const CollectionRecipePickerLoading: FC = () => {
    const { picker } = useMessages(collectionMessages);

    // The label is the region's CONTENT, not only its `aria-label`: an empty status is zero-height and silent, because a
    // live region announces its CONTENT, not its label.
    return (
        <div role="status" aria-label={picker.loadingLabel} className="flex flex-col gap-2">
            <p className="text-meta text-ink-muted">{picker.loadingLabel}</p>
            <div aria-hidden="true" className="flex flex-col">
                {Array.from({ length: SKELETON_ROWS }, (_, index) => (
                    <div key={index} className="flex min-h-16 items-center gap-3 px-2 py-2">
                        <div className="size-12 shrink-0 animate-pulse rounded-md bg-line-divider motion-reduce:animate-none" />
                        <div className="flex flex-1 flex-col gap-2">
                            <div className="h-4 w-2/3 animate-pulse rounded-sm bg-line-divider motion-reduce:animate-none" />
                            <div className="h-3 w-1/3 animate-pulse rounded-sm bg-line-divider motion-reduce:animate-none" />
                        </div>
                        <div className="size-7 shrink-0 animate-pulse rounded-full bg-line-divider motion-reduce:animate-none" />
                    </div>
                ))}
            </div>
        </div>
    );
};
