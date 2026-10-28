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
    /**
     * Error shown when the server refused a restore because ONE line has no binding and the version saved no name
     * for it (plan 002 R52). Nothing was written; the preview marks the line.
     */
    readonly restoreUnrestorableErrorOne: string;
    /** The same refusal for two or more lines (contains `{count}`). */
    readonly restoreUnrestorableErrorMany: string;
    /** Changed-fields summary template (contains `{fields}`, a localized comma-joined field-name list). */
    readonly changedFields: string;
    /** Label shown on the earliest version in the list (which has no prior version to diff against). */
    readonly initialVersion: string;
    /** Visible label of the per-row Preview action (W6 Task 3 hook). */
    readonly preview: string;
    /** Accessible name of the Preview action, disambiguated per version (contains `{version}`). */
    readonly previewAction: string;
    /** The row menu's compare entry: this version against the current one (§6.6). */
    readonly compareWithCurrent: string;
    /** The row menu's and the preview's restore entry. */
    readonly restoreThis: string;
    /** The name of a row's ⋯ menu (contains `{version}`). */
    readonly rowActions: string;
    /**
     * A row's small secondary line (contains `{version}` and `{time}`, the relative edit time). The row's title is its
     * DATE, not this (owner 2026-10-13).
     */
    readonly rowDetail: string;
    /** The snackbar after a restore (contains `{version}`). */
    readonly restored: string;
    /** The snackbar's action that restores the version that was current before. */
    readonly undo: string;
    /** The empty state's explanation under its heading. */
    readonly emptyBody: string;
    /** The loading state's name, on both apps. */
    readonly loading: string;
    /** Why there is no history, when the read failed. */
    readonly loadError: string;
    /** The retry control beside {@link loadError}. */
    readonly retry: string;
    /** The "back to the recipe" affordance. */
    readonly backToRecipe: string;
    /**
     * The recipe, as the NAME of the place Back goes: the tablet's pinned bar draws it beside the chevron ("‹ Recipe").
     * It is the noun, not the label, which would read "‹ Back to recipe".
     */
    readonly recipeParent: string;
    /** The name of a row's ⋯ sheet's close control (native), per version. Not {@link backToRecipe}: it closes a sheet. */
    readonly rowMenuClose: string;
}

