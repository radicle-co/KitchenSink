'use client';

/**
 * @module @commise/features-recipes/form — `PasteMatchRow` (web): a pasted line that needs nothing from the cook now
 * (`docs/design/uiRefreshWorkshop5/redesignCanvas/ingredientMatching.md`). The line as the cook wrote it, then its
 * status — a bound food with a check and Change, a proposal under review with its tag, or a sentence — then, on their
 * own line, the controls its state allows, and a late review result's one quiet sentence with See why.
 *
 * - Nothing moves (WCAG 2.2.2): a line under review shows a still clock glyph and its "Checking" tag, as
 *   `PastedReadingRow` does, never a spinner the editor would keep turning.
 * - A failure is `attention` with a warning glyph, so it never rests on colour alone (1.4.1); a prompt stays muted.
 * - Each control is named for its line, because the same control shows on many lines (2.4.6, 2.5.3).
 *
 * Presentational: props in, markup out; what it shows is `pasteMatchView.ts`'s. The native leaf is
 * `./PasteMatchRow.native.tsx`.
 *
 * @pattern Visitor — an exhaustive switch over the status union
 */
import { Button } from '@commise/ui/button';
import { Icon } from '@commise/ui/icon';
import { StatusBadge } from '@commise/ui/status-badge';
import type { FC, ReactElement } from 'react';

import { PastedLine } from './PastedLine.js';
import type { PasteMatchRowProps } from './pasteMatchRowProps.js';
import type { PasteMatchStatus } from './pasteMatchView.js';

/** The status line's content. */
const statusOf = (status: PasteMatchStatus): ReactElement => {
    switch (status.kind) {
        case 'food':
            return (
                <>
                    <Icon name="check" size={16} tone="actionText" />
                    <span className="min-w-0 flex-1 break-words text-meta text-ink">
                        {status.food}
                        {status.yourChoice !== undefined && ' '}
                        {status.yourChoice !== undefined && <span className="text-ink-muted">{status.yourChoice}</span>}
                    </span>
                </>
            );
        case 'proposal':
            return (
                <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
                    {status.busy && <Icon name="clock" size={16} tone="inkMuted" />}
                    <span className="min-w-0 break-words text-meta text-ink">{status.food}</span>
                    <StatusBadge status="note">{status.tag}</StatusBadge>
                </span>
            );
        case 'text':
            return status.tone === 'attention' ? (
                <>
                    <Icon name="triangleAlert" size={16} tone="attention" />
                    <span className="min-w-0 flex-1 break-words text-meta text-attention">{status.text}</span>
                </>
            ) : (
                <span className="min-w-0 flex-1 break-words text-meta text-ink-muted">{status.text}</span>
            );

        default: {
            const unhandled: never = status;

            return unhandled;
        }
    }
};

/** One settled pasted line. */
export const PasteMatchRow: FC<PasteMatchRowProps> = ({ line, view, onAction, onSeeWhy }) => (
    <li className="flex min-h-12 flex-col justify-center gap-1 py-2">
        <PastedLine line={line} />
        <div className="flex items-center gap-2">
            {statusOf(view.status)}
            {view.trailing !== undefined && (
                <Button
                    variant="ghost"
                    size="sm"
                    icon={view.trailing.icon}
                    accessibilityLabel={view.trailing.name}
                    onPress={() => {
                        if (view.trailing !== undefined) {
                            onAction(view.trailing.kind);
                        }
                    }}
                >
                    {view.trailing.label}
                </Button>
            )}
        </div>
        {view.actions.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-1 gap-y-1">
                {view.actions.map((action) =>
                    action.kind === 'unavailable' ? (
                        <span key="unavailable" className="px-2 text-meta text-ink-muted">
                            {action.text}
                        </span>
                    ) : (
                        <Button
                            key={action.kind}
                            variant="ghost"
                            size="sm"
                            icon={action.icon}
                            accessibilityLabel={action.name}
                            onPress={() => onAction(action.kind)}
                        >
                            {action.label}
                        </Button>
                    ),
                )}
            </div>
        )}
        {view.note !== undefined && (
            <div className="flex flex-wrap items-center gap-x-2 text-meta text-ink-muted">
                <span>{view.note.sentence}</span>
                <Button variant="ghost" size="sm" accessibilityLabel={view.note.seeWhyName} onPress={onSeeWhy}>
                    {view.note.seeWhy}
                </Button>
            </div>
        )}
    </li>
);
