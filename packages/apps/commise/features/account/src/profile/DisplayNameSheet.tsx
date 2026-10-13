'use client';

/**
 * @module @commise/features-account/profile/DisplayNameSheet — the display-name sheet (web): "What should we call
 * you?", one field and Save (`buildSpec.md` §9.1).
 *
 * The name can show publicly as an author handle, so this sheet is the only place the app asks for it and it saves
 * only when Save is pressed (or Enter in the field) — never on close and never from the prefill alone. Controlled and
 * stateless: the page owns the draft, the gate (`canSaveDisplayName`) and the write.
 *
 * The field stops at its limit (a hard `maxLength`: the name is a public handle), so from 80 % of it a counter says how
 * close the cook is (W-26). The counter is NOT a live region (it would speak on every key); a separate polite one says
 * once that the limit is reached.
 *
 * @pattern Adapter over the design-system `Sheet`, `Input` and `FieldLabel` — the caption and the failure are the
 *     field's `describedBy`
 */
import { Button } from '@commise/ui/button';
import { FieldLabel, fieldHintId, Input } from '@commise/ui/input';
import { LiveRegion } from '@commise/ui/live-region';
import { Sheet } from '@commise/ui/sheet';
import { useMessages } from '@commise/i18n/react';
import { useId, type FC } from 'react';

import { profileMessages } from './messages.js';
import { DISPLAY_NAME_MAX_LENGTH, formatNameCounter, nameCounterOf } from './model.js';
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
    const counterId = useId();
    const counter = nameCounterOf(draft);

    return (
        <Sheet
            open={open}
            onOpenChange={onOpenChange}
            title={t.namePrompt}
            closeLabel={t.closeNameSheet}
            size="content"
            footer={
                <Button icon="check" width="fill" busy={saving} disabled={!canSave} onPress={onSave}>
                    {saving ? t.saving : t.save}
                </Button>
            }
        >
            <div className="flex flex-col gap-2">
                <FieldLabel forId={fieldId} label={t.displayName} hint={t.nameHint} />
                <Input
                    id={fieldId}
                    value={draft}
                    onChangeText={onDraftChange}
                    autoComplete="name"
                    autoCapitalize="words"
                    enterKeyHint="done"
                    maxLength={DISPLAY_NAME_MAX_LENGTH}
                    invalid={failed}
                    describedBy={[fieldHintId(fieldId), counter === undefined ? '' : counterId, failed ? errorId : '']
                        .filter((id) => id !== '')
                        .join(' ')}
                    onSubmit={() => {
                        if (canSave && !saving) {
                            onSave();
                        }
                    }}
                />
                {counter === undefined ? null : (
                    <p
                        id={counterId}
                        className={`text-caption ${counter.atLimit ? 'text-danger-text' : 'text-ink-muted'}`}
                    >
                        {formatNameCounter(t.nameCounter, counter)}
                    </p>
                )}
                <LiveRegion politeness="polite" visuallyHidden>
                    {counter?.atLimit === true ? t.nameLimitReached : ''}
                </LiveRegion>
                {failed ? (
                    <p id={errorId} role="alert" className="text-meta text-danger-text">
                        {t.saveFailed}
                    </p>
                ) : null}
            </div>
        </Sheet>
    );
};
