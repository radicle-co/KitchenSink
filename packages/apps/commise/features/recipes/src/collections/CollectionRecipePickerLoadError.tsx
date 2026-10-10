/**
 * @module @commise/features-recipes — the web add-recipes picker body when the caller's recipes failed to load, rendered
 * inside the `CollectionRecipePicker` frame by the composing app's read boundary: the failure and a Try again, with the
 * frame (the search field, Done) still around it.
 *
 * Presentational: it sends nothing; the host retries.
 */
import { useMessages } from '@commise/i18n/react';
import { Button } from '@commise/ui/button';
import type { FC } from 'react';

import { collectionMessages } from './messages.js';
import type { CollectionRecipePickerLoadErrorProps } from './model.js';

export const CollectionRecipePickerLoadError: FC<CollectionRecipePickerLoadErrorProps> = ({ onRetry }) => {
    const { picker } = useMessages(collectionMessages);

    return (
        <div role="alert" className="flex flex-col items-start gap-3 py-6">
            <p className="text-body text-ink">{picker.errorTitle}</p>
            <Button variant="secondary" icon="rotateCcw" onPress={onRetry}>
                {picker.retry}
            </Button>
        </div>
    );
};
