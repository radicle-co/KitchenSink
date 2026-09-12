/**
 * Recipe editor (mobile, T067; CP-6/P1 fully controlled; w3/e1,e2 rewired onto the 4-step `Wizard` shell;
 * U32/U33 re-laid-out). The presentational orchestration layer shared by the create and edit screens: it
 * wires the row editor and poll-after-add into step 2, and renders the
 * `Wizard` compound shell around one `Wizard.Step` per step, each hosting the SAME extracted
 * `RecipeBasicsFields`/`RecipeIngredientsFields`/`RecipeInstructionsFields`/`RecipeVisibilityField`/
 * `RecipeReviewFields` leaves the web containers use. It performs NO data fetching and runs NO mutation, and
 * owns NO state of its own: `values`/`errors`/the wizard's `step`/navigation come in from the caller and
 * every edit reports back via `onChange`/`goNext`/`goPrev`/etc.
 *
 * ⛔ **THE LAYOUT IS THE UNIT (U32).** Three siblings, in this order and no other:
 *   1. `Wizard.Header` — the sticky band with the back affordance. `RecipesScreen` renders pushed surfaces
 *      bare, so before this there was no title and no deliberate exit at all.
 *   2. a `ScrollView` holding the rail and the four step bodies.
 *   3. `Wizard.Controls` — the action bar, OUTSIDE that scroller.
 *
 * The third is a SHIPPED-DEFECT FIX, not a restyle: the bar used to sit inside the `ScrollView` alongside
 * everything else, so on a recipe with a long ingredient list a cook had to scroll past every row to reach
 * `Next`. `useScrollResetOnChange` exists because four Maestro flows caught the downstream consequence.
 * Nothing inside `Wizard.Controls` can enforce its own placement, so `tests/screens/RecipeEditor.native.test.tsx`
 * asserts the DOM ancestry here instead.
 *
 * ⚠️ **One limit, the Sheet's (`docs/design/compactHeightLayout.md` §4; owner ruling on I7).** When the header and the
 * bar together are taller than half the editor, the bar becomes the scroller's last content and scrolls with the step
 * (`isFooterUnpinned`, read through `usePinnedFooter`); the header, which holds the only exit, stays pinned. At the
 * default text size that happens only on a phone held sideways with its keyboard open, where a pinned bar would leave
 * the field being typed in about 19 dp; `Next` is then one keyboard dismissal away, and the bar pins again as the
 * frame grows back. Each place is a conditional at a FIXED position, so the scroller never changes index. The frame
 * is measured INSIDE the keyboard avoider: with `padding` the avoider's own frame does not shrink, its child does.
 *
 * **The field reveal (`docs/design/rowEditorOpenDecisions.md` E1).** This screen hosts it for the scroller: an
 * ingredient field whose list opens behind the pinned bar or the keyboard is scrolled to the top of the visible area,
 * once per opening. While that needs room, a blank space is the scroller's LAST child, after the bar's slot, so an
 * unpinned bar does not move (`useFieldRevealHost`).
 *
 * ⛔ **`photosSlot` renders on step 1, not step 4 (U33).** Photos are a field of Details now; step 4 is
 * Review. The caller supplies the surface because only it knows the recipe id and owns the upload queue.
 *
 * ⛔ **INGREDIENTS ARE PICK-FIRST (U28).** The only way a line enters `values.ingredients` is a pick in the fields
 * leaf's trailing add row (plan 002 V1 B8), committed through the row editor as `appendResolvedIngredient`, whose line
 * is a `ResolvedRecipeFormIngredient` — an unresolved row is not a value this screen can construct.
 *
 * The create screen (no seed/conflict/version concerns) owns its own local `values`/`errors`/step
 * `useState` and passes them down the same way the edit screen's `useRecipeEditor` hook does — same
 * controlled contract, different state owner.
 *
 * @pattern Orchestration layer over the `Wizard` compound-component shell shared by the create and edit screens — it
 *     wires the row editor into step 2 and hosts the extracted field groups.
 */
