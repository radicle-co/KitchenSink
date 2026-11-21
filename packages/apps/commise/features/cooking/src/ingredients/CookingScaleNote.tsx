/**
 * @module CookingScaleNote — the web scale note under a step: a muted info glyph and the sentence that says the steps
 * give amounts for another serving count, in the small muted type that marks it as not part of the step. While the
 * screen gives it `onOpen`, one quiet button under it opens the ingredients. It holds no state, and it has no live
 * region because it arrives with the step.
 *
 * Presentational: props → JSX. The native twin is `CookingScaleNote.native.tsx`, on the same props.
 */
import { Button } from '@commise/ui/button';
import { Icon } from '@commise/ui/icon';
import type { FC } from 'react';

import { TWO_COLUMN } from '../cookingLayout.js';

import type { CookingScaleNoteProps } from './cookingScaleNoteProps.js';

/** The web scale note. */
export const CookingScaleNote: FC<CookingScaleNoteProps> = ({ note, openLabel, onOpen }) => (
    <div role="note" className="flex flex-col items-start gap-2">
        <div className="flex items-start gap-2">
            <Icon name="info" size={16} tone="inkMuted" />
            <p className="text-meta text-ink-muted">{note}</p>
        </div>
        {onOpen === undefined ? null : (
            <div className={TWO_COLUMN.narrowOnlyWebClassName}>
                <Button variant="quiet" size="md" onPress={() => onOpen()}>
                    {openLabel}
                </Button>
            </div>
        )}
    </div>
);
