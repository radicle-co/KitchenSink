'use client';

/**
 * What both apps' editor screens draw over a {@link RecipeEditorSession}: the section map (each section's real leaves),
 * the Ingredients status pollers, the heading actions (Paste a list, Paste steps), the rail foot, and the preview, upsell
 * and make-public sheets. The web `RecipeEditorContainer` and the native `RecipeEditorScreen` each carried this JSX
 * line for line (UI audit 10); every leaf it uses is already a web/native pair, so this one file serves both.
 *
 * What stays in the app, and why:
 * - how the editor is SEEDED and where its URL or route goes: the web reads `?draft=`, `?fresh=` and `#section`, and
 *   redirects a recipe the server holds; a phone has no URL, so a new recipe's draft is found again only within the
 *   session that made it (ADR-0057, blueprint A4). That is a platform difference, not drift;
 * - the photo uploader ({@link RecipeEditorSurfaceProps.renderPhotos}), which each app wires to its own picker;
 * - the navigation port, the profile read and the error reporter, which are the session's inputs.
 *
 * ⚠️ The uploader is asked for only once the recipe exists on the server (its first checkpoint, which needs a title):
 * the upload takes a recipe id, and a picked photo's bytes cannot live in the device draft (ADR-0057).
 *
 * @pattern Composition — the editor's leaves arranged over one session; the app supplies the one leaf that differs
 */
import type { PaidFeatureState } from '@commise/features-account';
import { useMessages } from '@commise/i18n/react';
import { Button } from '@commise/ui/button';
import { RecipeVisibility } from '@kitchensink/recipe-core';
import type { FC, ReactNode } from 'react';

import { usePrivateChoice } from '../actions/usePrivateChoice.js';
import { RecipeMakePublicDialog } from '../actions/RecipeMakePublicDialog.js';
import { RecipeUpsellSheet } from '../actions/RecipeUpsellSheet.js';
import { IngredientsNutritionFoot } from '../form/IngredientsNutritionFoot.js';
import { PasteListSheet } from '../form/PasteListSheet.js';
import { PasteStepsControl } from '../form/PasteStepsControl.js';
import { RecipeBasicsFields } from '../form/RecipeBasicsFields.js';
import { RecipeIngredientsFields } from '../form/RecipeIngredientsFields.js';
import { RecipeInstructionsFields } from '../form/RecipeInstructionsFields.js';
import { RecipeVisibilityField } from '../form/RecipeVisibilityField.js';
import { RecipeVisibilityStatement } from '../form/RecipeVisibilityStatement.js';
import { entryFieldIdOf } from '../form/fieldIds.js';
import { pendingIngredientIds } from '../form/ingredientStatus.js';
import type { EditorSeed } from '../hooks/useRecipeEditor.js';
import type { RecipeEditorViewProps } from './frameProps.js';
import { IngredientStatusPoller } from './IngredientStatusPoller.js';
import { editorMessages } from './messages.js';
import { RecipeEditorView } from './RecipeEditorView.js';
import { RecipePreviewSheet } from './RecipePreviewSheet.js';
import { errorsStillHolding } from './gate.js';
import type { EditorSectionId } from './sections.js';
import type { RecipeEditorSession } from './useRecipeEditorSession.js';

/** What the app's photo uploader is mounted for. */
export interface PhotoUploaderTarget {
    readonly recipeId: string;
    readonly title: string;
    readonly cuisine: string;
}

/** Props for {@link RecipeEditorSurface}. */
export interface RecipeEditorSurfaceProps {
    /** The session the container mounted (`useRecipeEditorSession`). */
    readonly session: RecipeEditorSession;
    /** What the editor was seeded from: the saved visibility is the recipe's, a new recipe's is public. */
    readonly seed: EditorSeed;
    readonly mode: RecipeEditorViewProps['mode'];
    /** Where the device draft is kept: `tabSession` on web (D7), `disk` on mobile. */
    readonly keep: RecipeEditorViewProps['keep'];
    /** The viewer's paid-feature state, for what is SHOWN (`paidFeatureStateOf`). */
    readonly paidFeatures: PaidFeatureState;
    /** The profile's own answer, for what will be SENT (`knownPaidFeaturesOf`); never the display's fail-closed `hidden`. */
    readonly knownPaidFeatures: Exclude<PaidFeatureState, 'loading'> | undefined;
    /** The app's photo uploader. Called only once the recipe exists on the server. */
    readonly renderPhotos: (target: PhotoUploaderTarget) => ReactNode;
    /** The section a deep link names, jumped to once on mount (blueprint A16). */
    readonly initialSection?: EditorSectionId;
    /** Leave the editor (×). The session has already checkpointed the exit. */
    readonly onClose: () => void;
    /** "Check My recipes": from an unknown create's alert, and after a Discard. */
    readonly onOpenMyRecipes: () => void;
}

