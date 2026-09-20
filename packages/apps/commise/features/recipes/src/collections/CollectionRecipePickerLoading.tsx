/**
 * @module @commise/features-recipes — the web recipe-picker body while the caller's candidate recipes load, rendered
 * inside the `CollectionRecipePicker` frame by the composing app's read boundary.
 */
import { useMessages } from '@commise/i18n/react';
import type { FC } from 'react';

import { collectionMessages } from './messages.js';

/** The presentational picker body while the candidates load. */
export const CollectionRecipePickerLoading: FC = () => {
    const { picker } = useMessages(collectionMessages);

    // The label is the region's CONTENT, not only its `aria-label`: an empty `role="status"` node is
    // zero-height (nothing for a sighted viewer, and Playwright resolves it as `hidden`) AND silent,
    // because a live region announces its CONTENT, not its label.
    return (
        <p role="status" aria-label={picker.loadingLabel} className="text-body-md text-slate">
            {picker.loadingLabel}
        </p>
    );
};
