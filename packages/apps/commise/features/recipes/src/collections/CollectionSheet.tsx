'use client';

/**
 * @module @commise/features-recipes/collections — the web new-collection sheet (`docs/design/uiOverhaul/buildSpec.md`
 * §5.1), over the design-system `Sheet`. It replaces the `/collections/new` page.
 *
 * It holds only what the cook is typing; the host owns the request (`onCreate`, `submitting`, `failed`) and what
 * follows it (closing, then opening the new collection). A name is required and capped at 80, with a counter from 60;
 * the description is optional and capped at 280 (`./limits.ts`). An empty name is refused with an inline error and
 * focus on the field (SC 3.3.1); a server failure is an inline alert above the button, and the input is kept. Closing
 * with a typed name asks first.
 *
 * Presentational: it holds only what the cook is typing (the draft is UI state); the host runs the request.
 *
 * @pattern Adapter over the design-system `Sheet`, holding the form's own transient state
 */
import { useMessages } from '@commise/i18n/react';
import { Button } from '@commise/ui/button';
import { ConfirmDialog } from '@commise/ui/confirm-dialog';
import { FieldLabel, Input, TextArea } from '@commise/ui/input';
import { Sheet } from '@commise/ui/sheet';
import { useId, type FC } from 'react';

import { fillTemplate } from '../format/fillTemplate.js';
import { COLLECTION_NAME_MAX_LENGTH, showsNameCounter } from './limits.js';
import { collectionMessages } from './messages.js';
import type { CollectionSheetProps } from './sheetModel.js';
import { useCollectionSheetDraft } from './useCollectionSheetDraft.js';

export type { CollectionCreateSheetProps, CollectionRenameSheetProps, CollectionSheetProps } from './sheetModel.js';

export const CollectionSheet: FC<CollectionSheetProps> = (props) => {
    const { open, submitting, failed } = props;
    const { sheet, rename } = useMessages(collectionMessages);
    const nameId = useId();
    const descriptionId = useId();
    const errorId = useId();
    const draft = useCollectionSheetDraft(props);
    const { renaming, name, description, nameError, confirming, close, requestClose } = draft;
    // Focus moves to the refused field (SC 3.3.1), from the press that refused it — no ref, no effect.
    const submit = (): void => draft.submit(() => document.getElementById(nameId)?.focus());

    return (
        <>
            <Sheet
                open={open}
                onOpenChange={(next) => {
                    if (!next) {
                        requestClose();
                    }
                }}
                title={renaming ? rename.title : sheet.newTitle}
                closeLabel={sheet.close}
                size="content"
                footer={
                    <div className="flex flex-col gap-3">
                        {failed ? (
                            <p role="alert" className="text-body text-danger-text">
                                {renaming ? rename.failed : sheet.createFailed}
                            </p>
                        ) : null}
                        {/* Below 840 the primary fills the sheet and the × is the only way out; at 840+ a ghost Cancel sits
                            beside a content-width primary (`buildSpec.md` §5.1, F11). The primary's wrapper is a flex item:
                            stretched in the column below 840, its content's width in the row above. */}
                        <div className="flex flex-col gap-3 nav:flex-row nav:justify-end">
                            <div className="hidden nav:block">
                                <Button variant="ghost" onPress={requestClose}>
                                    {sheet.cancel}
                                </Button>
                            </div>
                            <div>
                                <Button
                                    icon={renaming ? 'check' : 'plus'}
                                    size="lg"
                                    width="fill"
                                    busy={submitting}
                                    onPress={submit}
                                >
                                    {renaming ? rename.save : sheet.create}
                                </Button>
                            </div>
                        </div>
                    </div>
                }
            >
                <div className="flex flex-col gap-4">
                    <div className="flex flex-col gap-1">
                        <FieldLabel forId={nameId} label={sheet.nameLabel} />
                        <Input
                            id={nameId}
                            value={name}
                            autoCapitalize="sentences"
                            invalid={nameError}
                            {...(nameError ? { describedBy: errorId } : {})}
                            onChangeText={draft.typeName}
                            onSubmit={submit}
                        />
                        <div className="flex items-start justify-between gap-3">
                            {nameError ? (
                                <p id={errorId} className="text-meta text-danger-text">
                                    {sheet.nameRequired}
                                </p>
                            ) : (
                                <span />
                            )}
                            {showsNameCounter(name) ? (
                                <span className="text-caption text-ink-muted tabular-nums lining-nums">
                                    {fillTemplate(sheet.counter, {
                                        count: name.length,
                                        max: COLLECTION_NAME_MAX_LENGTH,
                                    })}
                                </span>
                            ) : null}
                        </div>
                    </div>
                    <div className="flex flex-col gap-1">
                        <FieldLabel forId={descriptionId} label={sheet.descriptionLabel} />
                        <TextArea
                            id={descriptionId}
                            value={description}
                            minRows={2}
                            maxRows={6}
                            autoCapitalize="sentences"
                            onChangeText={draft.typeDescription}
                        />
                    </div>
                </div>
            </Sheet>
            <ConfirmDialog
                open={confirming}
                title={sheet.discardTitle}
                body={sheet.discardBody}
                confirm={{ label: sheet.discard, icon: 'trash' }}
                keep={{ label: sheet.keepEditing }}
                onConfirm={close}
                onKeep={draft.keepEditing}
            />
        </>
    );
};
