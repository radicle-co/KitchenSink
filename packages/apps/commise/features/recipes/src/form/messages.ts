/**
 * @module @commise/features-recipes/form/messages — user-facing copy for the recipe create/edit form
 * (T067). Its own {@link LocalizedMessages} dictionary (mirroring the shape of `../messages.ts`), exported
 * once and consumed by BOTH the web and native field-group leaves (`Recipe*Fields`) via `useMessages`, so the
 * platforms cannot drift on copy. The `en` set is required; adding a locale is just
 * another key. Templates carry `{token}` placeholders filled with `fillTemplate`.
 */
import type { LocalizedMessages } from '@commise/i18n';
import type { RecipeMealType } from '@kitchensink/recipe-core';

/** Shared copy for the recipe create/edit form, rendered by both the web and native form leaves. */
export interface RecipeFormMessages {
    /** Heading for the basics section. */
    readonly basicsHeading: string;
    /** Accessible label for the title field. */
    readonly titleLabel: string;
    /** Placeholder shown inside the title field. */
    readonly titlePlaceholder: string;
    /** Accessible label for the description field. */
    readonly descriptionLabel: string;
    /** Live character-counter template shown under title/description (contains `{count}`, `{max}`; w3/e6). */
    readonly charCounterTemplate: string;
    /** Accessible label for the cuisine field. */
    readonly cuisineLabel: string;
    /** The cuisine dropdown/picker's explicit "no cuisine stated" option label (w3/e5). */
    readonly cuisineUnsetOption: string;
    /** Group label for the difficulty radio group (FR-001b). */
    readonly difficultyLabel: string;
    /** Difficulty option: easy. */
    readonly difficultyEasy: string;
    /** Difficulty option: medium. */
    readonly difficultyMedium: string;
    /** Difficulty option: hard. */
    readonly difficultyHard: string;
    /** Difficulty option that clears a stated difficulty back to "not stated". */
    readonly difficultyNotStated: string;
    /**
     * Group label for the meal-type chip group (plan U34).
     *
     * ⛔ "Meal type", never "category". This is the ONE closed axis on the form — the field beneath it
     * (`tags`) is free text and is where a cook's own words go. Naming this one "Category" would invite
     * exactly the merge the mockup made, where its Dietary chips wrote into the same array as its Categories.
     */
    readonly mealTypeLabel: string;
    /**
     * The vocabulary's labels, keyed by wire value (plan U34). A RECORD, not a positional list: the association
     * is then the type, and a vocabulary member added in `recipe-core` without a label here is a compile error rather
     * than a blank chip.
     */
    readonly mealTypeOptions: Readonly<Record<RecipeMealType, string>>;
    /**
     * Meal-type option that clears a stated meal type back to "not stated".
     *
     * ⛔ Deliberately NOT the same words as {@link difficultyNotStated}, even though it is the same idea.
     * Both chips sit in the SAME form, and an option's label is its accessible NAME — two controls named
     * "Not stated" in one form are indistinguishable to anyone navigating by name, which is exactly the
     * failure WCAG 3.3.2 addresses (the same reason the two ingredient quantity spinbuttons carry distinct
     * names). The existing difficulty tests caught the collision the moment this chip group was added.
     */
    readonly mealTypeNotStated: string;
    /** Accessible label for the tags field. */
    readonly tagsLabel: string;
    /** Placeholder/hint for the tags + dietary chip inputs — explains the type-and-enter entry (U6). */
    readonly tagsHint: string;
    /** Accessible label template for a chip's remove control (contains `{value}`; U6). */
    readonly removeChipLabel: string;
    /** Accessible label template for the native chip input's Add control (contains `{field}`; U6). */
    readonly addChipLabel: string;
    /** Accessible label for the dietary-flags field. */
    readonly dietaryFlagsLabel: string;
    /** Accessible label for the servings field. */
    readonly servingsLabel: string;
    /** The servings stepper's − button. */
    readonly servingsDecrease: string;
    /** The servings stepper's + button. */
    readonly servingsIncrease: string;
    /** Spoken after a servings step (contains `{count}`). */
    readonly servingsAnnounce: string;
    /** Visible label of the prep-time duration field; it names its hours and minutes boxes. */
    readonly prepTimeLabel: string;
    /** Visible label of the cook-time duration field. */
    readonly cookTimeLabel: string;
    /** A duration field's hours box (contains `{field}`, the field's label). */
    readonly durationHoursLabel: string;
    /** A duration field's minutes box (contains `{field}`). */
    readonly durationMinutesLabel: string;
    /** The computed total under prep and cook (contains `{duration}`, already formatted). */
    readonly totalTimeValue: string;
    /** The Details section's group headings (H3, `docs/design/uiOverhaul/buildSpec.md` §7.4). */
    readonly groups: {
        readonly about: string;
        readonly timeAndServings: string;
        readonly kindOfDish: string;
        readonly dietAndTags: string;
    };
    /** The badge on the Private choice for a cook whose plan does not include private recipes. */
    readonly premiumBadge: string;
    /** The Paste steps sheet's close control (house form "Close {thing}"); the sheet's other copy is `editorMessages.steps`. */
    readonly pasteStepsClose: string;
    /** Label for the read-only computed total-time value. */
    readonly totalTimeLabel: string;
    /** Total-time unit template (contains `{minutes}`). */
    readonly durationMinutes: string;

