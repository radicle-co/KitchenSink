'use client';

/**
 * @module @commise/features-recipes/ingredientMatching — `MatchFailureLine` (web): a matched line's choice that did not
 * save (review M6), on the expanded line, a settled line and the side pane alike: the warning glyph and one short
 * attention sentence ("We couldn’t save that choice."), then Try again, named for its line. The line does not silently
 * revert: this line says why it is still open. The glyph carries the state with the colour (WCAG 1.4.1). Not live: the
 * list's one polite region says the failure (`lineAnnouncement.ts`), so it is spoken once. A retry in flight hides this
 * line, so when the retry fails again and Try again comes back it takes focus if asked (`focus`, `useRetryFocus`):
 * focus is never left on a button that is gone (WCAG 2.4.3).
 *
 * Presentational: props in, markup out. The native leaf is `./MatchFailureLine.native.tsx`.
 */
import { Button } from '@commise/ui/button';
import { Icon } from '@commise/ui/icon';
import type { FC } from 'react';

import type { MatchFailureLineProps } from './matchFailureLineProps.js';

/** A send that did not save, and Try again. */
export const MatchFailureLine: FC<MatchFailureLineProps> = ({ failure, onRetry, focus }) => (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="flex min-w-0 items-center gap-2">
            <Icon name="triangleAlert" size={16} tone="attention" />
            <span className="min-w-0 break-words text-list text-attention">{failure.text}</span>
        </span>
        <Button
            variant="ghost"
            size="sm"
            icon="refreshCw"
            accessibilityLabel={failure.retry.name}
            focusRequested={focus.requested}
            onFocusRequestHandled={focus.onHandled}
            onPress={onRetry}
        >
            {failure.retry.label}
        </Button>
    </div>
);
