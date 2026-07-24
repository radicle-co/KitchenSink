/**
 * @module @commise/features-recipes/versions/messages — user-facing copy for the recipe version-history
 * (T069) and concurrent-edit conflict (T070) building blocks.
 *
 * Shared, platform-neutral strings kept as a {@link LocalizedMessages} dictionary, exported once and
 * consumed by BOTH the web `.tsx` and native `.native.tsx` leaves (via `useMessages`), so the platforms
 * cannot drift on copy. The `en` set is required; adding a locale is just another key. These live here
 * (not in the feature's shared `messages.ts`) so the version surface owns its own copy.
 */
import type { LocalizedMessages } from '@commise/i18n';

/** Shared copy for the recipe version-history list (T069). */
export interface RecipeVersionListMessages {
    /** Heading for the version-history panel. */
    readonly heading: string;
    /** Empty state shown when the recipe has no version history yet. */
    readonly empty: string;
    /** Per-version label template (contains `{version}`). */
    readonly versionLabel: string;
    /** Marker shown on the recipe's current (non-restorable) version. */
    readonly currentBadge: string;
    /** Visible label of the restore action. */
    readonly restore: string;
    /** Accessible name of the restore action, disambiguated per version (contains `{version}`). */
    readonly restoreAction: string;
    /** Busy status announced while a version is being restored (contains `{version}`). */
    readonly restoringStatus: string;
    /** Error shown when a restore fails because the recipe changed underneath (409 conflict, B17). */
    readonly restoreConflictError: string;
    /** Error shown when a restore fails for any other reason (B17). */
    readonly restoreGenericError: string;
    /** Editor attribution template (contains `{handle}`); rendered ONLY when `editorHandle` is present. */
    readonly byEditor: string;
    /** Device attribution suffix template (contains `{device}`), appended after {@link byEditor} when
     *  `deviceLabel` is also present. `deviceLabel` is untrusted free text — always rendered as text, never
     *  `dangerouslySetInnerHTML`. */
    readonly fromDevice: string;
    /** Changed-fields summary template (contains `{fields}`, a localized comma-joined field-name list). */
    readonly changedFields: string;
    /** Label shown on the earliest version in the list (which has no prior version to diff against). */
    readonly initialVersion: string;
    /** Visible label of the per-row Preview action (W6 Task 3 hook). */
    readonly preview: string;
    /** Accessible name of the Preview action, disambiguated per version (contains `{version}`). */
    readonly previewAction: string;
    /** Visible label of the per-row Compare-selection checkbox (W6 Task 5). */
    readonly compare: string;
    /** Accessible name of the Compare-selection checkbox, disambiguated per version (contains `{version}`). */
    readonly compareAction: string;
    /** Visible label of the "back to the recipe" affordance (V6 — rendered by the web leaf only; native
     *  screens, e.g. `RecipeVersionsScreen`, already compose their own back chrome). */
    readonly backToRecipe: string;
}

/** Shared copy for the concurrent-edit conflict resolution view (T070 / C-005). */
export interface RecipeConflictMessages {
    /** Heading for the conflict panel. */
    readonly heading: string;
    /** Explanatory copy describing why the conflict is shown. */
    readonly explanation: string;
    /** Heading for the user's own (in-progress) version column. */
    readonly mineHeading: string;
    /** Heading for the latest saved (their) version column. */
    readonly theirsHeading: string;
    /** Label of the "keep my version" choice. */
    readonly keepMine: string;
    /** Label of the "use the latest version" choice. */
    readonly useTheirs: string;
    /** Label of the "merge field by field" choice (enters the per-field merge panel — FR-007c option c). */
    readonly mergeAction: string;
    /** Heading for the per-field merge panel. */
    readonly mergeHeading: string;
    /** Explanatory copy for the per-field merge panel. */
    readonly mergeExplanation: string;
    /** Per-field radio option template (contains `{side}` and `{value}`). */
    readonly mergeOptionLabel: string;
    /** Label of the "save the merged result" action in the merge panel. */
    readonly mergeSubmit: string;
    /** Label of the "return to the three choices" action in the merge panel. */
    readonly mergeBack: string;
    /** Field label: recipe title. */
    readonly titleLabel: string;
    /** Field label: description. */
    readonly descriptionLabel: string;
    /** Field label: cuisine. */
    readonly cuisineLabel: string;
    /** Field label: tags. */
    readonly tagsLabel: string;
    /** Field label: dietary flags. */
    readonly dietaryFlagsLabel: string;
    /** Field label: visibility. */
    readonly visibilityLabel: string;
    /** Rendered value for a public recipe. */
    readonly visibilityPublic: string;
    /** Rendered value for a private recipe. */
    readonly visibilityPrivate: string;
    /** Rendered value for an empty field (no title, no tags, etc.). */
    readonly emptyValue: string;
    /** Field label: servings. */
    readonly servingsLabel: string;
    /** Field label: prep time. */
    readonly prepLabel: string;
    /** Field label: cook time. */
    readonly cookLabel: string;
    /** Field label: total time. */
    readonly totalLabel: string;
    /** Field label: ingredients. */
    readonly ingredientsLabel: string;
    /** Field label: steps. */
    readonly stepsLabel: string;
    /** Duration template (contains `{minutes}`). */
    readonly minutes: string;
    /** Singular ingredient-count template (contains `{count}`). */
    readonly ingredientCountOne: string;
    /** Plural ingredient-count template (contains `{count}`). */
    readonly ingredientCountOther: string;
    /** Singular step-count template (contains `{count}`). */
    readonly stepCountOne: string;
    /** Plural step-count template (contains `{count}`). */
    readonly stepCountOther: string;
}