import {
    pendingIngredientIds,
    RecipeBasicsFields,
    RecipeIngredientsFields,
    RecipeInstructionsFields,
    RecipeReviewFields,
    RecipeVisibilityField,
    type DraftAction,
    type ObservedIngredientStatus,
    type SettledAnswer,
    Wizard,
    type GateOutcome,
    type RecipeFormErrors,
    type RecipeFormMode,
    type RecipeFormValues,
    type RecipeWizardStep,
} from '@commise/features-recipes';
import {
    useIngredientRowEditor,
    useLineNutrition,
    useLookupRetry,
    type LineCommandPort,
} from '@commise/features-recipes/hooks';
import { useMessages } from '@commise/i18n/react';
import { palette, tint } from '@commise/ui';
import { FieldRevealContext, RevealSpacer, useFieldRevealHost } from '@commise/ui/field-reveal';
import { KeyboardAvoider } from '@commise/ui/keyboard-avoider';
import { usePinnedFooter } from '@commise/ui/layout';
import type { JSX, ReactNode } from 'react';
import { useCallback } from 'react';

import { useScrollResetOnChange } from '../hooks/useScrollResetOnChange.js';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { IngredientStatusPoller } from '../components/IngredientStatusPoller.js';
import { mobileMessages } from '../i18n/messages.js';

/** Props for {@link RecipeEditor}. */
export interface RecipeEditorProps {
    /** Create vs edit, forwarded to the `Wizard`. Informational only (w3/e7) — Publish is named the same in both modes. */
    readonly mode: RecipeFormMode;
    /** The controlled draft (blank for create, seeded from the loaded recipe for edit). */
    readonly values: RecipeFormValues;
    /** Field-level validation errors to surface; absent/empty when the form is valid. */
    readonly errors?: RecipeFormErrors;
    /** Called with the next values on every field/row edit (add, remove, or change). */
    readonly onChange: (next: RecipeFormValues) => void;
    /**
     * Apply one draft transition to the draft as it is when it lands. ⛔ Every write that lands after a network call
     * (a picked line, a poll or retry answer) goes through this, never `onChange(applyDraftAction(values, …))`: a
     * `values` read before the call drops every edit the cook made while it ran.
     */
    readonly dispatch: (action: DraftAction) => void;
    /**
     * The edit screen's rebind command for a line the server stores (`useRecipeEditor`'s `lineCommand`), through which
     * a re-pick teaches (ADR-0045); `undefined` on the create screen, where nothing is stored yet. REQUIRED, so the edit
     * screen cannot leave it out and send a stored line's re-pick through the draft, where it teaches nothing.
     */
    readonly lineCommand: LineCommandPort | undefined;
    /** Whether the composing screen's create/update mutation is in flight. */
    readonly submitting: boolean;
    /** A localized error to surface above the wizard when the mutation failed. */
    readonly submitError?: string;
    /** The wizard's active step. */
    readonly step: RecipeWizardStep;
    /**
     * Whether `step` has no validation errors (the `[Next]` gate). `pendingEntryText` is what an ingredient entry holds
     * and has not committed (`validateRecipeForm`); this editor hosts the entry, so it supplies it.
     */
    readonly canAdvanceFrom: (step: RecipeWizardStep, pendingEntryText: string) => boolean;
    /** The validation errors belonging to `step` — drives the rail's invalid flag. */
    readonly stepErrors: (step: RecipeWizardStep, pendingEntryText: string) => RecipeFormErrors;
    /** Advance one step. Answers what the gate decided. */
    readonly goNext: (pendingEntryText: string) => GateOutcome;
    /** Go back one step. */
    readonly goPrev: () => void;
    /** Jump directly to a step. */
    readonly goToStep: (step: RecipeWizardStep) => void;
    /**
     * Persist as a draft. A refusal moves to the first step holding an error (`rowEditorOpenDecisions.md` R7). Answers
     * what the gate decided.
     */
    readonly saveDraft: (pendingEntryText: string) => GateOutcome;
    /** Whole-form validate then persist as published. Refuses and answers as {@link saveDraft} does. */
    readonly publish: (pendingEntryText: string) => GateOutcome;
    /** Whether the draft has unsaved edits relative to its baseline — drives the discard guard. */
    readonly isDirty: boolean;
    /** Called once Cancel is confirmed (or immediately when nothing would be lost). */
    readonly onCancel: () => void;
    /**
     * The photo surface, rendered on step 1 beside the other Details fields (U33).
     *
     * Caller-supplied because only the composing screen knows the recipe id and owns the upload queue. It is
     * no longer a "save this recipe first" notice on the create path: a pick is recorded in the draft
     * (`useRecipeDraftPhotos`) and handed to the upload queue by the create's success, so both screens pass a real
     * surface.
     */
    readonly photosSlot: ReactNode;
}

