/**
 * @module @commise/features-recipes/foodPage — `FoodEditSheet` (native): the React Native leaf of `./FoodEditSheet.tsx`, on
 * the same session and words. A bottom sheet with the fields on the design-system `Input` (which keeps itself in view while
 * the keyboard is up). Styled with Tamagui only.
 *
 * Presentational: `props → JSX` over `useFoodEdit`'s session.
 *
 * @pattern Adapter over the design-system `Sheet` — the form's session mapped to the sheet's slots
 */
import { useMessages } from '@commise/i18n/react';
import { Button } from '@commise/ui/button';
import { FieldLabel, Input } from '@commise/ui/input';
import { Sheet } from '@commise/ui/sheet';
import { Text as DesignText } from '@commise/ui/text';
import { useId, type FC } from 'react';
import { YStack } from 'tamagui';

import { fillTemplate } from '@commise/i18n';
import type { AuthoredFoodDraft } from '../hooks/authoredFoodCreate.model.js';
import { authoredFieldErrorText, authoredMacroFields } from '../form/authoredFoodSheet.model.js';
import { recipeMessages } from '../messages.js';
import { foodPageMessages } from './messages.js';
import type { FoodEditSession } from './useFoodEdit.js';

/** The edit sheet. */
export const FoodEditSheet: FC<{ readonly session: FoodEditSession }> = ({ session }) => {
    const { edit: m } = useMessages(foodPageMessages);
    const { ingredientCreateFood: copy } = useMessages(recipeMessages);
    const idPrefix = useId();
    const { draft, fieldErrors, submitting } = session;
    const noChange = session.sendsForReview ? m.noChangeSend : m.noChangeSave;
    const notice = session.notice === null ? undefined : m.notice[session.notice];
    const replaces = session.notice === 'replacesWaiting' ? m.notice.review : undefined;

    const field = (name: keyof AuthoredFoodDraft, label: string, inputMode: 'text' | 'decimal') => {
        const error = fieldErrors[name];
        const id = `${idPrefix}-${name}`;

        return (
            <YStack key={name} gap="$1">
                <FieldLabel forId={id} label={label} />
                <Input
                    id={id}
                    label={label}
                    value={draft[name]}
                    inputMode={inputMode}
                    onChangeText={(text) => session.onChange(name, text)}
                    invalid={error !== undefined}
                    {...(error === undefined ? {} : { error: authoredFieldErrorText(copy, error) })}
                />
            </YStack>
        );
    };

    return (
        <Sheet
            open={session.open}
            onOpenChange={(next) => {
                if (!next) {
                    session.onCancel();
                }
            }}
            title={fillTemplate(m.title, { name: session.name })}
            closeLabel={m.close}
            size="content"
        >
            <YStack gap="$3">
                {replaces === undefined ? null : (
                    <DesignText typeRole="caption" color="$inkMuted">
                        {replaces}
                    </DesignText>
                )}
                {notice === undefined ? null : (
                    <DesignText typeRole="caption" color="$inkMuted">
                        {notice}
                    </DesignText>
                )}
                {field('name', copy.nameLabel, 'text')}
                <DesignText typeRole="caption" color="$inkMuted">
                    {copy.per100gHint}
                </DesignText>
                {authoredMacroFields(copy).map(({ field: name, label }) => field(name, label, 'decimal'))}
                {session.failed ? (
                    <DesignText role="alert" typeRole="meta" color="$dangerText">
                        {m.failed}
                    </DesignText>
                ) : null}
                {session.duplicate ? (
                    <DesignText role="alert" typeRole="meta" color="$dangerText">
                        {m.duplicate}
                    </DesignText>
                ) : null}
                <Button
                    icon="check"
                    size="lg"
                    width="fill"
                    busy={submitting}
                    refused={session.unchanged}
                    {...(session.unchanged ? { description: noChange } : {})}
                    onPress={session.onSubmit}
                >
                    {submitting
                        ? session.sendsForReview
                            ? m.sending
                            : m.saving
                        : session.sendsForReview
                          ? m.send
                          : m.save}
                </Button>
                {session.unchanged ? (
                    <DesignText aria-hidden typeRole="caption" color="$inkMuted">
                        {noChange}
                    </DesignText>
                ) : null}
                <Button variant="secondary" size="lg" width="fill" onPress={session.onCancel}>
                    {m.cancel}
                </Button>
            </YStack>
        </Sheet>
    );
};
