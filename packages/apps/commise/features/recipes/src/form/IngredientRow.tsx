'use client';

/**
 * @module @commise/features-recipes/form — `IngredientRow` (web): one ingredient row (build spec §7.5.1). At rest it
 * READS: the amount in a fixed column (72 px below a 600 container, 96 px from 600), then the name in `ink` and " · "
 * the preparation in `inkMuted`, clamped to two lines, then its `⋯`. The amount and name together are the row's open
 * control, "Edit {amount} {food}". A healthy row is quiet; a row that needs the cook adds a second line in `attention`,
 * which opens the row's panel (or, for a line with no food, its food search). While its food search is open (Change
 * food, Find a food, a line with no food), the name is the entry combobox instead. Its inline editor (from 600) sits
 * under it, in the same list item.
 *
 * Presentational: `props → JSX` over the row's view; Radix holds the popover's and the menu's open state.
 *
 * @pattern Strategy — the read row or the entry row, chosen by the view's `inEntry`
 * @pattern Adapter over the DOM focus API — the open control takes a level-triggered focus request, which `.focus()`
 *     alone can carry; it is the one reason this leaf holds a ref
 */
import { ActionMenu } from '@commise/ui/action-menu';
import { Combobox } from '@commise/ui/combobox';
import { Icon } from '@commise/ui/icon';
import { Popover } from '@commise/ui/popover';
import { StandIn } from '@commise/ui/stand-in';
import { StatusBadge } from '@commise/ui/status-badge';
import { VariantPartsLine } from '@commise/ui/variant-parts-line';
import { useEffect, useEffectEvent, useRef, type FC, type ReactNode } from 'react';

import {
    ingredientCommitFailureId,
    ingredientNoFoodNoteId,
    ingredientPendingTextId,
    ingredientStandInId,
} from './fieldErrorIds.js';
import { rowBadgeStatus } from './ingredientRowPolicy.js';
import type { IngredientRowView } from './ingredientRowView.js';
import { errorText } from './formSectionStyles.js';
import { rowEntryFieldOf, type RowEntryFieldCopy } from './rowEntryField.js';

/** Props for {@link IngredientRow}. */
export interface IngredientRowProps {
    readonly row: IngredientRowView;
    readonly entryCopy: RowEntryFieldCopy;
    /** The row's panel body, for its attention line's popover. */
    readonly panel: (close: () => void) => ReactNode;
    /** The row's inline editor, while it is open from 600 (the phone sheet is drawn outside the list). */
    readonly inlineEditor: ReactNode;
    /** From 600 the open control discloses the inline editor (`aria-expanded`); below, it opens a sheet. */
    readonly expanded: boolean | undefined;
}

/** The open control: amount and name, one button named "Edit {amount} {food}". */
const OpenControl: FC<{ readonly row: IngredientRowView; readonly expanded: boolean | undefined }> = ({
    row,
    expanded,
}) => {
    const node = useRef<HTMLButtonElement>(null);
    const { requested, onHandled } = row.openFocus;
    // The acknowledgement is not a dependency: a host's new callback must not re-run a request already taken.
    const acknowledge = useEffectEvent(() => onHandled());

    useEffect(() => {
        if (!requested) {
            return;
        }

        node.current?.focus();
        acknowledge();
    }, [requested]);

    return (
        <button
            ref={node}
            type="button"
            aria-label={row.openLabel}
            aria-expanded={expanded}
            onClick={row.onOpen}
            className="flex min-h-12 min-w-0 flex-1 items-start gap-3 rounded-md py-3 text-left transition hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
        >
            {/* No amount: the column stays empty, never an invented "1" (F5). */}
            <span className="w-[4.5rem] shrink-0 break-words text-body-md text-figure-inline font-semibold text-ink @regular/main:w-24">
                {row.amountText}
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-1">
                {row.standIn ? (
                    <span id={ingredientStandInId(row.index)}>
                        <StandIn tone={row.presentation.tone}>{row.displayName}</StandIn>
                    </span>
                ) : (
                    <span className="line-clamp-2 break-words text-body-md text-ink">
                        {row.displayName}
                        {row.prepText !== undefined && <span className="text-ink-muted">{` · ${row.prepText}`}</span>}
                    </span>
                )}
                {row.variantParts !== undefined && <VariantPartsLine parts={row.variantParts} tone="secondary" />}
            </span>
        </button>
    );
};

