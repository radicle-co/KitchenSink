/**
 * @module @commise/features-recipes/actions — `SourceStatementSheet` (native): the React Native leaf of
 * `./SourceStatementSheet.tsx`, on the same props, the same view model (`sheetViewOf`) and the same words. A bottom sheet on a
 * phone and a centred dialog from the tablet width, on the design-system `Sheet`. Styled with Tamagui only (ADR-0080).
 *
 * What differs from web, and why:
 * - The effect line is pinned in the footer, above the buttons, so it is read before the confirm at any text size; the body
 *   scrolls and the title and footer stay put.
 * - The two footer buttons are equal shares; their labels wrap and are never clipped.
 * - React Native has no `aria-describedby`: a field's error is its accessibility hint (`error`) as well as drawn.
 * - The platform back route is the dismiss, and does nothing while the change is in flight.
 *
 * @pattern Adapter over the design-system `Sheet` — the platform expression of the web leaf
 */
import { useMessages } from '@commise/i18n/react';
import { Button } from '@commise/ui/button';
import { FieldLabel, Input } from '@commise/ui/input';
import { RadioList } from '@commise/ui/radio-list';
import { Sheet } from '@commise/ui/sheet';
import { Text } from '@commise/ui/text';
import { useId, type FC } from 'react';
import { styled, XStack, YStack } from 'tamagui';

import { editorMessages } from '../editor/messages.js';
import { recipeActionMessages } from './messages.js';
import type { StatementAnswer } from './sourceStatement.js';
import { sheetViewOf } from './sourceStatementSheetModel.js';
import type { SourceStatementSheetProps } from './sourceStatementSheetProps.js';

const Body = styled(YStack, { name: 'SourceStatementBody', gap: '$4' });
const Field = styled(YStack, { name: 'SourceStatementField', gap: '$1' });
const Footer = styled(YStack, { name: 'SourceStatementFooter', gap: '$3' });
const Buttons = styled(XStack, { name: 'SourceStatementButtons', gap: '$3' });
// An equal share of the row, with room to wrap its label.
const Share = styled(YStack, { name: 'SourceStatementShare', flex: 1, flexBasis: 0, minWidth: 0 });

/** The source-statement sheet. */
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
    const fieldId = useId();
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
            closeLabel={m.close}
            size="content"
            presentation="dialog"
            footer={
                <Footer>
                    <Text typeRole="meta" color="$inkMuted">
                        {m.effect}
                    </Text>
                    <Buttons>
                        <Share>
                            <Button variant="secondary" width="fill" disabled={view.busy} onPress={onDismiss}>
                                {view.dismissLabel}
                            </Button>
                        </Share>
                        <Share>
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
                        </Share>
                    </Buttons>
                </Footer>
            }
        >
            <Body>
                <Text typeRole="body" color="$ink">
                    {m.body}
                </Text>
                <RadioList
                    label={m.title}
                    options={view.options}
                    value={view.value}
                    disabled={view.busy}
                    onChange={(id) => dispatch({ type: 'choose', answer: id as StatementAnswer })}
                />
                {field === undefined ? null : (
                    <Field>
                        <FieldLabel forId={fieldId} label={field.label} />
                        {/* Said above the field: below it, the keyboard and the pinned footer leave it off screen. */}
                        {field.error === undefined ? null : (
                            <Text typeRole="caption" color="$dangerText">
                                {field.error}
                            </Text>
                        )}
                        <Input
                            id={fieldId}
                            label={field.label}
                            value={field.value}
                            invalid={field.error !== undefined}
                            {...(field.error === undefined ? {} : { error: field.error })}
                            inputMode={field.kind === 'link' ? 'url' : 'text'}
                            autoCapitalize={field.kind === 'link' ? 'none' : 'sentences'}
                            {...(field.kind === 'link' ? { autoCorrect: false } : {})}
                            disabled={view.busy}
                            focusRequested={field.error !== undefined}
                            onFocusRequestHandled={() => undefined}
                            onChangeText={(text) =>
                                dispatch(field.kind === 'link' ? { type: 'link', text } : { type: 'bookTitle', text })
                            }
                            onSubmit={onConfirm}
                        />
                    </Field>
                )}
                {view.errorText === undefined ? null : (
                    <Text role="alert" typeRole="body" color="$dangerText">
                        {view.errorText}
                    </Text>
                )}
            </Body>
        </Sheet>
    );
};