    /** Heading for the ingredients section. */
    readonly ingredientsHeading: string;
    /** Ingredient-name field label template (contains `{number}`). */
    readonly ingredientNameLabel: string;
    /**
     * Note shown beside a unit that names no defined amount — `handful`, `splash`, `to taste` (plan U25).
     *
     * ⛔ It is a DESCRIPTION, not an error. A cook's measure is a legitimate thing to write, and the line is
     * accepted unchanged; what the note says is that nothing can weigh it, which is why the line adds nothing
     * to the nutrition total.
     */
    readonly ingredientUnitSubjectiveNote: string;
    /**
     * Note shown beside a unit this vocabulary has never seen (plan U25).
     *
     * ⛔ ALSO not an error, and deliberately distinct from the note above. The whole point of the three-way
     * classification is that a deliberate `handful` must not read like a mistyped `blorp` — which is what a
     * colour-only mark (the mockup's) cannot express, and what a two-way recognised/unrecognised split
     * cannot either.
     */
    readonly ingredientUnitUnknownNote: string;
    /**
     * The accessible name of the close control for a row's explanation (contains `{food}`). House form "Close {thing}"
     * (`@commise/ui/sheet`); signed off in the V1 sign-off (2026-10-01).
     */
    readonly ingredientStatusPanelCloseLabel: string;
    /**
     * The note a row with NO FOOD PICKED wears (plan U28).
     *
     * ⛔ It names the REMEDY, not just the fault. U28 removed every way to create such a row, so the only
     * ones a cook can meet arrived with a restored draft — and the row's own name field cannot fix it (a
     * line resolves through the picker, never by typing). Saying "remove it and add it from the search"
     * is the whole action available, and the brief is explicit that a row must "show what is missing"
     * rather than look complete and be discarded on save.
     *
     * ⚠️ Distinct from `errors.ingredientsUnresolved`, which is the FORM-level refusal the editor voices
     * when Publish is pressed: that one says the recipe cannot be published, this one says WHICH row and why.
     */
    readonly ingredientNoFoodNote: string;
    /** Empty-state copy shown when there are no ingredient lines yet. */
    readonly noIngredients: string;
    /** Paste a list: a pasted line over the parse job's bound. Holds `{line}` (1-based) and `{max}`. */
    readonly pasteRefusalLineTooLong: string;
    /** Paste a list: more lines than one job takes. Holds `{max}`. */
    readonly pasteRefusalTooManyLines: string;
    /** A row's second line while a pasted line is read (build spec §7.5.1, `rowState.reading`). */
    readonly rowStateReading: string;
    /** A row's second line when its lookup failed (build spec §7.5.1, `rowState.lookupFailed`). */
    readonly rowStateLookupFailed: string;
    /** A row's second line when the cook must pick among foods (build spec §7.5.1, `rowState.chooseMatch`). */
    readonly rowStateChooseMatch: string;
    /** A row's second line when nothing matched, or the line names no food (`rowState.noMatch`). */
    readonly rowStateNoMatch: string;
    /** A row's second line when its food's author withdrew it (`rowState.foodRemoved`). */
    readonly rowStateFoodRemoved: string;
    /** A row's second line while its food is looked up (`rowState.lookingUp`). */
    readonly rowStateLookingUp: string;
    /** A read row's open control (§7.5.1): `{item}` is the amount, the unit and the food, as the row reads them. */
    readonly rowOpenLabel: string;
    /** The row's `⋯` item that opens its editor. */
    readonly rowEdit: string;
    /** The attention line's name: `{state}` is its visible words, so the name contains them (SC 2.5.3). Holds `{food}`. */
    readonly rowAttentionLabel: string;
    /** A read row's note when the submit refused its amounts (U9); the list's own error says the rule. */
    readonly rowAmountInvalid: string;
    /** The row editor's Done (§7.5.2, `row.done`). */
    readonly rowDone: string;
    /** The phone row editor sheet's close control. Holds `{food}`. */
    readonly rowEditorClose: string;
    /** The row editor's amount field (`row.amountLabel`). */
    readonly rowAmountLabel: string;
    /** The visible word before a range's second field (§7.5.2: "reveals 'to' and a second field"). */
    readonly rowAmountTo: string;
    /** The range's second field's accessible name; it contains {@link rowAmountTo} (SC 2.5.3). */
    readonly rowAmountHighLabel: string;
    /** `row.addRange`. */
    readonly rowAddRange: string;
    /** `row.removeRange`. */
    readonly rowRemoveRange: string;
    /** `row.unitLabel`. */
    readonly rowUnitLabel: string;
    /** The unit field's suggestion list. */
    readonly rowUnitListLabel: string;
    /** `row.prepLabel`. */
    readonly rowPrepLabel: string;
    /** `row.change`: the row editor's Change, beside the food. */
    readonly rowChange: string;
    /** `row.foodDetails`, in the `⋯` and in the row editor. */
    readonly rowFoodDetails: string;
    /** The food line in the row editor when food publishes calories. Holds `{food}` and `{cal}`. */
    readonly rowFoodCalories: string;
    /** The Food details sheet's close control. Holds `{food}`. */
    readonly rowFoodDetailsClose: string;
    /** `row.moveToGroup`. */
    readonly rowMoveToGroup: string;
    /** `row.moveUp`. */
    readonly rowMoveUp: string;
    /** `row.moveDown`. */
    readonly rowMoveDown: string;
    /** The Move to group sheet's title. */
    readonly moveToGroupTitle: string;
    /** The Move to group sheet's close control. */
    readonly moveToGroupClose: string;
    /** The Move to group sheet's choice for an ungrouped line. */
    readonly moveToGroupNone: string;
    /** `group.add`: the section foot's "+ Add a group". */
    readonly groupAdd: string;
    /** The inline group-name field's label. */
    readonly groupNameLabel: string;
    /** The inline group-name field's submit. */
    readonly groupNameSave: string;
    /** The inline group-name field's cancel. */
    readonly groupNameCancel: string;
    /** A group's `⋯`. Holds `{group}`. */
    readonly groupActionsLabel: string;
    /** The native group-actions sheet's close. Holds `{group}`. */
    readonly groupActionsClose: string;
    /** `group.rename`. */
    readonly groupRename: string;
    /** The group heading's own add control: "Add ingredient to this group". */
    readonly groupAddIngredient: string;
    /** `group.remove`. */
    readonly groupRemove: string;
    /** The Paste a list sheet's close control, as `pasteStepsClose` names Paste steps'. */
    readonly pasteListClose: string;
    /** The running total (build spec §7.5.6): "{cal} cal per serving · {counted} of {total} counted". */
    readonly nutritionCounted: string;
    /** The running total while no line is counted: never "0 cal" (F7). */
    readonly nutritionEmpty: string;
    /**
     * Disclosure shown alongside the running total when a line states a RANGE and the figure was computed
     * from its LOWER bound (R38). A whole sentence per bound — see `rangeDerivedNotice`.
     */
    readonly nutritionRangeDerivedLow: string;
    /** The same disclosure for a figure computed from the UPPER bound (R38). */
    readonly nutritionRangeDerivedHigh: string;

