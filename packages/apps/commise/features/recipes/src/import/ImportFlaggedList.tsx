'use client';

/**
 * @module @commise/features-recipes/import — `ImportFlaggedList` (web): "N to check" (board FlaggedLine), the lines the
 * save-time check doubts after a "Pick the best match for me" import. Each row names its line and recipe and the doubted
 * match, then ONE action — "Use Whole milk", when the check has a food to offer — and "Choose another", named "Choose
 * another food for {line}", with a 44 px target. Choose another opens the line's options, search first: the sheet below
 * the wide class, the pane beside the list at it (`detail`), the same shared `FoodChoiceList` either way. Nothing
 * changes until the cook acts. While a send for a line is in flight, Use reads busy if it is the one sending, and both
 * controls refuse a press and keep focus (M5). A Use that did not save says so on its row in the matched-line list's
 * words, with Try again, and the page has ONE polite live region (M6, U9).
 *
 * Presentational and controlled. The native leaf is `./ImportFlaggedList.native.tsx`.
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import { Button } from '@commise/ui/button';
import { LiveRegion } from '@commise/ui/live-region';
import type { FC } from 'react';

import { pluralOf } from '../format/plural.js';
import { fillTemplate } from '../format/fillTemplate.js';
import { MatchFailureLine } from '../ingredientMatching/MatchFailureLine.js';
import { lineFailureOf, sendStateOf } from '../ingredientMatching/matchLineView.js';
import { useMatchCopy } from '../ingredientMatching/useMatchCopy.js';
import { useRetryFocus } from '../ingredientMatching/useRetryFocus.js';
import { flaggedLandingOf } from './flaggedLanding.js';
import { importMessages } from './messages.js';
import type { ImportFlaggedListProps } from './props.js';

/** The lines the save-time check doubts. */
export const ImportFlaggedList: FC<ImportFlaggedListProps> = ({
    total,
    lines,
    pending,
    failed,
    announcement,
    onUseSuggestion,
    onChooseAnother,
    detail,
}) => {
    const { flagged: f } = useMessages(importMessages);
    const locale = useLocale();
    const copy = useMatchCopy();
    const placeOf = (key: string) => ({ failed: failed.has(key), pending: pending.get(key) });
    const retryOf = useRetryFocus(lines.map((line) => sendStateOf(line.key, placeOf(line.key))));

    return (
        <div className="flex flex-col gap-6 @wide/main:flex-row @wide/main:items-start">
            <div className="flex min-w-0 max-w-reading flex-1 flex-col gap-4">
                <h1 className="font-display text-large-title text-ink">{pluralOf(f.title, total, locale)}</h1>
                <p className="text-body text-ink-muted">{pluralOf(f.intro, total, locale)}</p>
                <ul className="flex flex-col divide-y divide-line-divider">
                    {lines.map((line) => {
                        const retry = retryOf(line.key);
                        const failure = lineFailureOf(line.text, placeOf(line.key), copy);

                        return (
                            <li key={line.key} className="flex flex-col gap-2 py-3">
                                <span className="break-words text-body font-semibold text-ink">
                                    {fillTemplate(f.lineContext, { line: line.text, recipe: line.recipeTitle })}
                                </span>
                                <span className="break-words text-meta text-ink-muted">
                                    {fillTemplate(f.doubt, { food: line.matchedFood })}
                                </span>
                                <span className="flex flex-wrap items-center gap-3">
                                    {line.suggestion === undefined ? null : (
                                        <Button
                                            variant="secondary"
                                            icon="check"
                                            accessibilityLabel={fillTemplate(f.useName, {
                                                food: line.suggestion.name,
                                                line: line.text,
                                            })}
                                            busy={pending.get(line.key)?.kind === 'useProposal'}
                                            refused={pending.has(line.key)}
                                            focusRequested={retry.landing.requested}
                                            onFocusRequestHandled={retry.landing.onHandled}
                                            onPress={() => onUseSuggestion(line.key)}
                                        >
                                            {fillTemplate(f.use, { food: line.suggestion.name })}
                                        </Button>
                                    )}
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        accessibilityLabel={fillTemplate(f.chooseAnotherName, { line: line.text })}
                                        refused={pending.has(line.key)}
                                        focusRequested={
                                            flaggedLandingOf(line) === 'chooseAnother' && retry.landing.requested
                                        }
                                        onFocusRequestHandled={retry.landing.onHandled}
                                        onPress={() => onChooseAnother(line.key)}
                                    >
                                        {f.chooseAnother}
                                    </Button>
                                </span>
                                {failure === undefined ? null : (
                                    <MatchFailureLine
                                        failure={failure}
                                        onRetry={() => onUseSuggestion(line.key)}
                                        focus={retry.tryAgain}
                                    />
                                )}
                            </li>
                        );
                    })}
                </ul>
                <p className="text-meta text-ink-muted">
                    {fillTemplate(f.footer, { title: pluralOf(f.title, total, locale) })}
                </p>
            </div>
            {detail === undefined ? null : <div className="hidden w-96 shrink-0 @wide/main:block">{detail}</div>}
            <LiveRegion politeness="polite" occurrence={announcement.occurrence} visuallyHidden>
                {announcement.text}
            </LiveRegion>
        </div>
    );
};
