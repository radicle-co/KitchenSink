'use client';

/**
 * @module @commise/features-recipes/import — `ImportModeChoice` (web): before a bulk import, how ingredients are matched
 * to foods (board ImportModeChoice; `ingredientMatching.md` "Bulk import"). The file, then three modes as one radio group
 * of cards — Save lines as written, Pick the best match for me, Let me review each recipe — with NOTHING preselected,
 * and Start disabled until the cook picks (owner ruling 2026-10-25), its hint saying why. At the wide container class a
 * reassurance sits beside the choice.
 *
 * Below the wide class Start and its hint are pinned to the bottom of the viewport (U17), as the review wizard's action
 * bar is, so three tall mode cards never push the primary action off a phone screen; at it they sit in flow under the
 * modes. The document's `scroll-padding-bottom` keeps a focused card clear of the pinned bar (`data-import-bar`,
 * `globals.css`).
 *
 * Presentational and controlled: the host holds the mode and starts the import. The native leaf is
 * `./ImportModeChoice.native.tsx`.
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import { Button } from '@commise/ui/button';
import { Icon } from '@commise/ui/icon';
import { RadioList } from '@commise/ui/radio-list';
import { surfaceToneClass } from '@commise/ui/surface-tone';
import type { FC } from 'react';

import { pluralOf, fillTemplate } from '@commise/i18n';
import { modeOfOptionId, modeOptionsOf } from './importMode.js';
import { importMessages } from './messages.js';
import type { ImportModeChoiceProps } from './props.js';

/** The mode choice before a bulk import. */
export const ImportModeChoice: FC<ImportModeChoiceProps> = ({
    fileName,
    sourceName,
    recipeCount,
    mode,
    onModeChange,
    onStart,
    starting = false,
}) => {
    const messages = useMessages(importMessages);
    const m = messages.mode;
    const locale = useLocale();

    return (
        <div className="flex flex-col gap-6 @wide/main:flex-row @wide/main:items-start">
            <div className="flex min-w-0 max-w-reading flex-1 flex-col gap-4">
                <h1 className="font-display text-large-title text-ink">{m.title}</h1>
                <div
                    className={`flex items-center gap-3 rounded-lg border border-line-divider ${surfaceToneClass('paperRaised')} px-4 py-3`}
                >
                    <Icon name="bookOpen" size={20} />
                    <div className="flex min-w-0 flex-col">
                        <span className="break-words text-body font-semibold text-ink">{fileName}</span>
                        <span className="text-meta text-ink-muted">
                            {fillTemplate(pluralOf(m.fileSummary, recipeCount, locale), { source: sourceName })}
                        </span>
                    </div>
                </div>
                <p className="text-body text-ink-muted">{m.intro}</p>
                <RadioList
                    label={m.groupLabel}
                    options={modeOptionsOf(messages)}
                    value={mode}
                    onChange={(id) => {
                        const chosen = modeOfOptionId(id);

                        if (chosen !== undefined) {
                            onModeChange(chosen);
                        }
                    }}
                />
                <div
                    data-import-bar=""
                    className="sticky bottom-0 flex flex-col items-start gap-2 border-t border-line-divider bg-bar py-3 @wide/main:static @wide/main:border-t-0 @wide/main:bg-transparent @wide/main:py-0"
                >
                    <Button icon="check" disabled={mode === undefined} busy={starting} onPress={onStart}>
                        {m.start}
                    </Button>
                    <p className="text-meta text-ink-muted">{m.startHint}</p>
                </div>
            </div>
            <p className="hidden max-w-xs text-meta text-ink-muted @wide/main:block">{m.promise}</p>
        </div>
    );
};
