'use client';

/**
 * @module @commise/features-account/profile/DisplayNameSheet — the display-name sheet (web): "What should we call
 * you?", one field and Save (`buildSpec.md` §9.1).
 *
 * The name can show publicly as an author handle, so this sheet is the only place the app asks for it and it saves
 * only when Save is pressed (or Enter in the field) — never on close and never from the prefill alone. Controlled and
 * stateless: the page owns the draft, the gate (`canSaveDisplayName`) and the write.
 *
 * @pattern Adapter over the design-system `Sheet`, `Input` and `FieldLabel` — the caption and the failure are the
 *     field's `describedBy`
 */
import { Button } from '@commise/ui/button';
import { FieldLabel, Input } from '@commise/ui/input';
import { Sheet } from '@commise/ui/sheet';
import { useMessages } from '@commise/i18n/react';
import { useId, type FC } from 'react';

import { profileMessages } from './messages.js';
import type { DisplayNameSheetProps } from './props.js';

/** The display-name sheet. */
export const DisplayNameSheet: FC<DisplayNameSheetProps> = ({
    open,
    onOpenChange,
    draft,
    onDraftChange,
    canSave,
    saving,
    failed,
    onSave,
}) => {
    const t = useMessages(profileMessages);
    const fieldId = useId();
    const errorId = useId();

    return (
        <Sheet
            open={open}
            onOpenChange={onOpenChange}
            title={t.namePrompt}
            closeLabel={t.closeNameSheet}
            size="content"
            footer={
                <Button icon="check" busy={saving} disabled={!canSave} onPress={onSave}>
                    {saving ? t.saving : t.save}
                </Button>
            }
        >
            <div className="flex flex-col gap-2 px-4 py-4">
                <FieldLabel forId={fieldId} label={t.namePrompt} />
                <Input
                    id={fieldId}
                    value={draft}
                    onChangeText={onDraftChange}
                    autoComplete="name"
                    autoCapitalize="words"
                    enterKeyHint="done"
                    invalid={failed}
                    {...(failed ? { describedBy: errorId } : {})}
                    onSubmit={() => {
                        if (canSave && !saving) {
                            onSave();
                        }
                    }}
                />
                {failed ? (
                    <p id={errorId} role="alert" className="text-meta text-danger-text">
                        {t.saveFailed}
                    </p>
                ) : null}
            </div>
        </Sheet>
    );
};