    /** Resolution-status badge: awaiting resolution. */
    readonly statusPending: string;
    /** Resolution-status badge: not yet resolved. */
    readonly statusUnresolved: string;
    /** Resolution-status badge: resolved to a catalog item. */
    readonly statusResolved: string;
    /** Resolution-status badge: no catalog match found. */
    readonly statusNotFound: string;
    /** Resolution-status badge: resolution failed. */
    readonly statusFailed: string;
    /**
     * Resolution-status badge: the U11 verification gate contradicted this line (plan U14 / R15).
     *
     * ⛔ Distinct from every badge above. Those describe the FOOD LINK's lifecycle as food-service reports it;
     * this one is OUR own doubt about the match, and it is the only status a cook can act on by re-picking.
     */
    readonly statusNeedsReview: string;
    /**
     * Resolution-status badge: KTD-A's quiet "checking…" state (plan U4c/U13) — a zero-authority lexical
     * bind whose verification verdict has not landed yet. NOT actionable (nothing for the cook to do but
     * wait; the total re-flows as verdicts land), which is what separates it from `statusNeedsReview`.
     */
    readonly statusPendingVerification: string;
    /** U13 (D7/R9): the gate abstained over materially-different candidates — the pick affordance's badge. */
    readonly statusAmbiguous: string;
    /** U13 (R20): another author's private food — details unavailable to this viewer, never an error. */
    readonly statusResolvedUnavailable: string;
    /**
     * A line whose food its AUTHOR withdrew (owner rulings 3 + 4).
     *
     * ⛔ Distinct copy from {@link statusResolvedUnavailable} and {@link statusNotFound}, because it is a
     * distinct fact: unavailable means "exists, not served to you"; not-found means "no source ever had
     * it"; this means "we had it and it was taken away". The line keeps its amount.
     *
     * ⛔ "Food removed", NOT "Ingredient removed" — the first draft said the latter and it is FALSE. The
     * ingredient was not removed; it is right there with its quantity and unit intact. That is the
     * exact claim the detail surface spends a sentence denying, and asserting it here — on the surface
     * where a cook is most likely to act — was the worst place to say it.
     */
    readonly statusFoodRemoved: string;
    /**
     * A bound line whose food could not be read just now (plan 002 R2, R36).
     *
     * ⛔ "Not loaded", never "removed" or "missing": the line is still linked to its food, and an outage must never
     * read as a permanent fact about the cook's recipe.
     */
    readonly statusFoodUnreachable: string;
    /** Status word for a line whose name the cook declared ("use as written"), row 1 of SPECIFY.1. */
    readonly statusFreeform: string;