/** Shared copy for the version preview modal (W6 Task 3 / FR-007b). Field labels (title/description/
 *  servings/prep/cook/total) are DELIBERATELY not duplicated here — the component reuses
 *  {@link RecipeConflictMessages}'s field labels, the same reuse the row-level changed-fields summary
 *  already relies on ({@link import('./model.js').formatChangedFieldNames}), so a label is one piece of
 *  knowledge regardless of which version surface renders it. */
export interface RecipeVersionPreviewMessages {
    /** Modal heading template (contains `{version}` and `{title}`) — the loaded state. */
    readonly title: string;
    /** Modal heading shown while loading or on error, before the version's own title is known. */
    readonly titleLoading: string;
    /** Ingredients section heading template (contains `{version}`). */
    readonly ingredientsHeading: string;
    /** Per-line calorie chip template (contains `{calories}`); rendered ONLY when the snapshot ingredient
     *  carries a `userCalories` override — never fabricated for a catalog-resolved line. */
    readonly caloriesLabel: string;
    /** "Changed from current" summary template (contains `{ingredients}` and `{steps}`), derived from
     *  {@link import('./diff.js').SnapshotDiff} vs. the recipe's CURRENT version. Each token is a
     *  PRE-PLURALIZED count string (e.g. "1 ingredient" / "2 ingredients") produced by
     *  {@link import('./model.js').formatChangedFromCurrent} via the shared `ingredientCount*`/`stepCount*`
     *  templates — this template itself carries no noun, so it never hard-codes a plural. */
    readonly changedFromCurrent: string;
    /** Accessible label + status text shown while the previewed version is being fetched. */
    readonly loading: string;
    /** Error shown when the previewed version failed to load. Not a dead end — Keep-current/Cancel still
     *  closes the modal. */
    readonly error: string;
    /** Label of the "keep current version" / cancel action (the single exit path, mirroring
     *  `PullUpdatesDialog`). */
    readonly keepCurrent: string;
    /** Label of the "restore this version" action. */
    readonly restoreThis: string;
    /** Label of the Restore action while a restore-from-preview is in flight (W6 Task 5) — replaces
     *  {@link restoreThis} so the busy state doesn't rely on styling alone to signal "don't click again". */
    readonly restoringThis: string;
}

/** Shared copy for the two-version compare panel (W6 Task 4 / FR-007b, FR-007c). Field labels are
 *  DELIBERATELY not duplicated here — the changed-only A/B rows reuse {@link RecipeConflictMessages}'s field
 *  labels (the same reuse {@link RecipeVersionPreviewMessages} and the row-level changed-fields summary
 *  already rely on), and the per-column headers reuse {@link RecipeVersionListMessages.versionLabel} — a
 *  field name or "Version {n}" label is one piece of knowledge regardless of which version surface renders
 *  it. */
export interface RecipeVersionCompareMessages {
    /** Panel/sheet heading template (contains `{versionA}` and `{versionB}`) — deliberately renders
     *  `{versionB}` FIRST (`Compare v{versionB} vs v{versionA}`), matching the wireframe's example "Compare
     *  v12 vs v8" for a caller comparing an older version A against a newer version B. */
    readonly title: string;
    /** Accessible name of the close ("×") control. */
    readonly close: string;
    /** Heading for the Diff Summary section. */
    readonly diffSummaryHeading: string;
    /** Localized "Added" count template (contains `{count}`); reused for BOTH the overall Diff Summary
     *  rollup and (when `showFullDiff` is toggled on) a `steps`/`ingredients` row's own tally. */
    readonly added: string;
    /** Localized "Removed" count template (contains `{count}`); see {@link added}. */
    readonly removed: string;
    /** Localized "Modified" count template (contains `{count}`); see {@link added}. */
    readonly modified: string;
    /** Label of the control that reveals each `steps`/`ingredients` row's per-collection Added/Removed/
     *  Modified tally (shown OFF by default so a same-count reorder never reads as a misleading per-line
     *  explosion — see {@link import('./model.js').buildCompareFieldRows}). */
    readonly showFullDiff: string;
    /** Label of the same control once the tally is showing. */
    readonly hideFullDiff: string;
    /** Message shown in place of the field rows when the two versions' snapshots are identical
     *  (`diff.changedFields` is empty). */
    readonly noChanges: string;
    /** Message shown when the panel is open but fewer than two versions (and/or no `diff`) have been
     *  supplied yet — the two-version SELECTION UI itself lives in the composing container (Task 5); this
     *  view only reports that a selection is still needed. */
    readonly selectTwoVersions: string;
}

