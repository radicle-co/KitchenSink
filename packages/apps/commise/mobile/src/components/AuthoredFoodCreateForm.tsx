/**
 * The U16 create-your-own-food form — the NATIVE renderer over the shared `createFood` sub-machine
 * (`useIngredientResolver().createFood`; states in `authoredFoodCreate.model.ts`), the web
 * `AuthoredFoodCreateForm.tsx`'s sibling.
 *
 * A thin PRESENTATIONAL leaf (CP-6/P2): pure `props → JSX`, no fetching, no mutations — every action is
 * the hook's, every string the shared `IngredientCreateFoodMessages` copy, so the two platforms cannot
 * drift on what a duplicate or a failed submit says.
 *
 * Three states, three renders (exhaustive over the non-closed union): `open` (macros-only form, inline
 * per-field errors, the only-you visibility promise, the retryable submit alert), `submitting` (fields
 * disabled + a visible caption), and `duplicate` (⛔ its OWN sentence + a reuse affordance — never
 * generic validation copy: the cook already made this food, and the fix is to attach it).
 */
import { palette } from '@commise/ui';
import { PressScale } from '@commise/ui/press-scale';
import { fillTemplate } from '@commise/features-recipes';
import type { IngredientCreateFoodMessages } from '@commise/features-recipes';
import type {
    AuthoredFoodCreateState,
    AuthoredFoodDraft,
    AuthoredFoodFieldError,
} from '@commise/features-recipes/hooks';
import type { JSX } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

/** The actions the form wires — the hook's own, passed through untouched. */
export interface AuthoredFoodCreateFormActions {
    readonly cancel: () => void;
    readonly setField: (field: keyof AuthoredFoodDraft, value: string) => void;
    readonly submit: () => void;
    readonly reuseExisting: () => void;
}

export interface AuthoredFoodCreateFormProps {
    /** The sub-machine's state — never `closed` (the picker renders nothing then). */
    readonly state: Exclude<AuthoredFoodCreateState, { kind: 'closed' }>;
    readonly copy: IngredientCreateFoodMessages;
    readonly actions: AuthoredFoodCreateFormActions;
}

/** One field error key, mapped onto its localized sentence. Pure. */
function errorText(copy: IngredientCreateFoodMessages, error: AuthoredFoodFieldError): string {
    switch (error) {
        case 'required':
            return copy.errorRequired;
        case 'not_a_number':
            return copy.errorNotANumber;
        case 'out_of_range':
            return copy.errorOutOfRange;
    }
}

/** The four macro fields, with their localized labels, in the shared stable order. */
function macroFields(
    copy: IngredientCreateFoodMessages,
): ReadonlyArray<{ readonly field: Exclude<keyof AuthoredFoodDraft, 'name'>; readonly label: string }> {
    return [
        { field: 'calories', label: copy.caloriesLabel },
        { field: 'proteinG', label: copy.proteinLabel },
        { field: 'carbsG', label: copy.carbsLabel },
        { field: 'fatG', label: copy.fatLabel },
    ];
}