    /*
     * The row editor (plan 002 V1 B7). The authority for each text is `docs/design/ingredientStatusExplanation.md`
     * SPECIFY.2 and §3a, and `docs/design/rowEditorOpenDecisions.md` (cited per key as "item N").
     */
    /** The accessible name of an entry field's suggestion list (contains `{number}`). */
    readonly ingredientSuggestionsLabel: string;
    /** The hint on an entry field (WCAG 3.3.2). */
    readonly ingredientNameEditableHint: string;
    /** The polite count for one food found (item 5). Counts foods only. */
    readonly ingredientSuggestionCountOne: string;
    /** The polite count for more than one food found (contains `{count}`; item 5). */
    readonly ingredientSuggestionCountOther: string;
    /**
     * Neither of our database's groups holds a food for the text (contains `{query}`; S7 list contract P6). It speaks of
     * our database alone, so it stays true after remote foods arrive, and it names the way on, which is in the list.
     */
    readonly ingredientNoSuggestions: string;
    /** Both of our database's groups failed, while remote sources may still answer (S7 list contract P6). */
    readonly ingredientDatabaseUnavailable: string;
    /** The heading over Create my own food when remote foods show above it, or the answer was parked (P1). */
    readonly ingredientSuggestionsCreateHeading: string;
    /** Create my own food's accessible name, which says it opens a form (P1, 2.5.3, 3.2.2). */
    readonly createOwnFoodOptionName: string;
    /** The heading of the list's last group, the ways to fill a name that is not listed (item 1). */
    readonly ingredientSuggestionsMoreHeading: string;
    /** The `name` pick (contains `{query}`; item 1). */
    readonly ingredientEntryFindByName: string;
    /** The `declared` pick (contains `{query}`; item 1). */
    readonly ingredientEntryUseAsWritten: string;
    /** A pick on a row that names no food failed (contains `{query}`; item 1). Assertive. */
    readonly ingredientEntryFindByNameFailed: string;
    /**
     * A pick landed `UNRESOLVED` (contains `{name}`, the glyph label's own value, never the typed text; item 1), so the
     * sentence names a real control. Polite.
     */
    readonly ingredientAddedNeedsChoice: string;
    /** The heading of the cook's own foods, the database frame's authored group (S7 list contract P1). */
    readonly ingredientSuggestionsAuthoredHeading: string;
    /** The heading of the catalog's foods in the list (item 1). */
    readonly ingredientSuggestionsCatalogHeading: string;
    /** The catalog group was unavailable, so only the cook's own foods were searched (S7 P6). True at any count. */
    readonly ingredientCatalogUnavailable: string;
    /** The cook's own group was unavailable, so only the catalog was searched (S7 P6). True at any count. */
    readonly ingredientAuthoredUnavailable: string;
    /** A row's `name` pick is in flight (item 1). */
    readonly ingredientEntryAddingByName: string;
    /** A row's catalog pick is in flight (item 1). */
    readonly ingredientEntryAddingFromCatalog: string;
    /** A row's remote pick is in flight (contains `{source}`; S7 list contract P8). */
    readonly ingredientEntryAddingFromSource: string;
    /** A remote pick failed, or the line's commit after it did; choosing it again retries (contains `{name}`, `{source}`; P8). */
    readonly ingredientRemotePickFailed: string;
    /** A remote pick food refused: the food can no longer be picked (contains `{name}`; P8). */
    readonly ingredientRemotePickGone: string;
    /** Text on a row that names no food, after a refused save or Next (contains `{text}`; R7). */
    readonly ingredientEntryPending: string;
    /** Changed text on a row in Change food, after a refused save or Next (contains `{text}` and `{food}`; R7). */
    readonly ingredientEntryPendingChange: string;
    /** The visible text of Change food's way out (item 4). */
    readonly ingredientEntryCancel: string;
    /** Its accessible name (contains `{food}`): it starts with the visible text and says what is kept (item 4). */
    readonly ingredientEntryCancelLabel: string;
    /** A Change food pick did not take (contains `{food}`, the food the line still uses; item 4). Assertive. */
    readonly changeFoodFailed: string;
    /** The accessible name of the native clear button on an entry field (item 4). */
    readonly ingredientEntryClear: string;
    /** The row action that puts the name back into entry mode (§3a). */
    readonly statusActionChangeFood: string;
    /** A declared row's action: search for a food for its wording (§3a row 1). */
    readonly statusActionFindFood: string;
    /** The remove action, in the row's `⋮` menu (§3a). */
    readonly statusActionRemove: string;
    /** The `⋮` trigger's accessible name (contains `{food}`; §3a): it names its row, never a bare "More". */
    readonly ingredientActionsMenuLabel: string;
    /** The `⋮` trigger's name on a variant-bound row (contains `{food}` and `{parts}`; item 6). */
    readonly ingredientActionsMenuLabelWithDetails: string;
    /** The native `⋮` sheet's close control (contains `{food}`; V1 sign-off item 2). */
    readonly ingredientActionsMenuCloseLabel: string;
    /** The same on a variant-bound row (contains `{food}` and `{parts}`; item 6). */
    readonly ingredientActionsMenuCloseLabelWithDetails: string;
    /** The panel's close control on a variant-bound row (contains `{food}` and `{parts}`; item 6). */
    readonly ingredientStatusPanelCloseLabelWithDetails: string;
    /** The row action that opens the authored-food form (SPECIFY.2): generic, no name interpolated. */
    readonly createCustomFoodIconLabel: string;
    /** The authored food was saved and the line now uses it (SPECIFY.2). Polite: a success. */
    readonly statusAuthoredAndLinked: string;
    /** The cook already had a food of that name, and the line now uses it (SPECIFY.2). Polite: a success too. */
    readonly statusAuthoredDuplicateLinked: string;
    /** The authored food did not save; the form keeps the draft (SPECIFY.2, item 1). Assertive. */
    readonly statusAuthorFailed: string;
    /**
     * Row 2's panel (contains `{createLabel}`, `createCustomFoodIconLabel`): the two equal paths, fixing named first
     * (§5, §5a; SPECIFY.2).
     */
    readonly errorPromptEntryMode: string;
    /**
     * A nameless row 12's panel (contains `{changeFoodLabel}`, `statusActionChangeFood`;
     * `docs/design/namelessLineCopy.md` §6c).
     */
    readonly statusExplainFoodRemovedUnnamed: string;

