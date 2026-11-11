'use client';

/**
 * @module @commise/features-recipes/form — `IngredientLineEditor` (web): the row editor's fields (build spec §7.5.2),
 * drawn inside either frame, the phone sheet or the inline panel. Top to bottom: "Counted as" and the food as one line with Change, the cook's own words and the note, then
 * Amount (with "+ Add a range"), Unit and Preparation, then Food details. The fields wrap by width: from 600 px they
 * share one line, and in the phone sheet Amount and Unit take line 1 and Preparation line 2. No group field: groups are
 * set at the section level.
 *
 * Presentational: `props → JSX` over the row editor's view (`RowLineEditorView`); every edit is the view's.
 *
 * @pattern Template — one field layout, framed by `IngredientLineEditorSheet` and the row's inline panel
 */
import { Button } from '@commise/ui/button';
import { Combobox } from '@commise/ui/combobox';
import { FieldLabel, FIELD_CLASS } from '@commise/ui/input';
import { FOCUS_RING_CLASS } from '@commise/ui/focus-ring';
import { StatusBadge } from '@commise/ui/status-badge';
import { PRESS_FILL_CLASS } from '@commise/ui/surface-tone';
import type { FC, ReactNode } from 'react';

import { ingredientUnitNoteId } from './fieldErrorIds.js';
import { errorText } from './formSectionStyles.js';
import type { RowLineEditorView } from './ingredientRowView.js';
import type { RecipeFormMessages } from './messages.js';

/** Props for {@link IngredientLineEditor}. */
export interface IngredientLineEditorProps {
    readonly view: RowLineEditorView;
    /** The row's index, for the unit note's id (`ingredientUnitNoteId`). */
    readonly index: number;
    readonly m: RecipeFormMessages;
    /** The food's details, shown while the view says they are open. */
    readonly details: ReactNode;
}

/**
 * A text field for one bound of the amount, so "1/2", "½" and "1,5" reach the reader (a number input would sanitise
 * them to nothing): empty means no amount, never "0" (R40).
 */
const AmountField: FC<{
    readonly id: string;
    readonly value: string;
    readonly invalid: boolean;
    readonly describedBy: string | undefined;
    readonly onChange: (text: string) => void;
    readonly accessibleName?: string;
}> = ({ id, value, invalid, describedBy, onChange, accessibleName }) => (
    <input
        id={id}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        value={value}
        aria-label={accessibleName}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        onChange={(event) => onChange(event.target.value)}
        // §7.5.2: a 64 px amount field.
        className={`block w-16 text-ink tabular-nums ${FIELD_CLASS}`}
    />
);

