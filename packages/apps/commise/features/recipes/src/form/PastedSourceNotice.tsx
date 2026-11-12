/**
 * @module @commise/features-recipes/form — `PastedSourceNotice` (web): the caption under a paste control that says what a
 * pasted link did (ADR-0089), so a sighted cook sees what the live region speaks: the Source it set and that the recipe is
 * private now, the link it kept or left out. When the paste made the recipe private, a ghost Remove undoes it in place.
 *
 * Presentational: text and an optional command in, markup out. The native leaf is `./PastedSourceNotice.native.tsx`.
 */
import { useMessages } from '@commise/i18n/react';
import { Button } from '@commise/ui/button';
import type { FC } from 'react';

import { editorMessages } from '../editor/messages.js';
import type { PastedSourceNoticeProps } from './pastedSourceNoticeProps.js';

/** What a paste did to the Source, under the paste control. */
export const PastedSourceNotice: FC<PastedSourceNoticeProps> = ({ text, onRemove }) => {
    const { source: m } = useMessages(editorMessages);

    return (
        <div className="flex flex-wrap items-center gap-x-2">
            <p className="min-w-0 text-caption text-ink-muted">{text}</p>
            {onRemove === undefined ? null : (
                <Button variant="ghost" onPress={onRemove}>
                    {m.snackRemove}
                </Button>
            )}
        </div>
    );
};
