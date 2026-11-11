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
 * - the photo uploader ({@link RecipeEditorSurfaceProps.renderPhotos}), which each app wires to its own picker over the
 *   editor's one photo session (`useEditorPhotos`);
 * - the navigation port, the profile read and the error reporter, which are the session's inputs.
 *
 * The uploader is drawn on a new recipe too (owner ruling U33: a photo behaves like every other field). A photo picked
 * before the recipe exists waits in the session's queue until the first checkpoint gives it an id; its bytes cannot live
 * in the device draft (ADR-0057), so the surface asks before a leave would lose it, and a finish waits for it.
 *
 * @pattern Composition — the editor's leaves arranged over one session; the app supplies the one leaf that differs
 */
import type { PaidFeatureState } from '@commise/features-account';
import { useLocale, useMessages } from '@commise/i18n/react';
import { Button } from '@commise/ui/button';
import { ConfirmDialog } from '@commise/ui/confirm-dialog';
import { RecipeVisibility } from '@kitchensink/recipe-core';
import { useState, type FC, type ReactNode } from 'react';

import { recipeIsPublished, type PrivateRule, type SlotStanding } from '../actions/recipePrivateGate.js';
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
import { entryFieldIdOf } from '../form/fieldIds.js';
import { pendingIngredientIds } from '../form/ingredientStatus.js';
import type { EditorSeed } from '../hooks/useRecipeEditor.js';
import { useLastDefined } from '../hooks/useLastDefined.js';
import type { PhotoFinishBar, RecipeEditorViewProps } from './frameProps.js';
import { pluralOf } from '../format/plural.js';
import type { UseRecipePhotoManagerResult } from '../hooks/useRecipePhotoManager.js';
import { photoMessages } from '../photos/messages.js';
import { refusedRowsOf } from '../foodPage/privateFoodsRefusal.js';
import { IngredientStatusPoller } from './IngredientStatusPoller.js';
import { editorMessages } from './messages.js';
import { PrivateFoodsRefusalSheet } from './PrivateFoodsRefusalSheet.js';
import { PublishBlockedSheet } from './PublishBlockedSheet.js';
import { draftQuantity } from '../form/quantity.js';
import { refusedLineParts } from './refusedLineText.js';
import { RecipeEditorView } from './RecipeEditorView.js';
import { RecipePreviewSheet } from './RecipePreviewSheet.js';
import { errorsStillHolding } from './gate.js';
import type { EditorSectionId } from './sections.js';
import type { RecipeEditorSession } from './useRecipeEditorSession.js';

/** What the app's photo uploader is mounted for: the recipe, and the editor's one photo session it draws. */
export interface PhotoUploaderTarget {
    /** The recipe's server id, or `null` on a new recipe not created yet: its picks wait for the id (owner ruling U33). */
    readonly recipeId: string | null;
    readonly title: string;
    readonly cuisine: string;
    /** The editor's photo session (`useEditorPhotos`): the uploader acquires files and hands them here. */
    readonly manager: UseRecipePhotoManagerResult;
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
    /** Which rule the recipe's Private is under (`useRecipePrivate`): the cook's slots, or (an imported public-web recipe) Premium. */
    readonly privateRule: PrivateRule;
    /** Where the cook stands on private slots (`useRecipePrivate`), from the server's read. */
    readonly slotStanding: SlotStanding;
    /** The app's photo uploader, over the editor's photo session. Drawn on a new recipe too. */
    readonly renderPhotos: (target: PhotoUploaderTarget) => ReactNode;
    /** The section a deep link names, jumped to once on mount (blueprint A16). */
    readonly initialSection?: EditorSectionId;
    /** Leave the editor (×). The session has already checkpointed the exit. */
    readonly onClose: () => void;
    /** "Check My recipes": from an unknown create's alert, and after a Discard. */
    readonly onOpenMyRecipes: () => void;
    /**
     * Open a food's page (the row's `⋯ Open food`, and the refusal's Open food). Web opens a new tab so the draft stays here;
     * native pushes the page above the editor. Absent when the app has no such page.
     */
    readonly onOpenFood?: (foodId: string) => void;
    /** The app leaves this editor in place when it opens a food (native pushes a screen over it): the refusal then closes first. */
    readonly foodOpensOverEditor?: boolean;
}