/** The row's name while its food search is open: the entry combobox, with its notes. */
const EntryName: FC<{ readonly row: IngredientRowView; readonly entryCopy: RowEntryFieldCopy }> = ({
    row,
    entryCopy,
}) => (
    <div className="flex min-w-0 flex-1 flex-col gap-1 py-2">
        <Combobox {...rowEntryFieldOf(row.entryField, entryCopy)} loadingIcon={<Icon name="search" size={16} />} />
        {row.noFoodNote !== undefined && (
            // `IngredientRowView.noFoodNote`, which the field's description names. `StatusBadge` takes no id and no
            // role, so this wrapper carries both.
            <span id={ingredientNoFoodNoteId(row.index)} role="note">
                <StatusBadge status={rowBadgeStatus(row.presentation.tone)}>{row.noFoodNote}</StatusBadge>
            </span>
        )}
    </div>
);

/** One ingredient row. */
export const IngredientRow: FC<IngredientRowProps> = ({ row, entryCopy, panel, inlineEditor, expanded }) => {
    const { secondLine, line } = row;

    return (
        <li
            className="flex flex-col border-b border-line-divider last:border-b-0"
            // Item 4: focus leaving the row for somewhere outside it (`IngredientRowView.onFocusLeft`).
            onBlur={(event) => {
                const next = event.relatedTarget;

                if (!(next instanceof Node && event.currentTarget.contains(next))) {
                    row.onFocusLeft();
                }
            }}
        >
            <div className="flex items-start gap-2">
                {row.inEntry ? (
                    <EntryName row={row} entryCopy={entryCopy} />
                ) : (
                    <OpenControl row={row} expanded={expanded} />
                )}
                <span className="shrink-0 pt-0.5">
                    <ActionMenu
                        triggerLabel={row.labels.actionsTrigger}
                        title={row.displayName}
                        closeLabel={row.labels.actionsClose}
                        items={row.actions}
                        destructiveItem={row.destructiveAction}
                        focusRequested={row.actionsFocus.requested}
                        onFocusRequestHandled={row.actionsFocus.onHandled}
                        unavailable={row.busy}
                    />
                </span>
            </div>
            {/* The second line sits under the name, past the amount column. */}
            <div className="flex flex-col gap-1 pb-2 pl-[calc(4.5rem+0.75rem)] empty:hidden @regular/main:pl-[calc(6rem+0.75rem)]">
                {secondLine.kind === 'working' && (
                    <span className="inline-flex items-center gap-1 text-caption text-ink-muted">
                        <span aria-hidden="true" className="inline-flex motion-safe:animate-spin">
                            <Icon name="refreshCw" size={16} />
                        </span>
                        {secondLine.text}
                    </span>
                )}
                {secondLine.kind === 'attention' && secondLine.opens === 'panel' && (
                    <Popover
                        triggerLabel={secondLine.label}
                        triggerText={secondLine.text}
                        triggerIcon="triangleAlert"
                        title={row.displayName}
                        closeLabel={row.labels.panelClose}
                        busy={row.busy && (row.body.kind === 'candidates' || row.body.kind === 'shortlist')}
                    >
                        {panel}
                    </Popover>
                )}
                {secondLine.kind === 'attention' && secondLine.opens === 'entry' && (
                    <button
                        type="button"
                        aria-label={secondLine.label}
                        onClick={row.onBeginEntry}
                        className="inline-flex min-h-8 items-center gap-1 self-start rounded-sm text-left text-caption font-medium text-attention transition hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
                    >
                        <span aria-hidden="true" className="inline-flex">
                            <Icon name="triangleAlert" size={16} />
                        </span>
                        {secondLine.text}
                    </button>
                )}
                {row.amountInvalidNote !== undefined && <span className={errorText}>{row.amountInvalidNote}</span>}
                {row.busyText !== undefined && <span className="text-caption text-ink-muted">{row.busyText}</span>}
                {row.pendingText !== undefined && (
                    <span id={ingredientPendingTextId(line.key)} className={errorText}>
                        {row.pendingText}
                    </span>
                )}
                {row.failure !== undefined && (
                    // Shown on the row; the field says it assertively, so this text is not live too (system change 2).
                    <span id={ingredientCommitFailureId(line.key)} className={errorText}>
                        {row.failure}
                    </span>
                )}
            </div>
            {inlineEditor}
        </li>
    );
};
