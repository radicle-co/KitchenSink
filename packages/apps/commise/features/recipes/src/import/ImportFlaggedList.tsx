'use client';

/**
 * @module @commise/features-recipes/import — `ImportFlaggedList` (web): "N to check" (board FlaggedLine), the lines the
 * save-time check doubts after a "Pick the best match for me" import. Each row names its line and recipe and the doubted
 * match, then ONE action — "Use Whole milk", when the check has a food to offer — and a labelled Search, named "Search for
 * a food for {line}", with a 44 px target. Search opens the line's options: the sheet below the wide class, the pane
 * beside the list at it (`detail`), the same shared `FoodChoiceList` either way. Nothing changes until the cook acts.
 *
 * Presentational and controlled. The native leaf is `./ImportFlaggedList.native.tsx`.
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import { Button } from '@commise/ui/button';
import type { FC } from 'react';

import { pluralOf } from '../format/plural.js';
import { fillTemplate } from '../format/fillTemplate.js';
import { matchLineMessages } from '../ingredientMatching/messages.js';
import { importMessages } from './messages.js';
import type { ImportFlaggedListProps } from './props.js';

/** The lines the save-time check doubts. */
export const ImportFlaggedList: FC<ImportFlaggedListProps> = ({ total, lines, onUseSuggestion, onSearch, detail }) => {
    const { flagged: f } = useMessages(importMessages);
    const m = useMessages(matchLineMessages);
    const locale = useLocale();

    return (
        <div className="flex flex-col gap-6 @wide/main:flex-row @wide/main:items-start">
            <div className="flex min-w-0 max-w-reading flex-1 flex-col gap-4">
                <h1 className="font-display text-large-title text-ink">{pluralOf(f.title, total, locale)}</h1>
                <p className="text-body text-ink-muted">{pluralOf(f.intro, total, locale)}</p>
                <ul className="flex flex-col divide-y divide-line-divider">
                    {lines.map((line) => (
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
                                        onPress={() => onUseSuggestion(line.key)}
                                    >
                                        {fillTemplate(f.use, { food: line.suggestion.name })}
                                    </Button>
                                )}
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    icon="search"
                                    accessibilityLabel={fillTemplate(m.searchName, { line: line.text })}
                                    onPress={() => onSearch(line.key)}
                                >
                                    {f.search}
                                </Button>
                            </span>
                        </li>
                    ))}
                </ul>
                <p className="text-meta text-ink-muted">
                    {fillTemplate(f.footer, { title: pluralOf(f.title, total, locale) })}
                </p>
            </div>
            {detail === undefined ? null : <div className="hidden w-96 shrink-0 @wide/main:block">{detail}</div>}
        </div>
    );
};
