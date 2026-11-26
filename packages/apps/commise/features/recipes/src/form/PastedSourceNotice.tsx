/**
 * @module @commise/features-recipes/form — `PastedSourceNotice` (web): the caption under a paste control that says what a
 * pasted link did (ADR-0089), so a sighted cook sees what the live region speaks: the Source it set and that the recipe is
 * private now, the link it kept or left out. When the paste made the recipe private, a ghost Remove undoes it in place.
 *
 * Presentational: text and an optional command in, markup out. It holds a ref only so a refusal the cook must read can take
 * focus (SC 2.4.3). With no text it shows nothing, so a host can keep it mounted and the first refusal still counts as a
 * change of its signal. The native leaf is `./PastedSourceNotice.native.tsx`.
 *
 * @pattern Adapter over `useFocusOnSignal` — the DOM focus move the host's signal asks for
 */
import { useMessages } from '@commise/i18n/react';
import { Button } from '@commise/ui/button';
import { useFocusOnSignal } from '@commise/ui/dialog-focus';
import type { FC } from 'react';

import { editorMessages } from '../editor/messages.js';
import type { PastedSourceNoticeProps } from './pastedSourceNoticeProps.js';

/** What a paste did to the Source, under the paste control. */
export const PastedSourceNotice: FC<PastedSourceNoticeProps> = ({ text, onRemove, focusSignal = 0 }) => {
    const { source: m } = useMessages(editorMessages);
    const notice = useFocusOnSignal<HTMLDivElement>(focusSignal);

    if (text === '') {
        return null;
    }

    return (
        <div ref={notice} tabIndex={-1} className="flex flex-wrap items-center gap-x-2 outline-none">
            <p className="min-w-0 text-caption text-ink-muted">{text}</p>
            {onRemove === undefined ? null : (
                <Button variant="ghost" onPress={onRemove}>
                    {m.snackRemove}
                </Button>
            )}
        </div>
    );
};
