/**
 * @module @commise/features-recipes/form — the create-my-own-food form on the design-system `Sheet`, native: a bottom
 * sheet (`docs/design/rowEditorOpenDecisions.md` item 1, "moved"; `docs/design/rowEditorBlueprint.md` decision 2).
 *
 * A presentational leaf with the web leaf's contract (`./authoredFoodSheet.ts`): it renders `useAuthoredFoodCreate`'s
 * state and reports every action. Native has no DOM focus: the Sheet puts the reading cursor on its title when it
 * shows, and the duplicate notice takes the cursor as it replaces the form, because the control that was pressed is
 * gone. One ref, for that move: `sendAccessibilityEvent` has no declarative form.
 *
 * Progress is said on a polite live region and a failure on an assertive one, both mounted empty so Android's
 * regions exist before their text is written.
 *
 * @pattern Adapter over the design-system `Sheet` — the form's states mapped to the sheet's slots
 */
import { useMessages } from '@commise/i18n/react';
import { palette } from '@commise/ui';
import { Button } from '@commise/ui/button';
import { LiveRegion } from '@commise/ui/live-region';
import { useScreenReaderFocusOnMount } from '@commise/ui/screen-reader-focus';
import { Sheet } from '@commise/ui/sheet';
import { TextInput } from '@commise/ui/text-input';
import { Feather } from '@expo/vector-icons';
import type { FC, JSX } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { AuthoredFoodDraft } from '../hooks/authoredFoodCreate.model.js';
import { useLastDefined } from '../hooks/useLastDefined.js';
import { fillTemplate } from '../list/model.js';
import { recipeMessages } from '../messages.js';
import {
    authoredFieldErrorText,
    authoredMacroFields,
    type AuthoredFoodSheetProps,
    type OpenAuthoredFoodState,
} from './authoredFoodSheet.js';
import { styles as formStyles } from './formSectionStyles.native.js';
import { recipeFormMessages } from './messages.js';

/** The form, the sheet's content while open. */
const FormBody: FC<{
    readonly state: Extract<OpenAuthoredFoodState, { kind: 'open' | 'submitting' }>;
    readonly props: AuthoredFoodSheetProps;
}> = ({ state, props }) => {
    const { ingredientCreateFood: copy } = useMessages(recipeMessages);
    const { statusAuthorFailed } = useMessages(recipeFormMessages);
    const submitting = state.kind === 'submitting';
    const fieldErrors = state.kind === 'open' ? state.fieldErrors : {};

    const field = (name: keyof AuthoredFoodDraft, label: string, numeric: boolean): JSX.Element => {
        const error = fieldErrors[name];

        return (
            <View key={name} style={[formStyles.field, numeric && styles.macro]}>
                {/* Visual only: the input carries the label as its own name, so this text is not read twice. */}
                <Text accessibilityElementsHidden importantForAccessibility="no" style={formStyles.fieldLabel}>
                    {label}
                </Text>
                <TextInput
                    accessibilityLabel={label}
                    value={state.draft[name]}
                    onChangeText={(value) => props.onFieldChange(name, value)}
                    editable={!submitting}
                    keyboardType={numeric ? 'decimal-pad' : 'default'}
                    aria-invalid={error !== undefined}
                    style={[
                        formStyles.input,
                        submitting && formStyles.inputReadOnly,
                        error !== undefined && styles.invalid,
                    ]}
                />
                {error !== undefined && <Text style={styles.error}>{authoredFieldErrorText(copy, error)}</Text>}
            </View>
        );
    };

    return (
        <View style={styles.body}>
            {field('name', copy.nameLabel, false)}
            <Text style={formStyles.fieldLabel}>{copy.per100gHint}</Text>
            <View style={styles.macros}>
                {authoredMacroFields(copy).map(({ field: name, label }) => field(name, label, true))}
            </View>
            {/* The one line telling the cook this is theirs alone until promotion (D9a/U11). */}
            <Text style={styles.muted}>{copy.privateHint}</Text>
            <LiveRegion politeness="polite" style={styles.muted}>
                {submitting ? copy.submitting : ''}
            </LiveRegion>
            <LiveRegion politeness="assertive" style={styles.error}>
                {state.kind === 'open' && state.submitFailed ? statusAuthorFailed : ''}
            </LiveRegion>
            <View style={styles.actions}>
                <Button
                    icon={<Feather name="check" size={16} color={palette.white} />}
                    busy={submitting}
                    onPress={props.onSubmit}
                >
                    {copy.submit}
                </Button>
                <Button
                    variant="secondary"
                    icon={<Feather name="x" size={16} color={palette.charcoal} />}
                    disabled={submitting}
                    onPress={props.onCancel}
                >
                    {copy.cancel}
                </Button>
            </View>
        </View>
    );
};

/** The per-author collision: its own sentence, which takes the reading cursor, and the reuse. */
const DuplicateBody: FC<{
    readonly state: Extract<OpenAuthoredFoodState, { kind: 'duplicate' }>;
    readonly props: AuthoredFoodSheetProps;
}> = ({ state, props }) => {
    const { ingredientCreateFood: copy } = useMessages(recipeMessages);
    const notice = useScreenReaderFocusOnMount<Text>();

    return (
        <View style={styles.body}>
            <Text ref={notice} style={styles.notice}>
                {fillTemplate(copy.duplicateNotice, { name: state.draft.name })}
            </Text>
            <LiveRegion politeness="assertive" style={styles.error}>
                {state.reuseFailed ? copy.duplicateReuseFailed : ''}
            </LiveRegion>
            <View style={styles.actions}>
                <Button
                    icon={<Feather name="check" size={16} color={palette.white} />}
                    busy={state.reusePending}
                    onPress={props.onReuse}
                >
                    {copy.duplicateReuse}
                </Button>
                <Button
                    variant="secondary"
                    icon={<Feather name="x" size={16} color={palette.charcoal} />}
                    disabled={state.reusePending}
                    onPress={props.onCancel}
                >
                    {copy.cancel}
                </Button>
            </View>
        </View>
    );
};

/** The authored-food Sheet. */
export const AuthoredFoodSheet: FC<AuthoredFoodSheetProps> = (props) => {
    const { state } = props;
    const { ingredientCreateFood: copy } = useMessages(recipeMessages);
    const content = useLastDefined<OpenAuthoredFoodState>(state.kind === 'closed' ? undefined : state);

    return (
        <Sheet
            open={state.kind !== 'closed'}
            onOpenChange={(open) => {
                if (!open) {
                    props.onCancel();
                }
            }}
            onDismissed={props.onDismissed}
            title={content === undefined ? '' : fillTemplate(copy.formTitle, { query: content.draft.name })}
            closeLabel={copy.close}
            size="content"
        >
            {content === undefined ? null : content.kind === 'duplicate' ? (
                <DuplicateBody state={content} props={props} />
            ) : (
                <FormBody state={content} props={props} />
            )}
        </Sheet>
    );
};

const styles = StyleSheet.create({
    body: { gap: 12 },
    macros: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    macro: { flexGrow: 1, minWidth: '45%' },
    invalid: { borderColor: palette['error-dark'] },
    error: { fontSize: 13, color: palette['error-dark'] },
    muted: { fontSize: 13, color: palette.slate },
    notice: { fontSize: 14, color: palette.charcoal },
    actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
