/**
 * @module @commise/features-recipes/collections — the native new-collection sheet, the twin of the web leaf
 * (`docs/design/uiOverhaul/buildSpec.md` §5.1), over the design-system `Sheet` (a content-height bottom sheet). It
 * replaces the `collectionCreate` screen.
 *
 * The same rules as the web leaf: a required name capped at 80 with a counter from 60, an optional description capped
 * at 280, an inline error for an empty name, an inline alert for a server failure that keeps the input, and a discard
 * confirmation for a typed name. Colours come from the theme at render.
 *
 * Presentational: it holds only what the cook is typing (the draft is UI state); the host runs the request.
 *
 * @pattern Adapter over the design-system `Sheet`, holding the form's own transient state
 */
import { useMessages } from '@commise/i18n/react';
import { Button } from '@commise/ui/button';
import { ConfirmDialog } from '@commise/ui/confirm-dialog';
import { FieldLabel, Input, TextArea } from '@commise/ui/input';
import { nativeTokens } from '@commise/ui/native';
import { Sheet } from '@commise/ui/sheet';
import { useTheme } from '@commise/ui/theme';
import { useId, type FC } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { fillTemplate } from '../format/fillTemplate.js';
import { COLLECTION_NAME_MAX_LENGTH, showsNameCounter } from './limits.js';
import { collectionMessages } from './messages.js';
import type { CollectionSheetProps } from './sheetModel.js';
import { useCollectionSheetDraft } from './useCollectionSheetDraft.js';

export type { CollectionCreateSheetProps, CollectionRenameSheetProps, CollectionSheetProps } from './sheetModel.js';

export const CollectionSheet: FC<CollectionSheetProps> = (props) => {
    const { open, submitting, failed } = props;
    const { sheet, rename } = useMessages(collectionMessages);
    const { colors } = useTheme();
    const nameId = useId();
    const descriptionId = useId();
    const errorId = useId();
    const draft = useCollectionSheetDraft(props);
    const { renaming, name, description, nameError, confirming, close, requestClose } = draft;
    const submit = (): void => draft.submit();

    return (
        <>
            <Sheet
                open={open && !confirming}
                onOpenChange={(next) => {
                    if (!next) {
                        requestClose();
                    }
                }}
                title={renaming ? rename.title : sheet.newTitle}
                closeLabel={sheet.close}
                size="content"
                footer={
                    <View style={styles.footer}>
                        {failed ? (
                            <Text role="alert" style={[styles.body, { color: colors.dangerText }]}>
                                {renaming ? rename.failed : sheet.createFailed}
                            </Text>
                        ) : null}
                        <Button
                            icon={renaming ? 'check' : 'plus'}
                            size="lg"
                            width="fill"
                            busy={submitting}
                            onPress={submit}
                        >
                            {renaming ? rename.save : sheet.create}
                        </Button>
                    </View>
                }
            >
                <View style={styles.form}>
                    <View style={styles.field}>
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
                        <View style={styles.underField}>
                            {nameError ? (
                                <Text
                                    nativeID={errorId}
                                    style={[styles.meta, styles.grow, { color: colors.dangerText }]}
                                >
                                    {sheet.nameRequired}
                                </Text>
                            ) : (
                                <View style={styles.grow} />
                            )}
                            {showsNameCounter(name) ? (
                                <Text style={[styles.caption, styles.figure, { color: colors.inkMuted }]}>
                                    {fillTemplate(sheet.counter, {
                                        count: name.length,
                                        max: COLLECTION_NAME_MAX_LENGTH,
                                    })}
                                </Text>
                            ) : null}
                        </View>
                    </View>
                    <View style={styles.field}>
                        <FieldLabel forId={descriptionId} label={sheet.descriptionLabel} />
                        <TextArea
                            id={descriptionId}
                            value={description}
                            minRows={2}
                            maxRows={6}
                            autoCapitalize="sentences"
                            onChangeText={draft.typeDescription}
                        />
                    </View>
                </View>
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

const styles = StyleSheet.create({
    form: { gap: nativeTokens.spacing[4] },
    field: { gap: nativeTokens.spacing[1] },
    underField: { flexDirection: 'row', alignItems: 'flex-start', gap: nativeTokens.spacing[3] },
    grow: { flex: 1 },
    footer: { gap: nativeTokens.spacing[3] },
    body: { ...nativeTokens.type.body },
    meta: { ...nativeTokens.type.meta },
    caption: { ...nativeTokens.type.caption },
    figure: { fontVariant: ['tabular-nums', 'lining-nums'] },
});