    /** Row explanation, row 1: a declared line has no nutrition (the owner's sentence, verbatim). */
    readonly nutritionNoneAvailable: string;
    /**
     * Row explanation, row 5: the FOOD is still resolving. ⛔ Not a fetch in flight (`nutritionLoading`) — a cook can
     * retry neither, and the two must not share copy.
     */
    readonly nutritionWorking: string;
    /** Nutrition panel: the basis of food's figures. */
    readonly nutritionBasis: string;
    /** Nutrition panel: the calories label. */
    readonly nutritionCaloriesLabel: string;
    /** Nutrition panel: the protein label. */
    readonly nutritionProteinLabel: string;
    /** Nutrition panel: the carbohydrate label. */
    readonly nutritionCarbsLabel: string;
    /** Nutrition panel: the fat label. */
    readonly nutritionFatLabel: string;
    /** Nutrition panel: a gram figure (contains `{value}`). */
    readonly nutritionGramsTemplate: string;
    /** Nutrition panel: the footnote under an em dash — a figure food does not publish, never a `0`. */
    readonly nutritionFieldUnpublished: string;
    /** Nutrition panel: the cook's own figures for the line, which the total uses. */
    readonly nutritionUserStatedNote: string;
    /** Nutrition panel: matched, and food publishes no figures. An answer, not a failure. */
    readonly nutritionNoFiguresResolved: string;
    /** Nutrition panel, and the running total: the editor's nutrition read has not answered yet. */
    readonly nutritionLoading: string;
    /** Nutrition panel: the read failed or food could not be asked. Offers a retry. */
    readonly nutritionLoadFailed: string;
    /** The retry action (the nutrition read; a failed lookup). */
    readonly statusActionRetry: string;
    /**
     * The accessible name of a FAILED row's Try again (contains `{food}`): it asks food about ONE line again, which is
     * a different action from the nutrition read's Try again, so it gets its own name. The visible words come first
     * (SC 2.5.3); its visible text stays {@link statusActionRetry}.
     */
    readonly statusActionRetryLookupLabel: string;
    /** A FAILED row's panel while its retry runs. */
    readonly statusLookupRetrying: string;
    /** After a retry, the polite message for a RESOLVED outcome (contains `{food}`). */
    readonly statusResolvedConfirmation: string;
    /** After a retry, the polite message for any other outcome (contains `{food}` and `{status}`, the status word). */
    readonly statusLookupSettled: string;
    /** Row explanation, row 11: someone else's private food. Nothing is wrong. */
    readonly nutritionNoneUnavailable: string;
    /** Row explanation, row 6 (`UNRESOLVED`). */
    readonly statusExplainUnresolved: string;
    /**
     * Row 6's way out when no candidate is right: back to entry mode, the cook's words kept, nothing recorded
     * (`ingredientStatusExplanation.md` §3a, "Rows 6-7 must not be a dead end").
     */
    readonly statusActionNoneOfThese: string;
    /** Row 6's candidate list, named for the row (contains `{name}`; moved from the pickers' `disambiguateTitle`). */
    readonly candidatesLabel: string;
    /** Row 6: the candidates are being read (moved from the pickers' `disambiguateLoading`). */
    readonly candidatesLoading: string;
    /** Row 6: the candidates could not be read (moved from the pickers' `disambiguateError`). */
    readonly candidatesLoadFailed: string;
    /** Row 6: the binding has no candidates (the pickers' `disambiguateEmpty`, without the control it named). */
    readonly candidatesEmpty: string;
    /** Row 6: the pressed candidate did not resolve the binding (moved from the pickers' `resolveError`). */
    readonly candidatePickFailed: string;
    /** Row explanation, row 7 (`AMBIGUOUS`). */
    readonly statusExplainAmbiguous: string;
    /** Row explanation, row 8 (`NEEDS_REVIEW`). */
    readonly statusExplainNeedsReview: string;
    /** Row explanation, row 9 (`NOT_FOUND`). */
    readonly statusExplainNotFound: string;
    /** Row explanation, row 10 (`FAILED`): an outage, never the ingredient's fault. */
    readonly statusExplainFailed: string;
    /** Row explanation, row 12 (`FOOD_REMOVED`) on a row that KEPT its name. */
    readonly statusExplainFoodRemoved: string;
    /** Row explanation, row 13 (`FOOD_UNREACHABLE`): still linked, and saving keeps the link. */
    readonly statusExplainFoodUnreachable: string;