/** The shape of the version surface's shared copy. */
export interface RecipeVersionMessages {
    /** Copy for the version-history list (T069). */
    readonly versionList: RecipeVersionListMessages;
    /** Copy for the concurrent-edit conflict view (T070). */
    readonly conflict: RecipeConflictMessages;
    /** Copy for the version preview modal (W6 Task 3). */
    readonly preview: RecipeVersionPreviewMessages;
    /** Copy for the two-version compare panel (W6 Task 4). */
    readonly compare: RecipeVersionCompareMessages;
}

export const recipeVersionMessages: LocalizedMessages<RecipeVersionMessages> = {
    en: {
        versionList: {
            heading: 'Version history',
            empty: 'No earlier versions yet.',
            versionLabel: 'Version {version}',
            currentBadge: 'Current version',
            restore: 'Restore',
            restoreAction: 'Restore version {version}',
            restoringStatus: 'Restoring version {version}…',
            restoreConflictError:
                'This recipe changed since you opened its history. Review the refreshed list and try again.',
            restoreGenericError: 'We couldn’t restore that version. Please try again.',
            byEditor: 'by @{handle}',
            fromDevice: ' (from {device})',
            changedFields: 'Changed: {fields}',
            initialVersion: 'Initial version',
            preview: 'Preview',
            previewAction: 'Preview version {version}',
            compare: 'Compare',
            compareAction: 'Select version {version} to compare',
            backToRecipe: 'Back to Recipe',
        },
        conflict: {
            heading: 'This recipe changed while you were editing',
            explanation: 'Someone saved a new version while you were making changes. Choose which version to keep.',
            mineHeading: 'Your version',
            theirsHeading: 'Latest saved version',
            keepMine: 'Keep my version',
            useTheirs: 'Use the latest version',
            mergeAction: 'Merge field by field',
            mergeHeading: 'Merge changes field by field',
            mergeExplanation:
                'For each field, choose which version to keep. Your version is selected by default — change any field to pull in the latest saved value.',
            mergeOptionLabel: '{side}: {value}',
            mergeSubmit: 'Save merged version',
            mergeBack: 'Back to options',
            titleLabel: 'Title',
            descriptionLabel: 'Description',
            cuisineLabel: 'Cuisine',
            tagsLabel: 'Tags',
            dietaryFlagsLabel: 'Dietary flags',
            visibilityLabel: 'Visibility',
            visibilityPublic: 'Public',
            visibilityPrivate: 'Private',
            emptyValue: 'None',
            servingsLabel: 'Servings',
            prepLabel: 'Prep time',
            cookLabel: 'Cook time',
            totalLabel: 'Total time',
            ingredientsLabel: 'Ingredients',
            stepsLabel: 'Steps',
            minutes: '{minutes} min',
            ingredientCountOne: '{count} ingredient',
            ingredientCountOther: '{count} ingredients',
            stepCountOne: '{count} step',
            stepCountOther: '{count} steps',
        },
        preview: {
            title: 'Version {version} Preview: {title}',
            titleLoading: 'Version preview',
            ingredientsHeading: 'Ingredients at v{version}',
            caloriesLabel: '{calories} cal',
            changedFromCurrent: 'Changed from current: {ingredients}, {steps}',
            loading: 'Loading version preview…',
            error: 'We couldn’t load that version. Please try again.',
            keepCurrent: 'Keep current version',
            restoreThis: 'Restore this version',
            restoringThis: 'Restoring…',
        },
        compare: {
            title: 'Compare v{versionB} vs v{versionA}',
            close: 'Close compare',
            diffSummaryHeading: 'Diff Summary',
            added: 'Added: {count}',
            removed: 'Removed: {count}',
            modified: 'Modified: {count}',
            showFullDiff: 'Show full diff',
            hideFullDiff: 'Hide full diff',
            noChanges: 'No changes between these versions.',
            selectTwoVersions: 'Select two versions to compare.',
        },
    },
};
