'use client';

/**
 * @module @commise/features-recipes/import — `ImportLineList` (web): one imported recipe's ingredient lines in the line
 * states the server derives (`ingredientMatching.md`; board WizardStep). ONE open line is expanded — its text, a neutral
 * prompt and its option list (`ImportLineOptions`, search first); every other open line is a closed row that names its
 * need ("Choose a food · 5 options"). A matched line shows its food and Change; a checking line its proposal with
 * Checking, Use this and Search for a food, one tap each; a cook's pick says "your choice", and a late check result keeps
 * that pick and adds one quiet sentence with See why. When every line arrived matched, it says there is nothing to fix.
 *
 * Presentational and controlled: which line is expanded, and what a pick does, are the host's (choosing a food expands
 * the next open line — `nextOpenLineKey`). Nothing moves (WCAG 2.2.2): a checking line draws a static glyph. The native
 * leaf is `./ImportLineList.native.tsx`.
 *
 * ⚠️ RECONCILE AT MERGE: the paste flow's line list (the editor builder's, in parallel) draws the same states. One of
 * the two must absorb the other; they must not both ship.
 *
 * @pattern Visitor — `LineRow` is an exhaustive switch over the `ImportLine` state union; the expanded line is chosen by
 *     the host's `expandedKey`, never by a mode flag
 */
import { useLocale, useMessages } from '@commise/i18n/react';
import { Button } from '@commise/ui/button';
import { Icon } from '@commise/ui/icon';
import { StatusBadge } from '@commise/ui/status-badge';
import type { FC } from 'react';

import { pluralOf } from '../format/plural.js';
import { fillTemplate } from '../format/fillTemplate.js';
import { isNothingToFix } from './importLine.js';
import { candidatesOf, closedNeedOf, openPromptOf, pickTextOf } from './importLineCopy.js';
import { ImportLineOptions } from './ImportLineOptions.js';
import { importMessages } from './messages.js';
import type { ImportLineListProps, ImportLineRowProps, ImportOpenLineProps } from './props.js';

const lineText = 'break-words text-body text-ink';

/** The one expanded line: its text, its prompt, its options. */
const OpenLine: FC<ImportOpenLineProps> = ({ line, onPick, onSearch }) => {
    const { line: m } = useMessages(importMessages);
    const prompt = openPromptOf(line, m);

    return (
        <div className="flex flex-col gap-2 py-3">
            <span className={lineText}>{line.text}</span>
            {prompt === undefined ? null : <span className="text-meta text-ink-muted">{prompt}</span>}
            <ImportLineOptions
                lineText={line.text}
                candidates={candidatesOf(line)}
                pick={line.choice?.pick}
                onPick={(pick) => onPick(line.key, pick)}
                onSearch={() => onSearch(line.key)}
            />
        </div>
    );
};

/** A closed line, by its state. */
const LineRow: FC<ImportLineRowProps> = ({ line, onExpand, onUseProposal, onSearch, onSeeWhy }) => {
    const { line: m } = useMessages(importMessages);
    const locale = useLocale();

    if (line.state === 'checking') {
        return (
            <div className="flex flex-col gap-1 py-3">
                <span className={lineText}>{line.text}</span>
                <span className="flex flex-wrap items-center gap-2 text-meta text-ink">
                    <span className="text-action-text">
                        <Icon name="refreshCw" size={16} />
                    </span>
                    <span className="min-w-0 break-words">{line.proposal}</span>
                    <StatusBadge status="note">{m.checkingTag}</StatusBadge>
                </span>
                <span className="flex flex-wrap gap-x-4">
                    <Button
                        variant="ghost"
                        size="sm"
                        accessibilityLabel={fillTemplate(m.useThisName, { food: line.proposal, line: line.text })}
                        onPress={() => onUseProposal(line.key)}
                    >
                        {m.useThis}
                    </Button>
                    <Button
                        variant="ghost"
                        size="sm"
                        icon="search"
                        accessibilityLabel={fillTemplate(m.searchName, { line: line.text })}
                        onPress={() => onSearch(line.key)}
                    >
                        {m.search}
                    </Button>
                </span>
            </div>
        );
    }

    const change = (
        <Button
            variant="ghost"
            size="sm"
            accessibilityLabel={fillTemplate(m.changeName, { line: line.text })}
            onPress={() => onExpand(line.key)}
        >
            {m.change}
        </Button>
    );

    if (line.choice !== undefined) {
        const { pick, lateSuggestion } = line.choice;

        return (
            <div className="flex flex-col gap-1 py-3">
                <span className={lineText}>{line.text}</span>
                <span className="flex flex-wrap items-center justify-between gap-2">
                    <span className="min-w-0 break-words text-meta text-ink">
                        {pickTextOf(pick, m)} · <span className="text-ink-muted">{m.yourChoice}</span>
                    </span>
                    {change}
                </span>
                {lateSuggestion === undefined ? null : (
                    <span className="flex flex-wrap items-center gap-x-2">
                        <span className="text-meta text-ink-muted">
                            {fillTemplate(m.lateSuggestion, { food: lateSuggestion })}
                        </span>
                        <Button
                            variant="ghost"
                            size="sm"
                            accessibilityLabel={fillTemplate(m.seeWhyName, { food: lateSuggestion, line: line.text })}
                            onPress={() => onSeeWhy(line.key)}
                        >
                            {m.seeWhy}
                        </Button>
                    </span>
                )}
            </div>
        );
    }

    if (line.state === 'confident') {
        return (
            <div className="flex flex-col gap-1 py-3">
                <span className={lineText}>{line.text}</span>
                <span className="flex flex-wrap items-center justify-between gap-2">
                    <span className="min-w-0 break-words text-meta text-ink">{line.food}</span>
                    {change}
                </span>
            </div>
        );
    }

    return (
        <button
            type="button"
            onClick={() => onExpand(line.key)}
            className="flex min-h-12 w-full items-center gap-2 py-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
        >
            <span className="flex min-w-0 flex-1 flex-col">
                <span className={lineText}>{line.text}</span>
                {/* A flex container drops a whitespace-only child from layout; the name keeps it between the two. */}{' '}
                <span className="text-meta text-ink-muted">{closedNeedOf(line, m, locale)}</span>
            </span>
            <span className="shrink-0 text-ink-muted">
                <Icon name="chevronRight" size={16} />
            </span>
        </button>
    );
};

/** One imported recipe's lines, one open line expanded. */
export const ImportLineList: FC<ImportLineListProps> = ({ lines, expandedKey, onPick, ...rowHandlers }) => {
    const { wizard } = useMessages(importMessages);
    const locale = useLocale();

    return (
        <div className="flex flex-col gap-2">
            {isNothingToFix(lines) ? (
                <p className="text-body text-ink-muted">{pluralOf(wizard.nothingToFix, lines.length, locale)}</p>
            ) : null}
            <ul className="flex flex-col divide-y divide-line-divider">
                {lines.map((line) => (
                    <li key={line.key}>
                        {line.key === expandedKey && line.state !== 'checking' ? (
                            <OpenLine line={line} onPick={onPick} onSearch={rowHandlers.onSearch} />
                        ) : (
                            <LineRow line={line} {...rowHandlers} />
                        )}
                    </li>
                ))}
            </ul>
        </div>
    );
};
