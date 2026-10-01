/**
 * @module @commise/features-recipes — the web recipe-picker body when the caller's candidate recipes failed to load,
 * rendered inside the `CollectionRecipePicker` frame by the composing app's read boundary. Its Retry label is
 * `ocean-dark`, not `seafoam` — see the frame module for that contrast rule.
 */
import { useMessages } from '@commise/i18n/react';
import type { FC } from 'react';

import { pickerStateCard } from './collectionRecipePickerStyles.js';
import { collectionMessages } from './messages.js';
import type { CollectionRecipePickerLoadErrorProps } from './model.js';

/** The presentational picker body when the candidates failed to load. */
export const CollectionRecipePickerLoadError: FC<CollectionRecipePickerLoadErrorProps> = ({ onRetry }) => {
    const { picker } = useMessages(collectionMessages);

    return (
        <div role="alert" className={pickerStateCard}>
            <p className="font-medium text-charcoal">{picker.errorTitle}</p>
            <button
                type="button"
                onClick={onRetry}
                className="mt-3 rounded-full px-4 py-2 text-body-sm font-medium text-ocean-dark transition hover:bg-seafoam/10"
            >
                {picker.retry}
            </button>
        </div>
    );
};
