'use client';

/**
 * @module @commise/features-recipes/import — `ImportSummary` (web): the end of a bulk import (board WizardSummary).
 * Your library is in — from where and when; how many were added and how (needed nothing, reviewed, skipped) with See
 * them; how many were already here; which could not be read, with Fix; how many lines are kept as written and do not
 * count toward nutrition yet, with Choose foods; and, beside it at the wide container class, the nutrition coverage.
 * A row whose count is zero is not drawn (`summaryCopy.ts`).
 *
 * A review with no recipe to review ends here directly, with 0 reviewed: that is the review's empty state.
 *
 * Presentational. The native leaf is `./ImportSummary.native.tsx`.
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import { Button } from '@commise/ui/button';
import type { FC, ReactNode } from 'react';

import { importMessages } from './messages.js';
import type { ImportSummaryProps } from './props.js';
import { summaryCopyOf } from './summaryCopy.js';

/** One row of the summary: its headline, its detail, and its one action. */
const Row: FC<{ readonly title: string; readonly detail: string; readonly action?: ReactNode }> = ({
    title,
    detail,
    action,
}) => (
    <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-3">
        <span className="flex min-w-0 flex-col">
            <span className="text-body font-semibold text-ink">{title}</span>
            <span className="break-words text-meta text-ink-muted">{detail}</span>
        </span>
        {action}
    </li>
);

/** The end of a bulk import. */
export const ImportSummary: FC<ImportSummaryProps> = ({ onSeeAdded, onFixUnreadable, onChooseFoods, ...counts }) => {
    const { summary: s } = useMessages(importMessages);
    const locale = useLocale();
    const copy = summaryCopyOf(counts, s, locale);

    return (
        <div className="flex flex-col gap-6 @wide/main:flex-row @wide/main:items-start">
            <div className="flex min-w-0 max-w-reading flex-1 flex-col gap-4">
                <h1 className="font-display text-large-title text-ink">{s.title}</h1>
                <p className="text-body text-ink-muted">{copy.from}</p>
                <ul className="flex flex-col divide-y divide-line-divider">
                    <Row
                        title={copy.added}
                        detail={copy.breakdown}
                        action={
                            <Button variant="ghost" size="sm" onPress={onSeeAdded}>
                                {s.seeThem}
                            </Button>
                        }
                    />
                    {copy.alreadyHere === undefined ? null : (
                        <Row title={copy.alreadyHere} detail={s.alreadyHereHint} />
                    )}
                    {copy.unreadable === undefined ? null : (
                        <Row
                            title={copy.unreadable.title}
                            detail={copy.unreadable.titles}
                            action={
                                <Button variant="ghost" size="sm" onPress={onFixUnreadable}>
                                    {s.fix}
                                </Button>
                            }
                        />
                    )}
                </ul>
                {copy.asWritten === undefined ? null : (
                    <div className="flex flex-col items-start gap-2 rounded-lg bg-surface-muted p-4">
                        <p className="text-body text-ink">{copy.asWritten}</p>
                        <Button variant="secondary" icon="search" onPress={onChooseFoods}>
                            {s.chooseFoods}
                        </Button>
                    </div>
                )}
            </div>
            <div className="hidden max-w-xs flex-col gap-1 rounded-lg border border-line-divider p-4 @wide/main:flex">
                <span className="text-label text-ink-muted">{s.coverageTitle}</span>
                <span className="text-figure-stat text-ink">{copy.coverage}</span>
                <span className="text-meta text-ink-muted">{s.coverageHint}</span>
            </div>
        </div>
    );
};