    /** Heading for the instructions section. */
    readonly stepsHeading: string;
    /** Step-instruction field label template (contains `{number}`). */
    readonly stepInstructionLabel: string;
    /** Accessible name of a step timer's hours box (contains `{number}`). */
    readonly stepTimerHoursLabel: string;
    /** Accessible name of a step timer's minutes box (contains `{number}`). */
    readonly stepTimerMinutesLabel: string;
    /** Short unit shown after a timer's hours box. */
    readonly timerHoursUnit: string;
    /** Short unit shown after a timer's minutes box. */
    readonly timerMinutesUnit: string;
    /** Add-step action label. */
    readonly addStep: string;
    /** Remove-step action label template (contains `{number}`). */
    readonly removeStep: string;
    /** Empty-state copy shown when there are no instruction steps yet. */
    readonly noSteps: string;

    /** Accessible label for the private-visibility toggle. */
    readonly visibilityLabel: string;

    /** Localized copy for each `RecipeFormErrorCode` validation error (B20). */
    readonly errors: {
        readonly titleRequired: string;
        readonly titleTooLong: string;
        readonly titleTooLongToSave: string;
        readonly ingredientsPendingText: string;
        readonly ingredientsEmpty: string;
        readonly ingredientsUnresolved: string;
        readonly ingredientsQuantityInvalid: string;
        readonly stepsRequired: string;
        readonly servingsPositive: string;
        readonly timesNonNegative: string;
    };
}