/**
 * The recipe create/edit wizard editor.
 *
 * @param props - Mode, the controlled draft + its change handler, the wizard's step/navigation, submission
 *   state, the discard guard's `isDirty`, and the caller-supplied Photos step body.
 * @returns The typeahead-augmented, controlled `Wizard`.
 */
export function RecipeEditor({
    mode,
    values,
    errors,
    onChange,
    dispatch,
    lineCommand,
    submitting,
    submitError,
    step,
    canAdvanceFrom,
    stepErrors,
    goNext,
    goPrev,
    goToStep,
    saveDraft,
    publish,
    isDirty,
    onCancel,
    photosSlot,
}: RecipeEditorProps): JSX.Element {
    const { recipes: t } = useMessages(mobileMessages);
    // Advancing a step must put the cook at the TOP of the new one — see the ScrollView below.
    const scroller = useScrollResetOnChange<ScrollView>(step);
    const pinning = usePinnedFooter();
    const reveal = useFieldRevealHost(scroller);

    // U6 empty-state guidance: a brand-new create drops into a blank Basics form — show first-step guidance
    // until the author has put anything in. Edit mode (seeded from a saved recipe) never shows it.
    const isEmptyDraft = values.title.trim() === '' && values.ingredients.length === 0 && values.steps.length === 0;
    const showFirstStepGuidance = mode === 'create' && isEmptyDraft;

    // Plan 002 V1 B5 — the editor's ONE background nutrition read, for every row's panel and the running total.
    const nutrition = useLineNutrition(values);

    // Plan 002 V1 B7 — the row editor, hoisted here because the wizard renders only the current step
    // (`docs/design/rowEditorBlueprint.md` decision 1). What its fields hold and have not committed blocks every gate
    // below (§4b).
    const rowEditor = useIngredientRowEditor({
        surface:
            lineCommand === undefined
                ? { kind: 'createForm', dispatch }
                : { kind: 'editForm', dispatch, command: lineCommand },
        lines: values.ingredients,
    });
    const { pendingEntryText } = rowEditor.entry;

    // Poll-after-add (data-model R5): a line added `PENDING` resolves in the background, and a settled line moves to
    // the binding the server answered with (plan 002). A settle that changes nothing returns the same draft, so the
    // per-line pollers below cannot loop. Both answers go through `dispatch`, so they meet the draft as it is when they
    // land.
    const applyLineStatus = useCallback(
        (polledId: string, observed: ObservedIngredientStatus): void => {
            dispatch({ kind: 'settleIngredientLines', answers: [{ polledId, observed }] });
        },
        [dispatch],
    );
    // Plan 002 V1 — a FAILED row's Try again: a status read that re-asks food, applied like a poll, as ONE transition
    // for every answer (staff-architect REVIEW F1).
    const applyLineStatuses = useCallback(
        (answers: readonly SettledAnswer[]): void => {
            dispatch({ kind: 'settleIngredientLines', answers });
        },
        [dispatch],
    );
    const lookupRetry = useLookupRetry(applyLineStatuses);

    return (
        // ⛔ The design system's keyboard avoider (its rule, both platforms, is `@commise/ui/keyboard-avoider`'s). The
        // compounding factor is specific to this screen: `Wizard.Controls` is deliberately OUTSIDE the ScrollView (U32),
        // pinned to the physical screen bottom — so with the keyboard up it is the FIRST thing the keyboard covers, and
        // step 2's ingredient typeahead has nowhere to render. The avoider's frame is read relative to `RecipesScreen`'s
        // container, which starts at the top of the window.
        <KeyboardAvoider style={styles.container}>
            {submitError !== undefined && submitError.length > 0 && (
                <Text accessibilityRole="alert">{submitError}</Text>
            )}
            <Wizard
                mode={mode === 'create' ? 'create' : 'edit'}
                step={step}
                values={values}
                // Every entry field's text is the row editor's, the trailing add row's too, and pending text blocks
                // each gate (§4b).
                canAdvanceFrom={(s) => canAdvanceFrom(s, pendingEntryText)}
                stepErrors={(s) => stepErrors(s, pendingEntryText)}
                goNext={() => rowEditor.refused(goNext(pendingEntryText))}
                goPrev={goPrev}
                goToStep={goToStep}
                saveDraft={() => rowEditor.refused(saveDraft(pendingEntryText))}
                publish={() => rowEditor.refused(publish(pendingEntryText))}
                onCancel={onCancel}
                isDirty={isDirty}
                submitting={submitting}
                pickFailures={rowEditor.pickFailures}
            >
                {/* The frame the pinned-footer limit reads: the editor's height inside the keyboard avoider. */}
                <View style={styles.frame} onLayout={pinning.onFrameLayout}>
                    {/* The sticky band: a back affordance routed through the discard guard, plus the step's name. */}
                    <View onLayout={pinning.onTopLayout}>
                        <Wizard.Header />
                    </View>
                    {/*
                      ⛔ `ref` is not decoration. This ONE ScrollView wraps the rail and all four step bodies, so
                      advancing a step swaps the body and leaves the scroller where it was — a cook who scrolled
                      down to reach `Next` lands at the BOTTOM of the next step, with the step heading off-screen.
                      Four Maestro flows caught it. See `useScrollResetOnChange` for why a ref is the only way.
                    */}
                    <ScrollView
                        ref={scroller}
                        style={styles.scroll}
                        contentContainerStyle={styles.scrollContent}
                        keyboardShouldPersistTaps="handled"
                        onLayout={reveal.onViewportLayout}
                    >
                        {/* The body takes the content's padding, so a bar in the scroller still spans the width. */}
                        <View style={styles.body}>
                            <Wizard.Rail />
                            <Wizard.Step step={1}>
                                {showFirstStepGuidance && (
                                    <View style={styles.guidance}>
                                        <Text accessibilityRole="header" style={styles.guidanceTitle}>
                                            {t.createGuidanceTitle}
                                        </Text>
                                        <Text style={styles.guidanceBody}>{t.createGuidanceBody}</Text>
                                    </View>
                                )}
                                <RecipeBasicsFields values={values} errors={errors} onChange={onChange} />
                                <RecipeVisibilityField values={values} onChange={onChange} />
                                {photosSlot}
                            </Wizard.Step>
                            <Wizard.Step step={2}>
                                {pendingIngredientIds(values).map((id) => (
                                    <IngredientStatusPoller key={id} ingredientId={id} onStatus={applyLineStatus} />
                                ))}
                                <FieldRevealContext.Provider value={reveal.revealer}>
                                    <RecipeIngredientsFields
                                        values={values}
                                        errors={errors}
                                        onChange={onChange}
                                        nutrition={nutrition}
                                        lookupRetry={lookupRetry}
                                        rowEditor={rowEditor}
                                    />
                                </FieldRevealContext.Provider>
                            </Wizard.Step>
                            <Wizard.Step step={3}>
                                <RecipeInstructionsFields values={values} errors={errors} onChange={onChange} />
                            </Wizard.Step>
                            <Wizard.Step step={4}>
                                <RecipeReviewFields values={values} />
                            </Wizard.Step>
                        </View>
                        {/* Past the limit only: the bar as the step's last item (see this module's doc). */}
                        {pinning.unpinned ? (
                            <View onLayout={pinning.onFooterLayout}>
                                <Wizard.Controls />
                            </View>
                        ) : null}
                        {/* While a field reveal needs room: always last, after the bar's slot (see this module's doc). */}
                        {reveal.spacer === null ? null : <RevealSpacer {...reveal.spacer} />}
                    </ScrollView>
                    {/*
                      ⛔ OUTSIDE the ScrollView above, and that placement IS the fix (U32). Inside it, the primary
                      control scrolled away beneath a long ingredient list. See this module's own doc, and the
                      DOM-ancestry assertion in `tests/screens/RecipeEditor.native.test.tsx` that pins it.
                    */}
                    {pinning.unpinned ? null : (
                        <View onLayout={pinning.onFooterLayout}>
                            <Wizard.Controls />
                        </View>
                    )}
                </View>
            </Wizard>
        </KeyboardAvoider>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    frame: { flex: 1 },
    scroll: { flex: 1 },
    scrollContent: { paddingTop: 12 },
    body: { gap: 16, paddingHorizontal: 16, paddingBottom: 48 },
    guidance: {
        gap: 4,
        borderRadius: 12,
        backgroundColor: tint(palette.seafoam, 0.1),
        borderWidth: 1,
        borderColor: tint(palette.seafoam, 0.25),
        paddingVertical: 12,
        paddingHorizontal: 16,
    },
    guidanceTitle: { fontSize: 15, fontWeight: '600', color: palette.charcoal },
    guidanceBody: { fontSize: 13, color: palette.slate },
});