/** The row editor's fields. */
export const IngredientLineEditor: FC<IngredientLineEditorProps> = ({ view, index, m, details }) => (
    <div className="flex flex-col gap-4">
        {view.needsReview && (
            // The notice heads the editor: what is wrong, then the cook's own words. A group the arrival can focus, so a
            // screen reader reads it first and no text field takes the keyboard (tabIndex -1: focusable, not a tab stop).
            <div
                role="group"
                aria-label={m.statusNeedsReview}
                tabIndex={-1}
                className="flex flex-col gap-1 outline-none"
            >
                <div>
                    <StatusBadge status="attention">{m.statusNeedsReview}</StatusBadge>
                </div>
                <p className="text-caption text-ink-muted">{m.statusExplainNeedsReview}</p>
                {view.originalLine !== undefined && (
                    <>
                        <span className="text-caption text-ink-muted">{m.rowYouWroteLabel}</span>
                        <p className="min-w-0 select-text break-words text-body-md text-ink">{view.originalLine}</p>
                    </>
                )}
            </div>
        )}
        <div className="flex flex-col gap-1">
            <span className="text-caption text-ink-muted">{m.rowCountedAsLabel}</span>
            <div className="flex min-w-0 flex-wrap items-center gap-2">
                <p className="min-w-0 flex-1 break-words text-body-md text-ink">{view.food}</p>
                {view.onChangeFood !== undefined && (
                    <Button variant={view.needsReview ? 'secondary' : 'ghost'} onPress={view.onChangeFood}>
                        {m.rowChange}
                    </Button>
                )}
            </div>
        </div>
        <div className="flex flex-col gap-4 @regular/main:flex-row @regular/main:flex-wrap @regular/main:items-end @regular/main:gap-x-3">
            <div className="flex min-w-40 flex-1 flex-col gap-1">
                <FieldLabel forId={view.ids.displayText} label={m.rowDisplayTextLabel} />
                <input
                    id={view.ids.displayText}
                    type="text"
                    value={view.displayText}
                    placeholder={view.displayTextPlaceholder}
                    onChange={(event) => view.onDisplayText(event.target.value)}
                    className={`block w-full text-ink ${FIELD_CLASS}`}
                />
            </div>
            <div className="flex min-w-40 flex-1 flex-col gap-1">
                <FieldLabel forId={view.ids.note} label={m.rowNoteLabel} />
                <input
                    id={view.ids.note}
                    type="text"
                    value={view.note}
                    placeholder={m.rowNotePlaceholder}
                    onChange={(event) => view.onNote(event.target.value)}
                    className={`block w-full text-ink ${FIELD_CLASS}`}
                />
            </div>
        </div>
        <div className="flex flex-wrap items-end gap-x-3 gap-y-4">
            <div className="flex flex-col gap-1">
                <FieldLabel forId={view.ids.amount} label={m.rowAmountLabel} />
                <div className="flex items-center gap-2">
                    <AmountField
                        id={view.ids.amount}
                        value={view.amountLow}
                        invalid={view.amountInvalid}
                        describedBy={view.describedBy.quantity}
                        onChange={view.onAmountLow}
                    />
                    {view.rangeShown && (
                        <>
                            {/* The visible "to" names the second bound; its accessible name contains it (2.5.3). */}
                            <span aria-hidden="true" className="text-body-md text-ink-muted">
                                {m.rowAmountTo}
                            </span>
                            <AmountField
                                id={view.ids.amountHigh}
                                value={view.amountHigh}
                                invalid={view.amountInvalid}
                                describedBy={view.describedBy.quantityHigh}
                                onChange={view.onAmountHigh}
                                accessibleName={m.rowAmountHighLabel}
                            />
                        </>
                    )}
                </div>
            </div>
            <div className="w-32">
                <Combobox
                    id={view.ids.unit}
                    label={m.rowUnitLabel}
                    listLabel={m.rowUnitListLabel}
                    value={view.unit}
                    onValueChange={view.onUnit}
                    groups={[
                        {
                            key: 'units',
                            options: view.unitSuggestions.map((unit) => ({ key: unit, label: unit })),
                        },
                    ]}
                    onSelect={view.onUnit}
                    countAnnouncement=""
                    {...(view.describedBy.unit === undefined ? {} : { describedBy: view.describedBy.unit })}
                />
            </div>
            <div className="flex min-w-40 flex-1 flex-col gap-1">
                <FieldLabel forId={view.ids.prep} label={m.rowPrepLabel} />
                <input
                    id={view.ids.prep}
                    type="text"
                    value={view.prep}
                    onChange={(event) => view.onPrep(event.target.value)}
                    className={`block w-full text-ink ${FIELD_CLASS}`}
                />
            </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
            {view.rangeShown ? (
                <Button variant="ghost" onPress={view.onRemoveRange}>
                    {m.rowRemoveRange}
                </Button>
            ) : (
                <Button variant="ghost" icon="plus" onPress={view.onAddRange}>
                    {m.rowAddRange}
                </Button>
            )}
        </div>
        {view.amountNote !== undefined && (
            <p id={view.amountNote.id} className={errorText}>
                {view.amountNote.text}
            </p>
        )}
        {view.unitNote !== undefined && (
            <p id={ingredientUnitNoteId(index)} className="text-caption text-ink-muted">
                {view.unitNote}
            </p>
        )}
        {view.detailsOffered && (
            <div className="flex flex-col items-start gap-2">
                <button
                    type="button"
                    aria-expanded={view.detailsOpen}
                    onClick={view.onToggleDetails}
                    className={`inline-flex min-h-11 items-center rounded-full px-3 text-body-md font-medium text-action-text transition ${PRESS_FILL_CLASS.pointer} ${FOCUS_RING_CLASS.offset}`}
                >
                    {m.rowFoodDetails}
                </button>
                {view.detailsOpen && <div className="text-body-sm text-ink">{details}</div>}
            </div>
        )}
    </div>
);
