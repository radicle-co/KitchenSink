'use client';

/**
 * @module @commise/features-recipes/actions — `SourceStatementSheet` (web): "Where is this recipe from?", asked before a
 * pasted recipe goes public (ADR-0095). A centred dialog (a bottom sheet on a narrow screen) on the design-system `Sheet`,
 * with the answers as a `RadioList`, the one field the chosen answer reveals, and a pinned footer saying what the answer does
 * before the cook confirms.
 *
 * Close, Escape and the scrim all mean the dismiss (Keep as draft, or Cancel): nothing is sent. While the change is in flight
 * (the recipe page) none of them does, and the list and the dismiss are disabled. The confirm is drawn as unavailable, and
 * stays focusable, until an answer is chosen.
 *
 * Presentational: props in, markup out. What it draws is `sheetViewOf`'s, shared with the native leaf
 * (`./SourceStatementSheet.native.tsx`); the state is `useStatementSheet`'s.
 *
 * @pattern Adapter over the design-system `Sheet` — the ask's words and its one dismiss path on the house sheet
 */
import { useMessages } from '@commise/i18n/react';
import { Button } from '@commise/ui/button';
import { FieldLabel, fieldErrorId, Input } from '@commise/ui/input';
import { RadioList } from '@commise/ui/radio-list';
import { Sheet } from '@commise/ui/sheet';
import { useId, type FC } from 'react';

import { editorMessages } from '../editor/messages.js';
import { recipeActionMessages } from './messages.js';
import { sheetViewOf } from './sourceStatementSheetModel.js';
import type { SourceStatementSheetProps } from './sourceStatementSheetProps.js';

/** The source-statement dialog. */
export const SourceStatementSheet: FC<SourceStatementSheetProps> = ({
    open,
    surface,
    state,
    dispatch,
    onConfirm,
    onDismiss,
}) => {
    const { sourceStatement: m, visibility } = useMessages(recipeActionMessages);
    const { source } = useMessages(editorMessages);
    const view = sheetViewOf({ surface, state, messages: m, shared: { source, failure: visibility.error } });
    const ids = useId();
    const bodyId = `${ids}-body`;
    const effectId = `${ids}-effect`;
    const fieldId = `${ids}-field`;
    const { field } = view;

    return (
        <Sheet
            open={open}
            // Every close route lands here with `false`; none dismisses while the change is in flight.
            onOpenChange={(next) => {
                if (!next && !view.busy) {
                    onDismiss();
                }
            }}
            title={m.title}
            describedBy={[bodyId, effectId]}
            closeLabel={m.close}
            size="content"
            presentation="dialog"
            busy={view.busy}
            footer={
                <div className="flex flex-col gap-3">
                    <p id={effectId} className="text-meta text-ink-muted">
                        {m.effect}
                    </p>
                    <div className="flex gap-3">
                        <Button variant="secondary" width="fill" disabled={view.busy} onPress={onDismiss}>
                            {view.dismissLabel}
                        </Button>
                        <Button
                            variant="primary"
                            icon="check"
                            width="fill"
                            busy={view.busy}
                            refused={view.confirmRefused}
                            onPress={onConfirm}
                        >
                            {view.confirmLabel}
                        </Button>
                    </div>
                </div>
            }
        >
            <div className="flex flex-col gap-4">
                <p id={bodyId} className="text-body text-ink">
                    {m.body}
                </p>
                <RadioList
                    label={m.title}
                    options={view.options}
                    value={view.value}
                    disabled={view.busy}
                    onChange={(answer) => dispatch({ type: 'choose', answer })}
                />
                {field === undefined ? null : (
                    <div className="flex flex-col gap-1">
                        <FieldLabel forId={fieldId} label={field.label} />
                        <Input
                            id={fieldId}
                            value={field.value}
                            invalid={field.error !== undefined}
                            {...(field.error === undefined ? {} : { describedBy: fieldErrorId(fieldId) })}
                            inputMode={field.inputMode}
                            {...(field.maxLength === undefined ? {} : { maxLength: field.maxLength })}
                            autoCapitalize={field.autoCapitalize}
                            {...(field.kind === 'link' ? { autoCorrect: false } : {})}
                            disabled={view.busy}
                            focusRequested={field.focusRequested}
                            onFocusRequestHandled={() => dispatch({ type: 'focusHandled' })}
                            onChangeText={(text) => dispatch({ type: field.kind, text })}
                            onSubmit={onConfirm}
                        />
                        {field.error === undefined ? null : (
                            <p id={fieldErrorId(fieldId)} className="text-caption text-danger-text">
                                {field.error}
                            </p>
                        )}
                    </div>
                )}
                {view.errorText === undefined ? null : (
                    <p role="alert" className="text-body text-danger-text">
                        {view.errorText}
                    </p>
                )}
            </div>
        </Sheet>
    );
};
