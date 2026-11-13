'use client';

/**
 * @module @commise/features-recipes/import — `ImportLineList` (web): one imported recipe's ingredient lines in the review
 * wizard (`ingredientMatching.md`; board WizardStep). The ONE shared matched-line list (`MatchLineList`, which the
 * editor's paste flow draws too): one open line expanded — its prompt and its food-choice list, Search first — every
 * other open line a collapsed row naming its need, and every settled line with its controls. When every line arrived
 * matched, it says there is nothing to fix.
 *
 * Presentational and controlled: which line is expanded, what a pick does and where focus goes are the host's
 * (`nextOpenLineKey`, `pickFocusOf`). The native leaf is `./ImportLineList.native.tsx`.
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import type { FC } from 'react';

import { pluralOf } from '@commise/i18n';
import { isNothingToFix } from '../ingredientMatching/matchLine.js';
import { MatchLineList } from '../ingredientMatching/MatchLineList.js';
import { importMessages } from './messages.js';
import type { ImportLineListProps } from './props.js';

/** One imported recipe's lines, one open line expanded. */
export const ImportLineList: FC<ImportLineListProps> = (props) => {
    const { wizard } = useMessages(importMessages);
    const locale = useLocale();

    return (
        <div className="flex flex-col gap-2">
            {isNothingToFix(props.lines) ? (
                <p className="text-body text-ink-muted">{pluralOf(wizard.nothingToFix, props.lines.length, locale)}</p>
            ) : null}
            <MatchLineList {...props} />
        </div>
    );
};