export const recipeFormMessages: LocalizedMessages<RecipeFormMessages> = {
    en: {
        basicsHeading: 'Basics',
        titleLabel: 'Title',
        titlePlaceholder: 'e.g. Weeknight Pasta',
        descriptionLabel: 'Description',
        charCounterTemplate: '{count}/{max}',
        cuisineLabel: 'Cuisine',
        cuisineUnsetOption: 'No cuisine',
        difficultyLabel: 'Difficulty',
        difficultyEasy: 'Easy',
        difficultyMedium: 'Medium',
        difficultyHard: 'Hard',
        difficultyNotStated: 'Not stated',
        mealTypeLabel: 'Meal type',
        mealTypeOptions: {
            breakfast: 'Breakfast',
            brunch: 'Brunch',
            lunch: 'Lunch',
            dinner: 'Dinner',
            snack: 'Snack',
            dessert: 'Dessert',
            drink: 'Drink',
        },
        mealTypeNotStated: 'No meal type',
        tagsLabel: 'Tags',
        tagsHint: 'Type and press Enter',
        removeChipLabel: 'Remove {value}',
        addChipLabel: 'Add {field}',
        dietaryFlagsLabel: 'Dietary flags',
        servingsLabel: 'Servings',
        servingsDecrease: 'Fewer servings',
        servingsIncrease: 'More servings',
        servingsAnnounce: 'Serves {count}',
        prepTimeLabel: 'Prep time',
        cookTimeLabel: 'Cook time',
        durationHoursLabel: '{field}, hours',
        durationMinutesLabel: '{field}, minutes',
        totalTimeValue: 'Total {duration}',
        groups: {
            about: 'About the recipe',
            timeAndServings: 'Time and servings',
            kindOfDish: 'Kind of dish',
            dietAndTags: 'Diet and tags',
        },
        premiumBadge: 'Premium',
        pasteStepsClose: 'Close paste steps',
        totalTimeLabel: 'Total time',
        durationMinutes: '{minutes} min',

        ingredientsHeading: 'Ingredients',
        ingredientNameLabel: 'Ingredient {number} name',
        ingredientUnitSubjectiveNote: 'Cook\u2019s measure',
        ingredientUnitUnknownNote: 'Unrecognised unit',
        ingredientStatusPanelCloseLabel: 'Close details for {food}',
        ingredientNoFoodNote: 'No food chosen — this line won’t be saved. Remove it and add it from the search above.',
        noIngredients: 'No ingredients yet. Add your first ingredient.',
        pasteRefusalLineTooLong: 'Line {line} is longer than {max} characters. Shorten it and try again.',
        pasteRefusalTooManyLines: 'That’s more than {max} lines. Paste them in smaller batches.',
        rowStateReading: 'Reading…',
        rowStateLookupFailed: 'Couldn’t look up',
        rowStateChooseMatch: 'Choose a match',
        rowStateNoMatch: 'No match found',
        rowStateFoodRemoved: 'Food no longer listed',
        rowStateLookingUp: 'Looking it up…',
        rowOpenLabel: 'Edit {item}',
        rowEdit: 'Edit',
        rowAttentionLabel: '{state}: {food}',
        rowAmountInvalid: 'Check the amount',
        rowDone: 'Done',
        rowEditorClose: 'Close {food}',
        rowAmountLabel: 'Amount',
        rowAmountTo: 'to',
        rowAmountHighLabel: 'Amount, up to',
        rowAddRange: 'Add a range',
        rowRemoveRange: 'Remove range',
        rowUnitLabel: 'Unit',
        rowUnitListLabel: 'Units',
        rowPrepLabel: 'Preparation',
        rowChange: 'Change',
        rowFoodDetails: 'Food details',
        rowFoodCalories: '{food} · {cal} cal per 100 g',
        rowFoodDetailsClose: 'Close food details for {food}',
        rowMoveToGroup: 'Move to group…',
        rowMoveUp: 'Move up',
        rowMoveDown: 'Move down',
        moveToGroupTitle: 'Move to group',
        moveToGroupClose: 'Close move to group',
        moveToGroupNone: 'No group',
        groupAdd: 'Add a group',
        groupNameLabel: 'Group name',
        groupNameSave: 'Save',
        groupNameCancel: 'Cancel',
        groupActionsLabel: 'Actions for {group}',
        groupActionsClose: 'Close actions for {group}',
        groupRename: 'Rename group',
        groupAddIngredient: 'Add ingredient to this group',
        groupRemove: 'Remove group (keep its ingredients)',
        pasteListClose: 'Close paste a list',
        nutritionCounted: '{cal} cal per serving · {counted} of {total} counted',
        nutritionEmpty: 'Nutrition appears as you match ingredients.',
        nutritionRangeDerivedLow: 'Estimated from the lower amount of each stated range',
        nutritionRangeDerivedHigh: 'Estimated from the upper amount of each stated range',

        statusPending: 'Resolving…',
        statusUnresolved: 'Not resolved',
        statusResolved: 'Resolved',
        statusNotFound: 'No match found',
        statusFailed: 'Resolution failed',
        statusNeedsReview: 'Needs review',
        statusPendingVerification: 'Checking…',
        statusAmbiguous: 'Needs a pick',
        statusResolvedUnavailable: 'Ingredient details unavailable',
        statusFoodRemoved: 'Food removed',
        statusFoodUnreachable: 'Not loaded',
        statusFreeform: 'Your own wording',

        ingredientSuggestionsLabel: 'Food suggestions for ingredient {number}',
        ingredientNameEditableHint: 'Type to search foods, then choose one.',
        ingredientSuggestionCountOne: '1 food found',
        ingredientSuggestionCountOther: '{count} foods found',
        ingredientNoSuggestions:
            'Nothing in your foods or the food catalog matches “{query}”. Keep typing, or find its nutrition by name.',
        ingredientDatabaseUnavailable: 'Your foods and the food catalog are unavailable right now.',
        ingredientSuggestionsCreateHeading: 'None of these?',
        createOwnFoodOptionName: 'Create my own food, opens a form',
        ingredientSuggestionsMoreHeading: 'Not listed?',
        ingredientEntryFindByName: 'Find nutrition for “{query}”',
        ingredientEntryUseAsWritten: 'Use “{query}” as written, without nutrition',
        ingredientEntryFindByNameFailed: 'We couldn’t add “{query}”. Try again, or use it as written.',
        ingredientAddedNeedsChoice:
            'Added {name}. It could be more than one food. Use its “Choose a match” line to choose one.',
        ingredientSuggestionsAuthoredHeading: 'Your foods',
        ingredientSuggestionsCatalogHeading: 'Food catalog',
        ingredientCatalogUnavailable: 'The food catalog is unavailable right now, so only your foods were searched.',
        ingredientAuthoredUnavailable: 'Your foods are unavailable right now, so only the food catalog was searched.',
        ingredientEntryAddingByName: 'Finding nutrition',
        ingredientEntryAddingFromCatalog: 'Adding from the food catalog',
        ingredientEntryAddingFromSource: 'Adding from {source}',
        ingredientRemotePickFailed: 'We couldn’t add {name} from {source}. Try again, or choose another food.',
        ingredientRemotePickGone: '{name} isn’t available any more. Choose another food.',
        ingredientEntryPending: '“{text}” isn’t in the recipe yet. Choose a food for it, or clear the box.',
        ingredientEntryPendingChange:
            '“{text}” isn’t in the recipe yet. Choose a food for it, or press Cancel to keep {food}.',
        ingredientEntryCancel: 'Cancel',
        ingredientEntryCancelLabel: 'Cancel, keep {food}',
        changeFoodFailed: 'The change didn’t save. This ingredient still uses {food}.',
        ingredientEntryClear: 'Clear text',
        statusActionChangeFood: 'Change food',
        statusActionFindFood: 'Find a food for this',
        statusActionRemove: 'Remove ingredient',
        ingredientActionsMenuLabel: 'Actions for {food}',
        ingredientActionsMenuLabelWithDetails: 'Actions for {food}, {parts}',
        ingredientActionsMenuCloseLabel: 'Close actions for {food}',
        ingredientActionsMenuCloseLabelWithDetails: 'Close actions for {food}, {parts}',
        ingredientStatusPanelCloseLabelWithDetails: 'Close details for {food}, {parts}',
        createCustomFoodIconLabel: 'Create my own food',
        statusAuthoredAndLinked: 'Saved to your foods, and this ingredient now uses it.',
        statusAuthoredDuplicateLinked: 'You already had a food with that name — this ingredient now uses it.',
        statusAuthorFailed: 'We couldn’t save that food. Your figures are still here — try again in a moment.',
        errorPromptEntryMode:
            'Fix the name above if it’s not quite right — or, if you know the name is correct, use “{createLabel}”.',
        statusExplainFoodRemovedUnnamed:
            'This food was removed from our food database, and its name went with it. Your amount is unchanged. Use “{changeFoodLabel}” to pick another.',

        nutritionNoneAvailable: 'No nutritional data available',
        nutritionWorking: 'We’re still looking this food up — figures will appear once it’s matched.',
        nutritionBasis: 'Per 100 g',
        nutritionCaloriesLabel: 'Calories',
        nutritionProteinLabel: 'Protein',
        nutritionCarbsLabel: 'Carbs',
        nutritionFatLabel: 'Fat',
        nutritionGramsTemplate: '{value} g',
        nutritionFieldUnpublished: '— means this figure isn’t published for this food.',
        nutritionUserStatedNote: 'These are the figures you entered for this line.',
        nutritionNoFiguresResolved: 'This food is matched, but no nutrition figures are published for it.',
        nutritionLoading: 'Loading nutrition…',
        nutritionLoadFailed: 'We couldn’t load the nutrition just now. Try again.',
        statusActionRetry: 'Try again',
        statusActionRetryLookupLabel: 'Try again for {food}',
        statusLookupRetrying: 'Looking this up again…',
        statusResolvedConfirmation: '{food} is matched. Its nutrition now counts.',
        statusLookupSettled: '{food}: {status}',
        nutritionNoneUnavailable:
            'This is matched to someone else’s private food, so its details aren’t shown. Your recipe is fine as it is.',
        statusExplainUnresolved: 'We found more than one food this could be, and we need you to say which.',
        statusActionNoneOfThese: 'None of these — search for a different food',
        candidatesLabel: 'Which “{name}” did you mean?',
        candidatesLoading: 'Loading options…',
        candidatesLoadFailed: 'We couldn’t load options for that ingredient.',
        candidatesEmpty: 'No options to choose from.',
        candidatePickFailed: 'We couldn’t resolve that ingredient.',
        statusExplainAmbiguous:
            'Two or more foods match closely and their nutrition differs, so we’d rather you chose.',
        statusExplainNeedsReview:
            'This is matched to a food, but what you wrote and what we matched don’t quite agree.',
        statusExplainNotFound: 'We searched the food database and there’s no match for this.',
        statusExplainFailed:
            'We couldn’t reach the food database. Nothing is wrong with your ingredient — try again in a moment.',
        statusExplainFoodRemoved: 'Whoever added this food has since removed it. Your amount and name are unchanged.',
        statusExplainFoodUnreachable:
            'We couldn’t load this ingredient’s name and nutrition just now. It’s still linked to its food, and saving keeps that link.',

        stepsHeading: 'Instructions',
        stepInstructionLabel: 'Step {number} instruction',
        stepTimerHoursLabel: 'Step {number} timer, hours',
        stepTimerMinutesLabel: 'Step {number} timer, minutes',
        timerHoursUnit: 'h',
        timerMinutesUnit: 'min',
        addStep: 'Add step',
        removeStep: 'Remove step {number}',
        noSteps: 'No steps yet. Add your first step.',

        visibilityLabel: 'Private recipe',

        errors: {
            titleRequired: 'A title is required.',
            titleTooLong: 'Shorten the title to 120 characters or fewer.',
            titleTooLongToSave: 'Shorten the title to 200 characters or fewer to save it.',
            ingredientsPendingText:
                'An ingredient you typed isn’t in the recipe yet. Choose a food for it, or delete what you typed.',
            ingredientsEmpty: 'Add at least one ingredient.',
            // U9 split this sentence in two. It used to read "...a resolved item AND a quantity greater than
            // zero", which stopped being true when an absent quantity became legal (R40): a line may now
            // state no amount at all. Each code names the one field it is about.
            ingredientsUnresolved: 'Every ingredient needs an item picked from the list.',
            ingredientsQuantityInvalid:
                'Check the quantities: an amount must be greater than zero, and a maximum must be above it. Leave both blank if the recipe states no amount.',
            stepsRequired: 'Add at least one instruction step.',
            servingsPositive: 'Servings must be greater than zero.',
            timesNonNegative: 'Times cannot be negative.',
        },
    },
};
