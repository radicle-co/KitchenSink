/**
 * @module @commise/features-recipes — native recipe create/edit form (T067 building block).
 *
 * The React Native leaf of `RecipeForm` — same controlled, presentational
 * contract and the same sections (Basics with a READ-ONLY computed total, a dynamic Ingredients list with
 * per-line resolution-status badges + add/remove, a dynamic Instructions list + add/remove, and a
 * visibility toggle). Styled to the Commise design language (@commise/ui palette): card sections, labeled
 * rounded fields, numbered seafoam step markers, and a seafoam primary. Mirrors the web `RecipeForm`.
 *
 * Photo upload (wireframe step 4) is intentionally OUT OF SCOPE here — a later increment adds it.
 *
 * The field groups below (Basics, Ingredients, Instructions, Visibility) are the shared
 * `Recipe*Fields.native.js`/`RecipeVisibilityField.native.js` leaves (w3) — this component's job is now just the `ScrollView` shell
 * (heading + submit/cancel chrome) that arranges them in one screen; the SAME leaves compose the 4-step edit
 * wizard (`wizard/Wizard.native.tsx`) one-to-one with its steps. This is a pure relocation: the rendered
 * output and every accessible name are unchanged from before the extraction.
 */
import { Button } from '@commise/ui/button';
import { useMessages } from '@commise/i18n/react';
import { palette } from '@commise/ui';
import { Feather } from '@expo/vector-icons';
import type { FC } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { recipeFormMessages } from './messages.js';
import { RecipeBasicsFields } from './RecipeBasicsFields.native.js';
import { RecipeIngredientsFields } from './RecipeIngredientsFields.native.js';
import { RecipeInstructionsFields } from './RecipeInstructionsFields.native.js';
import { RecipeVisibilityField } from './RecipeVisibilityField.native.js';
import type { RecipeFormProps } from './props.js';

export const RecipeForm: FC<RecipeFormProps> = ({
    values,
    errors,
    mode,
    submitting = false,
    onChange,
    onSubmit,
    onCancel,
}) => {
    const m = useMessages(recipeFormMessages);
    const headingText = mode === 'create' ? m.createHeading : m.editHeading;
    const submitLabel = mode === 'create' ? m.createSubmit : m.editSubmit;

    return (
        // A ScrollView, not a plain View: the form is taller than the viewport (Basics + ingredients + steps
        // + submit), so without it the fields below the fold — including the submit button — are unreachable
        // on a device. `keyboardShouldPersistTaps="handled"` lets a tap land on a button/field while the soft
        // keyboard is still open instead of being swallowed by the dismiss.
        <ScrollView
            accessibilityLabel={headingText}
            style={styles.scroll}
            contentContainerStyle={styles.container}
            keyboardShouldPersistTaps="handled"
        >
            <Text accessibilityRole="header" style={styles.heading}>
                {headingText}
            </Text>

            <RecipeBasicsFields values={values} errors={errors} onChange={onChange} />
            <RecipeIngredientsFields values={values} errors={errors} onChange={onChange} />
            <RecipeInstructionsFields values={values} errors={errors} onChange={onChange} />
            <RecipeVisibilityField values={values} onChange={onChange} />

            <View style={styles.actions}>
                <Button
                    icon={<Feather name="check" size={16} color={palette.white} />}
                    busy={submitting}
                    onPress={onSubmit}
                >
                    {submitLabel}
                </Button>
                <Button
                    variant="secondary"
                    icon={<Feather name="x" size={16} color={palette.charcoal} />}
                    onPress={onCancel}
                >
                    {m.cancel}
                </Button>
            </View>
        </ScrollView>
    );
};

const styles = StyleSheet.create({
    scroll: { flex: 1 },
    // Extra bottom padding so the submit/cancel actions clear the device's gesture/navigation bar at the
    // foot of the scroll.
    container: { gap: 16, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 48 },
    heading: { fontSize: 28, fontWeight: '700', color: palette.charcoal },
    actions: { flexDirection: 'row', alignItems: 'center', gap: 12 },
});