/** The editor page over its session. */
export const RecipeEditorSurface: FC<RecipeEditorSurfaceProps> = ({
    session,
    seed,
    mode,
    keep,
    paidFeatures,
    knownPaidFeatures,
    renderPhotos,
    initialSection,
    onClose,
    onOpenMyRecipes,
}) => {
    const { editor, paste } = session;
    // ⛔ READ FROM THE ENTRY AS IT IS NOW: the editor learns the entry's text only at a press (`errorsStillHolding`).
    const { pending } = session.rowEditor.entry;
    const pendingFieldId = pending === undefined ? undefined : entryFieldIdOf(pending.target);
    const errors = errorsStillHolding(editor.refusedFields, editor.values, session.rowEditor.entry.pendingEntryText);
    const { ingredients: ingredientsCopy } = useMessages(editorMessages);
    // E1 + plan 2026-10-14-009 D14: Private from the viewer's paid features alone — applied when granted, the Premium sheet
    // under upsell, the plain statement when hidden or still loading. "Saved" is what the server held when the editor
    // opened (a new recipe is public), so a choice back to it needs no entitlement.
    const privateChoice = usePrivateChoice({
        state: paidFeatures,
        knownPaidFeatures,
        saved: seed.recipe?.visibility ?? RecipeVisibility.PUBLIC,
        values: editor.values,
        onChange: editor.setValues,
    });

    const sections: Readonly<Record<EditorSectionId, ReactNode>> = {
        details: (
            <RecipeBasicsFields
                values={editor.values}
                errors={errors}
                onChange={editor.setValues}
                onFieldBlur={session.blur}
            />
        ),
        ingredients: (
            <>
                {pendingIngredientIds(editor.values).map((id) => (
                    <IngredientStatusPoller key={id} ingredientId={id} onStatus={session.applyLineStatus} />
                ))}
                <RecipeIngredientsFields
                    values={editor.values}
                    errors={errors}
                    onChange={editor.setValues}
                    nutrition={session.nutrition}
                    lookupRetry={session.lookupRetry}
                    rowEditor={session.rowEditor}
                    paste={paste.view}
                />
                <PasteListSheet sheet={paste.sheet} submitting={paste.submitting} failed={paste.failed} />
            </>
        ),
        steps: (
            <RecipeInstructionsFields
                values={editor.values}
                errors={errors}
                onChange={editor.setValues}
                onFieldBlur={session.blur}
            />
        ),
        photos: (
            <>
                {editor.recipeId === undefined
                    ? null
                    : renderPhotos({
                          recipeId: editor.recipeId,
                          title: editor.values.title,
                          cuisine: editor.values.cuisine,
                      })}
                {privateChoice.offersPrivate ? (
                    <RecipeVisibilityField
                        values={editor.values}
                        onChange={editor.setValues}
                        {...privateChoice.field}
                        onPremiumRequired={privateChoice.onPremiumRequired}
                        onConfirmPublic={privateChoice.onConfirmPublic}
                    />
                ) : (
                    <RecipeVisibilityStatement {...privateChoice.statement} />
                )}
            </>
        ),
    };

    return (
        <>
            <RecipeEditorView
                editor={editor}
                mode={mode}
                keep={keep}
                pendingEntryText={session.rowEditor.entry.pendingEntryText}
                pendingEntryFieldId={pendingFieldId}
                pastePending={paste.pending}
                sections={sections}
                // §7.2 and §7.5.6: the rail's foot shows the Ingredients total too, from the same draft and read.
                railFooter={<IngredientsNutritionFoot values={editor.values} nutrition={session.nutrition} />}
                headingActions={{
                    ...(paste.inHeading
                        ? {
                              ingredients: (
                                  <Button variant="ghost" icon="clipboardPaste" onPress={paste.open}>
                                      {ingredientsCopy.pasteList}
                                  </Button>
                              ),
                          }
                        : {}),
                    steps: <PasteStepsControl onAdd={session.appendSteps} />,
                }}
                {...(initialSection === undefined ? {} : { initialSection })}
                onClose={onClose}
                onPreview={session.preview.show}
                onRefused={session.rowEditor.refused}
                onOpenMyRecipes={onOpenMyRecipes}
            />
            <RecipePreviewSheet
                open={session.preview.open}
                recipe={session.preview.recipe}
                onClose={session.preview.hide}
            />
            <RecipeUpsellSheet {...privateChoice.sheet} />
            <RecipeMakePublicDialog {...privateChoice.confirm} />
        </>
    );
};