export function AuthoredFoodCreateForm({ state, copy, actions }: AuthoredFoodCreateFormProps): JSX.Element {
    if (state.kind === 'duplicate') {
        return (
            <View style={styles.card}>
                <Text style={styles.muted}>{fillTemplate(copy.duplicateNotice, { name: state.draft.name })}</Text>
                {state.reuseFailed && (
                    <Text accessibilityRole="alert" style={styles.error}>
                        {copy.duplicateReuseFailed}
                    </Text>
                )}
                <View style={styles.actions}>
                    <PressScale
                        accessibilityRole="button"
                        accessibilityLabel={copy.duplicateReuse}
                        disabled={state.reusePending}
                        busy={state.reusePending}
                        onPress={actions.reuseExisting}
                    >
                        <View style={[styles.primaryAction, state.reusePending && styles.actionDisabled]}>
                            <Text style={styles.primaryActionLabel}>{copy.duplicateReuse}</Text>
                        </View>
                    </PressScale>
                    <PressScale accessibilityRole="button" accessibilityLabel={copy.cancel} onPress={actions.cancel}>
                        <View style={styles.ghostAction}>
                            <Text style={styles.ghostActionLabel}>{copy.cancel}</Text>
                        </View>
                    </PressScale>
                </View>
            </View>
        );
    }

    const submitting = state.kind === 'submitting';
    const fieldErrors = state.kind === 'open' ? state.fieldErrors : {};

    /** One labeled input with its inline error. */
    const field = (name: keyof AuthoredFoodDraft, label: string, numeric: boolean): JSX.Element => {
        const error = fieldErrors[name];

        return (
            <View key={name} style={styles.field}>
                {/*
                 * VISUAL ONLY — the input below already carries `label` as its accessible NAME, so exposing
                 * this node too announces it twice and puts a SECOND element with that exact text on screen.
                 * `ParsePasteForm.native.tsx` carries the same note: the duplicate is what makes a
                 * label-targeted tap ambiguous, and the label resolving to an inert `Text` is why the U9
                 * flow's field tap found nothing to focus.
                 */}
                <Text accessibilityElementsHidden importantForAccessibility="no" style={styles.fieldLabel}>
                    {label}
                </Text>
                <TextInput
                    accessibilityLabel={label}
                    value={state.draft[name]}
                    onChangeText={(value) => actions.setField(name, value)}
                    editable={!submitting}
                    keyboardType={numeric ? 'decimal-pad' : 'default'}
                    style={[styles.input, error !== undefined && styles.inputInvalid]}
                    placeholderTextColor={palette.slate}
                />
                {error !== undefined && (
                    <Text accessibilityRole="alert" style={styles.error}>
                        {errorText(copy, error)}
                    </Text>
                )}
            </View>
        );
    };

    return (
        <View style={styles.card} accessibilityLabel={fillTemplate(copy.formTitle, { query: state.draft.name })}>
            <Text style={styles.heading}>{fillTemplate(copy.formTitle, { query: state.draft.name })}</Text>

            {field('name', copy.nameLabel, false)}

            <Text style={styles.sectionHint}>{copy.per100gHint}</Text>
            <View style={styles.macroGrid}>
                {macroFields(copy).map(({ field: name, label }) => field(name, label, true))}
            </View>

            {/* D9a/U11: the one line telling the cook this is theirs alone until promotion. */}
            <Text style={styles.muted}>{copy.privateHint}</Text>

            {submitting && <Text style={styles.muted}>{copy.submitting}</Text>}
            {state.kind === 'open' && state.submitFailed && (
                <Text accessibilityRole="alert" style={styles.error}>
                    {copy.submitFailed}
                </Text>
            )}

            <View style={styles.actions}>
                <PressScale
                    accessibilityRole="button"
                    accessibilityLabel={copy.submit}
                    disabled={submitting}
                    busy={submitting}
                    onPress={actions.submit}
                >
                    <View style={[styles.primaryAction, submitting && styles.actionDisabled]}>
                        <Text style={styles.primaryActionLabel}>{copy.submit}</Text>
                    </View>
                </PressScale>
                <PressScale
                    accessibilityRole="button"
                    accessibilityLabel={copy.cancel}
                    disabled={submitting}
                    onPress={actions.cancel}
                >
                    <View style={styles.ghostAction}>
                        <Text style={styles.ghostActionLabel}>{copy.cancel}</Text>
                    </View>
                </PressScale>
            </View>
        </View>
    );
}

const border = 'rgba(178, 190, 195, 0.3)';

const styles = StyleSheet.create({
    card: {
        backgroundColor: palette.white,
        borderColor: border,
        borderRadius: 12,
        borderWidth: 1,
        gap: 10,
        padding: 12,
    },
    heading: {
        color: palette.charcoal,
        fontSize: 15,
        fontWeight: '600',
    },
    sectionHint: {
        color: palette.slate,
        fontSize: 12,
        fontWeight: '600',
        letterSpacing: 0.4,
        textTransform: 'uppercase',
    },
    macroGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
    },
    field: {
        flexGrow: 1,
        gap: 4,
        minWidth: '45%',
    },
    fieldLabel: {
        color: palette.slate,
        fontSize: 13,
    },
    input: {
        borderColor: border,
        borderRadius: 8,
        borderWidth: 1,
        color: palette.charcoal,
        fontSize: 14,
        paddingHorizontal: 10,
        paddingVertical: 8,
    },
    inputInvalid: {
        borderColor: palette['error-dark'],
    },
    muted: {
        color: palette.slate,
        fontSize: 13,
    },
    error: {
        color: palette['error-dark'],
        fontSize: 13,
    },
    actions: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
    },
    primaryAction: {
        backgroundColor: palette.seafoam,
        borderRadius: 999,
        paddingHorizontal: 16,
        paddingVertical: 8,
    },
    primaryActionLabel: {
        color: '#ffffff',
        fontSize: 14,
        fontWeight: '600',
    },
    ghostAction: {
        backgroundColor: 'rgba(129, 236, 236, 0.12)',
        borderRadius: 999,
        paddingHorizontal: 16,
        paddingVertical: 8,
    },
    ghostActionLabel: {
        color: palette['ocean-dark'],
        fontSize: 14,
        fontWeight: '500',
    },
    actionDisabled: {
        opacity: 0.6,
    },
});