/** The editor page over its session. */
export const RecipeEditorSurface: FC<RecipeEditorSurfaceProps> = ({
    session,
    seed,
    mode,
    keep,
    paidFeatures,
    knownPaidFeatures,
    privateRule,
    slotStanding,
    renderPhotos,
    initialSection,
    onClose,
    onOpenMyRecipes,
    onOpenFood,
    foodOpensOverEditor = false,
}) => {
    const { editor, paste, photos } = session;
    const photoCopy = useMessages(photoMessages);
    // ⛔ READ FROM THE ENTRY AS IT IS NOW: the editor learns the entry's text only at a press (`errorsStillHolding`).
    const { pending } = session.rowEditor.entry;
    const pendingFieldId = pending === undefined ? undefined : entryFieldIdOf(pending.target);
    const errors = errorsStillHolding(editor.refusedFields, editor.values, session.rowEditor.entry.pendingEntryText);
    const { ingredients: ingredientsCopy } = useMessages(editorMessages);
    const locale = useLocale();
    // Kept while the sheet closes, so its words do not change under its own animation.
    const blocked = useLastDefined(editor.publishBlocked);
    // E1 + plan 2026-10-14-009 D14, amended by ADR-0073: Private within the cook's slots (the count is the server's, shown
    // here and refused with its ways forward when none is left); for an imported public-web recipe still from the viewer's
    // paid features alone. "Saved" is what the server held when the editor opened (a new recipe is public), so a choice
    // back to it needs no slot and no entitlement.
    const privateChoice = usePrivateChoice({
        state: paidFeatures,
        knownPaidFeatures,
        rule: privateRule,
        standing: slotStanding,
        // ADR-0073 section 12: a draft holds no slot, so the field counts and refuses nothing for one. A Publish that
        // needs a slot asks in the blocked-publish dialog instead (owner ruling 2026-10-26).
        // `published` is the recipe's STATUS, not its lifecycle: a published recipe sent back to draft keeps its lifecycle
        // (versions) but holds no slot.
        publication: { published: recipeIsPublished(seed.recipe) },
        saved: seed.recipe?.visibility ?? RecipeVisibility.PUBLIC,
        values: editor.values,
        onChange: editor.setValues,
    });

    // F6: the server's refusal of a public recipe that holds a private food. The refused write is already dropped from the
    // outbox (`useRecipeEditor`), so the lines come from the editor and name the draft's rows by food. Each refusal has its own
    // count, so a sheet the cook dismissed opens again when the next Publish is refused.
    const refusal = editor.privateFoodRefusal;
    const refusedRows = refusal === undefined ? [] : refusedRowsOf(refusal.lines, editor.values);
    const [dismissedCount, setDismissedCount] = useState<number | undefined>(undefined);
    const refusalOpen = refusal !== undefined && refusedRows.length > 0 && dismissedCount !== refusal.count;
    const dismissRefusal = (): void => setDismissedCount(refusal?.count);
    const refusedLines = refusedRows.flatMap((index) => {
        const line = editor.values.ingredients[index];

        return line?.foodId === undefined
            ? []
            : [
                  {
                      rowId: line.key,
                      foodId: line.foodId,
                      ...refusedLineParts({ ...line, quantity: draftQuantity(line) }, locale),
                  },
              ];
    });

    // A finish waiting for its photos (`useEditorPhotos`): the action bar's line and its one control.
    const photoFinish: PhotoFinishBar | undefined =
        photos.finish === undefined
            ? undefined
            : {
                  line:
                      photos.finish.kind === 'failed'
                          ? pluralOf(photoCopy.drainFailed, photos.finish.count, locale)
                          : photoCopy.drainNotice,
                  danger: photos.finish.kind === 'failed',
                  actionLabel: photoCopy.finishWithout,
                  onAction: photos.finishWithout,
                  focusRequested: photos.finishFocusRequested,
                  onFocusRequestHandled: photos.onFinishFocusHandled,
              };
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
                    {...(onOpenFood === undefined ? {} : { onOpenFood })}
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
                {renderPhotos({
                    recipeId: editor.recipeId ?? null,
                    title: editor.values.title,
                    cuisine: editor.values.cuisine,
                    manager: photos.manager,
                })}
                {/* Waiting for photos after the finish, the recipe is already sent: a visibility change now would be lost. */}
                {photoFinish === undefined ? (
                    <RecipeVisibilityField
                        values={editor.values}
                        onChange={editor.setValues}
                        {...privateChoice.field}
                        onPremiumRequired={privateChoice.onPremiumRequired}
                        onConfirmPublic={privateChoice.onConfirmPublic}
                        // The refusal's "Make a private recipe public" and "Delete a private recipe": either frees a slot
                        // in the cook's recipes (the session checkpoints the draft as the cook leaves).
                        onFreeASlot={onOpenMyRecipes}
                    />
                ) : null}
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
                pasteReading={paste.reading}
                pasteNeedsYou={paste.needYou}
                pasteAdded={paste.added}
                openChoices={paste.openChoices}
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
                {...(photoFinish === undefined ? {} : { photoFinish })}
                photosAtRisk={photos.atRisk}
            />
            <ConfirmDialog
                open={photos.leave.open}
                title={photoCopy.leaveTitle}
                body={pluralOf(
                    photos.waitingForTitle ? photoCopy.leaveBodyNoTitle : photoCopy.leaveBody,
                    photos.atRiskCount,
                    locale,
                )}
                confirm={{ label: photoCopy.leaveConfirm, icon: 'trash' }}
                keep={{ label: photoCopy.leaveKeep }}
                onConfirm={photos.leave.confirm}
                onKeep={photos.leave.stay}
            />
            <RecipePreviewSheet
                open={session.preview.open}
                recipe={session.preview.recipe}
                onClose={session.preview.hide}
            />
            <RecipeUpsellSheet {...privateChoice.sheet} />
            <RecipeMakePublicDialog {...privateChoice.confirm} />
            {refusedLines.length === 0 ? null : (
                <PrivateFoodsRefusalSheet
                    open={refusalOpen}
                    door={recipeIsPublished(seed.recipe) ? 'save' : 'publish'}
                    canGoPrivate={privateChoice.field.privateRefusal === undefined}
                    lines={refusedLines}
                    onOpenFood={(foodId) => {
                        if (foodOpensOverEditor) {
                            dismissRefusal();
                        }

                        onOpenFood?.(foodId);
                    }}
                    onSendAsPrivate={() => {
                        dismissRefusal();
                        editor.setValues({ ...editor.values, visibility: RecipeVisibility.PRIVATE });

                        // The refused write is gone, so this sends the draft as it now is.
                        if (recipeIsPublished(seed.recipe)) {
                            editor.saveChanges(session.rowEditor.entry.pendingEntryText);
                        } else {
                            editor.publish(session.rowEditor.entry.pendingEntryText);
                        }
                    }}
                    onClose={dismissRefusal}
                />
            )}
            {blocked === undefined ? null : (
                <PublishBlockedSheet
                    open={editor.publishBlocked !== undefined}
                    slotTotal={
                        blocked.total !== undefined
                            ? blocked.total
                            : slotStanding.kind === 'full' || slotStanding.kind === 'open'
                              ? slotStanding.limit
                              : undefined
                    }
                    onKeepDraft={editor.keepAsDraft}
                    onPublishPublic={editor.publishAsPublic}
                />
            )}
        </>
    );
};