/** Shared copy for the concurrent-edit conflict resolution view (T070 / C-005 / W7). */
export interface RecipeConflictMessages {
    /** Accessible name + visible label of the header "Discard and close" exit (wireframe gap #1 —
     *  `conflict-resolution.md:34`'s `[< Discard and close]`) — the universal escape hatch back to the
     *  recipe WITHOUT resolving. Present in both the default (options) view and the merge panel, and NEVER
     *  disabled — see `useRecipeEditor`'s `discardAndClose` for why it must survive even a hung resolve. */
    readonly discardAndClose: string;
    /** Heading for the conflict panel. */
    readonly heading: string;
    /** Explanatory copy describing why the conflict is shown. */
    readonly explanation: string;
    /** Heading of the THEIRS card: the version saved somewhere else. Carries no version number. */
    readonly theirsCardHeading: string;
    /** Heading of the YOURS card: the cook's own unsaved edits. Carries no version number. */
    readonly yoursCardHeading: string;
    /** The YOURS card's status line when `base` is known (contains `{time}`, the absolute date the draft started from). */
    readonly yoursCardStatus: string;
    /** The YOURS card's status line when `base` was evicted from history (see `isConflictBaseStale`). */
    readonly yoursCardStatusUnknown: string;
    /** The THEIRS card's saved-time line (contains `{time}`): an ABSOLUTE localized date via `formatVersionTimestamp`. */
    readonly versionCardSavedLabel: string;
    /** A never-published draft's heading (ADR-0058: a draft records no versions, so nothing in its copy speaks of
     *  version numbers or history). `conflictCopyOf` lays the `draft*` slots over their published-recipe twins. */
    readonly draftHeading: string;
    /** A never-published draft's explanation: the other writer is the same cook, in another tab or on another device. */
    readonly draftExplanation: string;
    /** Shown when a save hit a version conflict this hook could NOT resolve into a side-by-side view (an
     *  un-enriched 409 body, or no cached recipe to project it onto) — `useRecipeEditor`'s
     *  `conflictDataUnavailable` flag. The save did NOT apply; this is the generic actionable fallback so the
     *  user is never left staring at an unchanged form with no feedback. */
    readonly dataUnavailable: string;
    /** Heading for the changed-only diff panel rendered below the three options (W7 Task 3 → Task 4). */
    readonly changedFieldsHeading: string;
    /** The "before" (base) value line template (contains `{value}`), rendered on a diff row ONLY when its
     *  `ConflictFieldRow.base` is present (W7 Task 4 / X1), absent on the base-evicted 2-way-fallback rows
     *  (see `conflictDiff.ts` module docs). Read as Before / Theirs / Yours beside the two side labels. */
    readonly wasValueLabel: string;
    /** Per-element STEP row label template (contains `{position}`, 1-based — W7 Task 4 / X1), e.g. "Step 3".
     *  Reused instead of the plural {@link stepsLabel} for a `ConflictFieldRow` (`./conflictDiff.ts`) whose
     *  `fieldKind` is `'step'`, so a per-element row is never mislabeled with the whole-collection name. */
    readonly stepPositionLabel: string;
    /** Per-element INGREDIENT row label template (contains `{value}`, the row's own formatted line — W7
     *  Task 4 / X1), e.g. "Ingredient: 200g Pasta". See {@link stepPositionLabel} for why a per-element row
     *  needs its own label rather than reusing the plural {@link ingredientsLabel}. */
    readonly ingredientRowLabel: string;
    /** The ACCESSIBLE name of an ingredient row whose labelled side is variant-bound (contains `{value}` and `{parts}`,
     *  the parts as `spokenVariantParts` joins them; curated U15, R27). Never visible text: the dotted line shows the
     *  parts (R25). */
    readonly ingredientRowLabelWithDetails: string;
    /** The word badge on a `marker: 'changed'` row: one side changed it. Text, so the marker is never colour or a glyph alone. */
    readonly markerBadgeChanged: string;
    /** The word badge on a `marker: 'conflict'` row: both sides changed it. */
    readonly markerBadgeConflict: string;
    /** Shown in place of the diff panel when `diff.rows` is empty: a defensive fallback (Task 2 already
     *  fast-paths a genuinely phantom-empty diff away from this view entirely, so this should not normally
     *  be reached) rather than rendering a silently blank panel (W7 Task 4). */
    readonly noDifferencesMessage: string;
    /** Option A's title: keep my changes, replacing the version saved elsewhere (the machine's Overwrite). */
    readonly optionKeepMineTitle: string;
    /** Option A's description. */
    readonly optionKeepMineDescription: string;
    /** Option B's title: use the version saved elsewhere and drop my changes (the machine's Keep server). */
    readonly optionUseTheirsTitle: string;
    /** Option B's description. */
    readonly optionUseTheirsDescription: string;
    /** Option C's title: compare field by field, then choose (enters the merge panel, FR-007c option c). */
    readonly optionCompareTitle: string;
    /** Option C's description. */
    readonly optionCompareDescription: string;
    /** Heading for the per-field merge panel. */
    readonly mergeHeading: string;
    /** Explanatory copy for the per-field merge panel. */
    readonly mergeExplanation: string;
    /** The merge panel's per-field "mine" radio side label (contains `{side}` in
     *  {@link mergeOptionLabel} — the panel's own within-field ordering keeps the user's draft first, since
     *  Option C's whole point is to let the user's OWN edits win field by field). */
    readonly mergeMineLabel: string;
    /** The merge panel's per-field "server" radio side label — see {@link mergeMineLabel}. */
    readonly mergeServerLabel: string;
    /** Per-field radio option template (contains `{side}` and `{value}`). */
    readonly mergeOptionLabel: string;
    /** The ACCESSIBLE name of an option whose side is variant-bound (contains `{side}`, `{value}` and `{parts}`; curated
     *  U15, R27). Never visible text — see {@link ingredientRowLabelWithDetails}. */
    readonly mergeOptionWithDetailsLabel: string;
    /** Label of the "save the merged result" action in the merge panel. */
    readonly mergeSubmit: string;
    /** Label of the "return to the three choices" action in the merge panel. */
    readonly mergeBack: string;
    /** The running "Summary of choices" template (W7 Task 5; contains `{server}` and `{mine}`, each an
     *  already-pluralized count phrase — see {@link mergeSummaryServerCountOne} / {@link mergeSummaryMineCountOne}). */
    readonly mergeSummaryTemplate: string;
    /** Singular "N choice(s) from server" count template (contains `{count}`) — see {@link mergeSummaryTemplate}. */
    readonly mergeSummaryServerCountOne: string;
    /** Plural "N choices from server" count template. See {@link mergeSummaryServerCountOne}. */
    readonly mergeSummaryServerCountOther: string;
    /** Singular "N choice from your version" count template. See {@link mergeSummaryServerCountOne}. */
    readonly mergeSummaryMineCountOne: string;
    /** Plural "N choices from your version" count template. See {@link mergeSummaryServerCountOne}. */
    readonly mergeSummaryMineCountOther: string;
    /** Inline hint shown next to a disabled Save/Resolve action while zero merge selections have been made
     *  (W7 Task 5 / X5) — the wireframe's "Merge with no selections: Resolve button disabled; inline hint
     *  per field" error-handling row. */
    readonly mergeNoSelectionHint: string;
    /** The stale-base warning (W7 Task 5 / X6) shown when the 409's base version was evicted from history OR
     *  the server is more than 10 versions ahead of it (`isConflictBaseStale`) —
     *  Overwrite and Save-merged both risk discarding changes the changed-fields panel never got to show. */
    readonly staleBaseWarning: string;
    /** Label of the explicit confirm checkbox the {@link staleBaseWarning} case requires before Overwrite or
     *  Save-merged proceeds. */
    readonly staleBaseConfirmLabel: string;
    /** Field label: recipe title. */
    readonly titleLabel: string;
    /** Field label: description. */
    readonly descriptionLabel: string;
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
 *  already relies on (`formatChangedFieldNames`), so a label is one piece of
 *  knowledge regardless of which version surface renders it. */
export interface RecipeVersionPreviewMessages {
    /** Modal heading template (contains `{version}` and `{title}`) — the loaded state. */
    readonly title: string;
    /** Modal heading shown while loading or on error, before the version's own title is known. */
    readonly titleLoading: string;
    /** Ingredients section heading template (contains `{version}`). */
    readonly ingredientsHeading: string;
    /** Steps section heading template (contains `{version}`); absent for a version that had no steps (D12). */
    readonly stepsHeading: string;
    /** Per-line calorie chip template (contains `{calories}`); rendered ONLY when the snapshot ingredient
     *  carries a `userCalories` override — never fabricated for a catalog-resolved line. */
    readonly caloriesLabel: string;
    /** "Changed from current" summary template (contains `{ingredients}` and `{steps}`), derived from
     *  `SnapshotDiff` vs. the recipe's CURRENT version. Each token is a
     *  PRE-PLURALIZED count string (e.g. "1 ingredient" / "2 ingredients") produced by
     *  `formatChangedFromCurrent` via the shared `ingredientCount*`/`stepCount*`
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
    /** The refusal of THIS version's restore for one line (plan 002 R52); it points at the line marked below. */
    readonly restoreUnrestorableErrorOne: string;
    /** The same refusal for two or more lines (contains `{count}`). */
    readonly restoreUnrestorableErrorMany: string;
    /**
     * Marker after each line the refused restore named. Plain text in the line, never colour alone, and in brackets
     * so it does not read as part of the line's name (`2 tbsp Name not saved (can’t be restored)`).
     */
    readonly lineCannotRestore: string;
}

/** Shared copy for the two-version compare panel (W6 Task 4 / FR-007b, FR-007c). Field labels are
 *  DELIBERATELY not duplicated here — the changed-only A/B rows reuse {@link RecipeConflictMessages}'s field
 *  labels (the same reuse {@link RecipeVersionPreviewMessages} and the row-level changed-fields summary
 *  already rely on), and the per-column headers reuse {@link RecipeVersionListMessages.versionLabel} — a
 *  field name or "Version {n}" label is one piece of knowledge regardless of which version surface renders
 *  it. */
export interface RecipeVersionCompareMessages {
    /** Panel/sheet heading (contains `{version}`): one version against the current one (§6.6). */
    readonly title: string;
    /** Accessible name of the close control. */
    readonly close: string;
    /** The column naming what the version said (contains `{version}`). */
    readonly wasLabel: string;
    /** The column naming what the recipe says now. */
    readonly nowLabel: string;
    /** Shown in a column where the element does not exist on that side (added or removed). */
    readonly noValue: string;
    /** Shown in place of the rows when the version matches the current one. */
    readonly noChanges: string;
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
            empty: 'No earlier versions yet',
            versionLabel: 'Version {version}',
            currentBadge: 'Current version',
            restore: 'Restore',
            restoreAction: 'Restore version {version}',
            restoringStatus: 'Restoring version {version}…',
            restoreConflictError:
                'This recipe changed since you opened its history. Review the refreshed list and try again.',
            restoreGenericError: 'We couldn’t restore that version. Try again.',
            restoreUnrestorableErrorOne:
                'This version can’t be restored: one of its ingredients no longer exists, and this version didn’t save its name. Nothing was changed. Preview the version to see which one.',
            restoreUnrestorableErrorMany:
                'This version can’t be restored: {count} of its ingredients no longer exist, and this version didn’t save their names. Nothing was changed. Preview the version to see which ones.',
            changedFields: 'Changed: {fields}',
            initialVersion: 'Initial version',
            preview: 'Preview',
            previewAction: 'Preview version {version}',
            compareWithCurrent: 'Compare with current',
            restoreThis: 'Restore this version',
            rowActions: 'More actions for version {version}',
            rowDetail: 'Version {version} · Edited {time}',
            restored: 'Restored version {version}.',
            undo: 'Undo',
            emptyBody: 'Each time you save changes, the version before is kept here.',
            loading: 'Loading version history…',
            loadError: 'We couldn’t load the version history.',
            retry: 'Try again',
            backToRecipe: 'Back to recipe',
            recipeParent: 'Recipe',
            rowMenuClose: 'Close actions for version {version}',
        },
        conflict: {
            discardAndClose: 'Discard and close',
            heading: 'This recipe changed while you were editing',
            explanation:
                'A newer version was saved somewhere else while you were editing here. Choose which one to keep.',
            theirsCardHeading: 'Saved elsewhere',
            versionCardSavedLabel: '{time}',
            yoursCardHeading: 'Your changes',
            yoursCardStatus: 'Not saved yet. Started from {time}',
            yoursCardStatusUnknown: 'Not saved yet',
            draftHeading: 'This draft changed somewhere else',
            draftExplanation:
                'You saved this draft in another tab or on another device while you were editing here. Choose which one to keep.',
            dataUnavailable: 'This recipe was changed elsewhere. Reload and try again.',
            changedFieldsHeading: 'Changed fields',
            wasValueLabel: 'Before: {value}',
            stepPositionLabel: 'Step {position}',
            ingredientRowLabel: 'Ingredient: {value}',
            ingredientRowLabelWithDetails: 'Ingredient: {value}, {parts}',
            markerBadgeChanged: 'Changed',
            markerBadgeConflict: 'Both changed',
            noDifferencesMessage: 'No differences to show.',
            optionKeepMineTitle: 'Keep mine',
            optionKeepMineDescription: 'Save your changes. They replace the version saved elsewhere.',
            optionUseTheirsTitle: 'Use theirs',
            optionUseTheirsDescription: 'Use the version saved elsewhere. Your changes here are dropped.',
            optionCompareTitle: 'Compare',
            optionCompareDescription: 'See each change side by side, then choose.',
            mergeHeading: 'Compare and choose',
            mergeExplanation:
                'Pick theirs or yours for each change. Nothing is picked for you. Save stays off until you pick at least one.',
            mergeMineLabel: 'Yours',
            mergeServerLabel: 'Theirs',
            mergeOptionLabel: '{side}: {value}',
            mergeOptionWithDetailsLabel: '{side}: {value}, {parts}',
            mergeSubmit: 'Save my choices',
            mergeBack: 'Back to options',
            mergeSummaryTemplate: 'Picked: {server}, {mine}',
            mergeSummaryServerCountOne: '{count} from theirs',
            mergeSummaryServerCountOther: '{count} from theirs',
            mergeSummaryMineCountOne: '{count} from yours',
            mergeSummaryMineCountOther: '{count} from yours',
            mergeNoSelectionHint: 'Pick at least one change to save.',
            staleBaseWarning:
                'Some changes saved elsewhere can’t be shown here. Keeping yours or comparing may undo changes you can’t see.',
            staleBaseConfirmLabel: 'I understand. Let me choose anyway',
            titleLabel: 'Title',
            descriptionLabel: 'Description',
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
            stepsHeading: 'Steps at v{version}',
            caloriesLabel: '{calories} cal',
            changedFromCurrent: 'Changed from current: {ingredients}, {steps}',
            loading: 'Loading version preview…',
            error: 'We couldn’t load that version. Try again.',
            keepCurrent: 'Keep current version',
            restoreThis: 'Restore this version',
            restoringThis: 'Restoring…',
            restoreUnrestorableErrorOne:
                'This version can’t be restored: one of its ingredients no longer exists, and this version didn’t save its name. It’s marked below. Nothing was changed.',
            restoreUnrestorableErrorMany:
                'This version can’t be restored: {count} of its ingredients no longer exist, and this version didn’t save their names. They’re marked below. Nothing was changed.',
            lineCannotRestore: '(can’t be restored)',
        },
        compare: {
            title: 'Version {version} and the current version',
            close: 'Close compare',
            wasLabel: 'Version {version}',
            nowLabel: 'Current',
            noValue: 'None',
            noChanges: 'This version matches the current one.',
        },
    },
};
