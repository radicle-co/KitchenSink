/**
 * @module @commise/features-recipes/messages — user-facing copy for the recipe feature.
 *
 * Shared, platform-neutral strings live here as a {@link LocalizedMessages} dictionary, exported once and
 * consumed by BOTH the web `.tsx` and mobile `.native.tsx` leaves (via `useMessages`), so the platforms
 * cannot drift on copy. The `en` set is required; adding a locale is just another key. Strings specific to
 * the web or mobile app stay in those apps and are handled per platform.
 */
import type { LocalizedMessages } from '@commise/i18n';

/** Shared copy for the recipe-list screen (T065), rendered by both the web and native list views. */
export interface RecipeListMessages {
    /** Page/section heading for the recipe list. */
    readonly heading: string;
    /** Accessible name for the search field. */
    readonly searchLabel: string;
    /** Placeholder shown inside the search field. */
    readonly searchPlaceholder: string;
    /** Singular result-count template (contains `{count}`). */
    readonly countOne: string;
    /** Plural result-count template (contains `{count}`). */
    readonly countOther: string;
    /** Total-time unit template (contains `{minutes}`). */
    readonly durationMinutes: string;
    /** Accessible label for the loading state. */
    readonly loadingLabel: string;
    /** Heading of the empty state (a successful load with no recipes). */
    readonly emptyTitle: string;
    /** Body copy of the empty state. */
    readonly emptyBody: string;
    /** Heading of the no-match state (the caller HAS recipes, but none match the active search). */
    readonly noMatchTitle: string;
    /** Body copy of the no-match state. */
    readonly noMatchBody: string;
    /** Label of the "My Recipes" source tab (L5). */
    readonly tabMine: string;
    /** Label of the "Community" source tab (L5). */
    readonly tabCommunity: string;
    /** Accessible name for the source-tab control. */
    readonly tabsLabel: string;
    /** Accessible name for the quick-filter chip row (L4). */
    readonly filtersLabel: string;
    /** Label of the leading "All" chip that clears every active quick-filter (L4). */
    readonly filterAll: string;
    /** Visible label of the "Quick (<30m)" time-bucket quick-filter chip (recipe-list wireframe). */
    readonly filterQuick: string;
    /** The create entry's label and name, "New recipe": one tap opens the editor (build spec §3.4). */
    readonly createCta: string;
    /** Label of the empty-state create call to action (the sole create control when the list is empty). */
    readonly emptyCreateCta: string;
    /** Message shown when the list fails to load. */
    readonly errorTitle: string;
    /** Label of the retry action in the error state. */
    readonly retry: string;
    /** The notice when refreshing the recipes already on screen fails. */
    readonly refreshError: string;
    /** The Collections segment of the Recipes screen (`buildSpec.md` §4.3). */
    readonly tabCollections: string;
    /** The accessible name of the My recipes · Collections segments. */
    readonly segmentsLabel: string;
    /** The first-run "Paste ingredients" action (§4.3 first run). */
    readonly pasteIngredients: string;
    /** The no-match body for a search (contains `{query}`). */
    readonly noMatchQuery: string;
    /** The no-match body for chips. */
    readonly noMatchFilters: string;
    /** Clears the search. Also the search field's clear control. */
    readonly clearSearch: string;
    /** Clears every chip. */
    readonly clearFilters: string;
    /** The accessible name of the list/grid switch. */
    readonly viewLabel: string;
    /** The list segment's name. */
    readonly viewList: string;
    /** The grid segment's name. */
    readonly viewGrid: string;
    /** The sort control's visible label (contains `{choice}`). */
    readonly sortButton: string;
    /** The sort menu's title and accessible name. */
    readonly sortMenuLabel: string;
    /** Sort by last edit (the default). */
    readonly sortRecent: string;
    /** Sort by creation. */
    readonly sortNewest: string;
    /** Sort by title. */
    readonly sortTitle: string;
    /** Closes the native sort sheet. */
    readonly sortClose: string;
    /** "Load more" past 500 recipes. */
    readonly loadMore: string;
    /** Announced while more recipes load. */
    readonly loadingMore: string;
    /** When loading more recipes fails. */
    readonly loadMoreError: string;
}

/** Shared copy for the recipe-detail screen (T066), rendered by both the web and native detail views. */
export interface RecipeDetailMessages {
    /** Label for the prep-time meta stat. */
    readonly prepLabel: string;
    /** Label for the cook-time meta stat. */
    readonly cookLabel: string;
    /** Label for the total-time meta stat. */
    readonly totalLabel: string;
    /** Label for the servings meta stat. */
    readonly servingsLabel: string;
    /** Accessible name for the photo gallery. */
    readonly photosLabel: string;
    /** Photo alt-text template (contains `{title}` and `{index}`). */
    readonly photoAlt: string;
    /** Accessible name for the carousel's slide-activation button (contains `{title}` and `{index}`). */
    readonly photoOpen: string;
    /** Accessible name for the carousel's dot-navigation strip. */
    readonly photoDotsLabel: string;
    /** Accessible name for a single navigation dot (contains `{title}` and `{index}`). */
    readonly photoDot: string;
    /** Accessible name for the lightbox close control. */
    readonly lightboxClose: string;
    /** Heading for the ingredients section. */
    readonly ingredientsHeading: string;
    /** Badge shown on a user-entered (freeform) ingredient. */
    readonly userEnteredBadge: string;
    /**
     * Badge shown on a line the U11 verification gate CONTRADICTED (plan U14 / R15).
     *
     * ⛔ NOT interchangeable with {@link nutritionPartial}. That caveat says the catalog had nothing for a
     * line; this badge says the catalog HAD it and we withheld the figure because a check against the cook's
     * own source text disagreed with our match. A cook who cannot tell those apart cannot act on either.
     */
    readonly needsReviewBadge: string;
    /**
     * Whole-sentence disclosure for a recipe carrying exactly ONE doubted line.
     *
     * A separate string from the plural template rather than a template with a `1` in it, for the reason
     * every count string in this package is: English pluralization is not a substitution, and a locale that
     * inflects differently changes the string rather than the code.
     */
    readonly needsReviewNoticeOne: string;
    /** The same disclosure for two or more doubted lines (contains `{count}`). */
    readonly needsReviewNoticeMany: string;
    /**
     * Badge shown on a line the gate marked AMBIGUOUS (plan U13, D7/R9) — the pick affordance's entry.
     * ⛔ NOT the needs-review badge: that one says our match was CONTRADICTED and the figure withheld;
     * this one says the gate ABSTAINED over materially-different candidates and the figure still counts
     * (R23) — the author improves it by picking, nothing is broken.
     */
    readonly ambiguousBadge: string;
    /** The batched-review ENTRY for exactly one ambiguous line. */
    readonly ambiguousNoticeOne: string;
    /** The same entry for two or more (contains `{count}`). */
    readonly ambiguousNoticeMany: string;
    /** The review surface's own heading. */
    readonly ambiguousReviewHeading: string;
    /** Accessible name of the control that opens/closes the batched review surface. */
    readonly ambiguousReviewToggle: string;
    /** Per-row caption while a row's fresh shortlist loads. */
    readonly ambiguousReviewLoading: string;
    /** A pick the recipe TOOK — each pick is its own write, so dismissal is always safe. */
    readonly ambiguousReviewSaved: string;
    /** ⛔ A row whose pick the recipe REFUSED — retryable, and ONLY that row (the other lines' rows are unaffected). */
    readonly ambiguousReviewFailed: string;
    /** Retry control on a failed row. */
    readonly ambiguousReviewRetry: string;
    /**
     * The retry's accessible name, which starts with its visible text, because the page has one per row (contains
     * `{phrase}`; S7 list contract P12, 2.5.3).
     */
    readonly ambiguousReviewRetryLabel: string;
    /** A refreshed shortlist replaced a stale one (a picked id stopped resolving) — one line, no alarm. */
    readonly ambiguousReviewRefreshed: string;
    /**
     * Badge on a line whose food its author WITHDREW (owner rulings 3 + 4), when the line kept its name. A line
     * that lost its name shows `ingredientLineName.removedFood` in the name's place instead.
     *
     * ⛔ Distinct from the private-food stand-in, and the difference is not cosmetic. That one says the food
     * exists and is not served to THIS viewer — a privacy answer, and nothing is wrong. This one says the
     * food is gone for everyone, which is a fact about the world and permanent. A cook who cannot tell
     * those apart cannot tell "not for me" from "no longer exists".
     */
    readonly removedFoodBadge: string;
    /*
     * ⛔ COPY NOTES for the three strings below, each recording a defect a UX audit found in the first
     * draft (2026-09-08) rather than a style preference:
     *
     * 1. **"our food database", never "the food list".** The first draft named a surface that does not
     *    exist anywhere in this product — not a nav item, not a screen, not a heading. That is worse than
     *    jargon: jargon at least points at something, and this invited "where is the food list, and why
     *    did it delete my ingredient?"
     * 2. **"marked below", never "marked in the list".** The plural string used "list" twice, one sentence
     *    apart, for two opposite referents — our food database, then the cook's own ingredient list. It is
     *    the sentence doing the most work (it is the one that points at the badges) and it was the one
     *    most likely to be misread. "Below", because the tile renders ABOVE the list it points at.
     * 4. **No claim that the NAMES are unchanged** except in the singular named string. A food that is gone
     *    takes its name with it (plan 002 R9), so a line can lose its name, and only its amount is certain.
     * 3. **"Nutrition only:" front-loads the SCOPE.** People scan the first few words. Without it the
     *    first thing delivered is a named ingredient followed by "was removed", and the antidote arrives
     *    twenty words later — doing its job only for readers who reach the end, which is not most of them.
     *
     * ⛔ "was removed" is deliberately KEPT over the softer "is no longer in". A cook must be able to tell
     * this from the private-food stand-in ("exists, not served to you"), and "is no longer in" collapses REMOVAL
     * into ABSENCE — the same discrimination `FOOD_REMOVED` is named to protect.
     */
    /**
     * The tile for a recipe with exactly ONE removed ingredient — it NAMES the line, so the answer is
     * complete without scanning the list.
     *
     * ⛔ The reassurance is the load-bearing half of every string in this group, not padding. A cook's real
     * fear on seeing a warning inside their own recipe is "is my recipe broken?", and answering that in the
     * same breath is what turns an alarm into information. The recipe still cooks; only the nutrition
     * figure changed.
     *
     * ⚠️ Passive voice deliberately. The actor is another user, and naming them would disclose that an
     * identifiable person stands behind the record.
     *
     * ⛔ Names the line as the read gave it to THIS viewer (`RecipeIngredientView.name`). The server leaves
     * out the name of a food the viewer may not see (plan 002 R9).
     */
    readonly removedFoodNoticeOne: string;
    /**
     * The tile for exactly ONE removed line that lost its name with its food. It cannot name the line, and an
     * empty quotation (`“” was removed`) is what naming it anyway rendered.
     */
    readonly removedFoodNoticeOneUnnamed: string;
    /** The tile for two or more (contains `{count}`), which counts and POINTS at the marked lines. */
    readonly removedFoodNoticeMany: string;
    /**
     * The tile when EVERY line was removed. Its own string rather than the plural one, because the plural
     * copy points at badges that in this case are suppressed — a badge on every row is wallpaper, not
     * signal — so it would be pointing at nothing.
     */
    readonly removedFoodNoticeAll: string;
    /**
     * The notice for ONE line whose food could not be read just now (plan 002 R2, R36).
     *
     * ⛔ It states no cause, because a request with no credential reaches the same state, and it answers the cook's
     * real worry: the recipe has not changed.
     */
    readonly unreachableNoticeOne: string;
    /** The same notice for two or more such lines (contains `{count}`). */
    readonly unreachableNoticeMany: string;
    /** Announced when a retry from that notice loaded every name. */
    readonly unreachableResolved: string;
    /**
     * The one-time CLONE banner for ONE line kept bound to the original cook's private food (plan 002): its name
     * and nutrition are hidden from the cloner, its amount is kept.
     *
     * ⛔ It points at no remedy. The editor has no control yet that re-picks a line's food while keeping its amount,
     * and copy that points at a missing control is worse than none.
     */
    readonly clonePrivateFoodsBannerOne: string;
    /** The same banner for two or more such lines (contains `{count}`). */
    readonly clonePrivateFoodsBannerMany: string;
    /** Dismiss control on the clone banner. */
    readonly clonePrivateFoodsDismiss: string;
    /** Heading for the steps section ("Steps" replaces "Instructions", `ownerDecisions.md`). */
    readonly instructionsHeading: string;
    /** A step's timer (contains `{duration}`, already said in hours and minutes), shown after the timer glyph. */
    readonly stepTimer: string;
    /** Accessible name of the timer glyph, which is all that tells a step's duration is a timer. */
    readonly stepTimerIcon: string;
    /** Accessible name of a step's current-step toggle, its numeral (contains `{step}`). */
    readonly stepToggleLabel: string;
    /** Heading for the nutrition section. */
    readonly nutritionHeading: string;
    /** Notice shown when per-serving nutrition is incomplete (FR-007 partial nutrition). */
    /** The one line under the dashes when no ingredient was counted (`buildSpec.md` §6.7, F17). */
    readonly nutritionNoneCounted: string;
    readonly nutritionPartial: string;
    /**
     * Disclosure shown when the figure was computed from the LOWER bound of an ingredient's stated range
     * (R38). Distinct from {@link nutritionPartial}: that one says some lines were left out, this one says a
     * counted line was counted at one end of the amount the recipe actually states.
     */
    readonly nutritionRangeDerivedLow: string;
    /** The same disclosure for a figure computed from the UPPER bound (R38). */
    readonly nutritionRangeDerivedHigh: string;
    /**
     * Disclosure shown when the figures include the recipe service's SAVED copy of food data rather than data
     * fetched for this read (KTD-3b — serve stale, MARKED).
     *
     * ⛔ States no CAUSE, on purpose. A saved copy is served when the food database could not be reached AND when
     * the request carried no credential to ask it with, so "we couldn't reach our food database" would be false
     * in the second case — and the cook can act on neither.
     *
     * ⛔ NOT interchangeable with {@link nutritionPartial} or the range notices. Those say the figure is
     * incomplete or taken from one bound; this one says a figure that is probably identical could not be
     * re-checked. It does not start with "Estimated" so the three stay distinguishable at a glance, and offers no
     * "try again" — nothing the cook does changes it. "These figures", not "some": the four are per-serving
     * totals, so one saved line touches all of them.
     */
    readonly nutritionStale: string;
    /**
     * Where catalog numbers come from, shown when a line counts catalog numbers (`hasCatalogNutrition`). Names no single
     * source (`docs/design/ingredientSpecialization.md` §S15, D16); the Data sources link follows it.
     */
    readonly nutritionSourceNote: string;
    /** The link to the Data sources page that follows {@link nutritionSourceNote} (§S15, D15). */
    readonly nutritionSourcesLink: string;
    /** The user-entered disclosure, shown when a line is user-entered (001 FR-007a; §S15). */
    readonly nutritionCustomNote: string;
    /** Label for calories. */
    readonly caloriesLabel: string;
    /** Label for protein. */
    readonly proteinLabel: string;
    /** Label for carbohydrates. */
    readonly carbsLabel: string;
    /** Label for fat. */
    readonly fatLabel: string;
    /** Grams unit template (contains `{grams}`). */
    readonly gramsUnit: string;
    /** Visible version-badge text, shown only past v1 (contains `{version}`). */
    readonly versionBadge: string;
    /** Accessible name for the version badge (contains `{version}`). */
    readonly versionLabel: string;
    /** Visibility-badge text for a public recipe. */
    readonly visibilityPublic: string;
    /** Visibility-badge text for a private recipe. */
    readonly visibilityPrivate: string;
    /** Accessible name for the badges footer region. */
    readonly badgesLabel: string;
    /** Label for the recipe-source (provenance) region — where an imported recipe came from. */
    readonly sourceHeading: string;
    /** Accessible name for the serving-count input/readout of the scaling control. */
    readonly servingsAdjustLabel: string;
    /** Accessible name for the "one fewer serving" control. */
    readonly servingsDecrease: string;
    /** Accessible name for the "one more serving" control. */
    readonly servingsIncrease: string;
    /** The spoken serving count, singular (contains `{count}`). */
    readonly servingsValueOne: string;
    /** The spoken serving count, plural (contains `{count}`). */
    readonly servingsValueOther: string;
    /** The spoken count at the bottom of the range (contains `{value}`, the filled count). */
    readonly servingsValueAtMinimum: string;
    /** The spoken count at the top of the range (contains `{value}`, the filled count). */
    readonly servingsValueAtMaximum: string;
    /** Notice shown while the view is scaled away from the recipe's own yield (contains `{original}`). */
    readonly scaledNotice: string;
    /**
     * The SAFETY disclosure that rides with {@link scaledNotice}: cook times and step timers are shown
     * unscaled, because thermal cooking time is not proportional to batch size.
     */
    readonly scaledTimingCaveat: string;
    /** The notice when refreshing the recipe already on screen fails. */
    readonly refreshError: string;
    /** Label of the retry action beside {@link refreshError}. */
    readonly refreshRetry: string;
    /** The stat strip's difficulty cell label. */
    readonly difficultyLabel: string;
    /** The author in the meta line of another cook's recipe (contains `{handle}`). */
    readonly byAuthor: string;
    /** The serving count beside the Ingredients heading (contains `{count}`). */
    readonly ingredientsFor: string;
    /** The note shown while the amounts are scaled (contains `{original}`). */
    readonly scaledFrom: string;
    /** The ghost action that returns the amounts to the recipe's own servings. */
    readonly resetScale: string;
    /** Announced politely when the serving count changes (contains `{count}`). */
    readonly scaledAnnounce: string;
    /** The "Screen on" switch's name. */
    readonly screenOn: string;
    /** The one-time hint under the section switch the first time Screen on shows. */
    readonly screenOnHint: string;
    /** The steps section with no steps. */
    readonly noSteps: string;
    /** The owner's action from the empty steps section. */
    readonly addSteps: string;
    /** The ingredients section with no ingredients. */
    readonly noIngredients: string;
    /** The owner's action from the empty ingredients section. */
    readonly addIngredients: string;
    /** The ghost link on a section heading that opens the editor at that section. */
    readonly editSection: string;
    /** The full name of the Ingredients heading's Edit link. */
    readonly editIngredientsLabel: string;
    /** The full name of the Steps heading's Edit link. */
    readonly editStepsLabel: string;
    /** The text button that expands a clamped description. */
    readonly descriptionMore: string;
    /** The same button once the description is expanded. */
    readonly descriptionLess: string;
    /** The name of the section switch's navigation. */
    readonly sectionsLabel: string;
    /** The section switch's link to the nutrition section. */
    readonly nutritionLink: string;
    /** The ghost link in the footer facts that opens the version history. */
    readonly versionHistory: string;
}

/**
 * Shared copy for the mockup-parity recipe card (CR-001) — rendered identically by the Home widget and the
 * recipe list, on both web and native. Visible strings match the mockup; the rest are accessible names that
 * convey what a sighted user reads from the icons/pills/stars so the card is not color- or icon-only.
 */
export interface RecipeCardMessages {
    /** Visible "PRO" badge text (FR-003a). */
    readonly proBadge: string;
    /** Accessible name for the PRO badge (icon/short-text is not self-describing to assistive tech). */
    readonly proBadgeLabel: string;
    /** Visible difficulty pill labels, keyed by difficulty. */
    readonly difficultyEasy: string;
    readonly difficultyMedium: string;
    readonly difficultyHard: string;
    /** Accessible difficulty template (contains `{difficulty}`), e.g. "Difficulty: Easy". */
    readonly difficultyLabel: string;
    /** Accessible total-time template (contains `{minutes}`), e.g. "45 minutes total time". */
    readonly timeLabel: string;
    /** Accessible servings template (contains `{count}`), e.g. "Serves 4". */
    readonly servingsLabel: string;
    /** Accessible rating-summary template (contains `{average}` and `{ratings}`). */
    readonly ratingSummary: string;
    /** Singular rating-count template (contains `{count}`). */
    readonly ratingCountOne: string;
    /** Plural rating-count template (contains `{count}`). */
    readonly ratingCountOther: string;
    /** Shown/announced for a recipe that has no ratings yet (never a fabricated 0-star score). */
    readonly unrated: string;
    /** The rating beside the stars, e.g. "4.8 (12)" (contains `{average}` and `{count}`). */
    readonly ratingShort: string;
    /** The count of tags past the ones a card shows, e.g. "+3" (contains `{count}`). */
    readonly moreTags: string;
    /** The separator between the items of one card line, e.g. "Moroccan · Serves 8". */
    readonly separator: string;
    /** Accessible label for the cover-image placeholder shown when a recipe has no photo. */
    readonly noPhotoLabel: string;
    /*
     * ⛔ NO `caloriesLabel` here any more (deferred calorie lookup). The card no longer renders a calorie
     * line of its own — the figure arrives after the card through the `nutrition` SLOT — so this key had no
     * consumer and duplicated `nutrition/messages.ts`'s `calories` verbatim. Two authoritative spellings of
     * one string, one of them unreachable. The nutrition module owns the calorie copy.
     */
    /** Visible version-badge text, shown only past v1 (contains `{version}`). */
    readonly versionBadge: string;
    /** Accessible name for the version badge (contains `{version}`). */
    readonly versionLabel: string;
    /** Visibility-badge text for a public recipe. */
    readonly visibilityPublic: string;
    /** Visibility-badge text for a private recipe. */
    readonly visibilityPrivate: string;
    /** Badge shown on the owner's own draft — REPLACES the visibility badge (never "Public" on a draft). */
    readonly draftBadge: string;
    /** Relative-timestamp template for a revised recipe (contains `{time}`), e.g. "Edited 2d ago" (CR-002). */
    readonly editedRelative: string;
    /** Relative-timestamp template for a never-revised recipe (contains `{time}`), e.g. "Created 1w ago". */
    readonly createdRelative: string;
    /** Localized term rendered in place of `{time}` for a sub-minute-old (or future) instant. */
    readonly justNow: string;
}

/**
 * Copy for the search-minimum empty state (003-FR-010a, plan U37) — the ONE dictionary entry behind it.
 *
 * ⛔ It lives in the shared feature package, not in `web/src/i18n/messages.ts` or
 * `mobile/src/i18n/messages.ts`, because FOUR surfaces render it: both ingredient pickers and both filter
 * typeaheads. Those two picker dictionaries have already drifted from each other on every other string they
 * share (`noMatches` vs `empty`, `addFreeform` vs `create`), and a rule the SERVER enforces cannot be
 * explained by two sentences that disagree about what it is.
 */
export interface IngredientSearchMessages {
    /**
     * Shown when the cook has typed something, but fewer than the minimum (contains `{minimum}`).
     *
     * ⛔ It is NOT the no-matches message and must never be substituted for it: "no matching ingredients"
     * asserts the catalog was searched and came back empty, and below the minimum nothing was searched at
     * all. Per the owner's ruling it says what the minimum is, says why, and invites the cook to keep
     * typing — light rather than scolding.
     *
     * ⚠️ `{minimum}` is a TEMPLATE, filled from the shared `MIN_SEARCH_QUERY_LENGTH` the server reads too.
     * A literal number here would make the sentence lie the moment the floor moves.
     */
    readonly tooShort: string;
}

/**
 * Copy for the ingredient picker's own search read, shared by BOTH pickers so the two platforms say one thing about
 * it (`docs/design/ingredientSpecialization.md` §S13 P3 and P8).
 */
export interface IngredientPickerSearchMessages {
    /** The caption of the searching placeholder, announced politely while the search runs. */
    readonly searching: string;
    /**
     * Announced assertively when the search failed. ⛔ No retry control: the next keystroke is the retry, so the copy
     * says so. The picker's other actions stay available beside it.
     */
    readonly failed: string;
}

/**
 * Copy for the ingredient picker's outcome status, shared by BOTH pickers so the two platforms say the same thing
 * about what just went on the recipe.
 */
export interface IngredientPickerStatusMessages {
    /**
     * Visible AND announced once a line has been added (contains `{name}`). The new line lands in a list the picker
     * does not own — often off-screen — and the control that added it is gone, so without this nothing says what
     * happened.
     */
    readonly added: string;
}

/**
 * Copy for the remote sources' part of every food list: their foods, which flow in by themselves with no button, and
 * what each source's outcome says (`docs/design/rowEditorOpenDecisions.md`, S7 list contract P1 to P8; ADR-0055).
 *
 * ⛔ Shared: every string renders on both platforms and in every surface that picks a food.
 *
 * ⛔ `{source}` is the register's short name, else its name, or {@link sourceUnnamed}, never a raw id (P5). No string
 * starts with it, so the fallback reads correctly in every template. `busy` says try later; `sourceUnavailable` and
 * `incomplete` say edit and try now (P6, §S14's rule: busy means later, failed means now).
 */
export interface IngredientRemoteSearchMessages {
    /** A remote source's group heading (contains `{source}`). */
    readonly groupHeading: string;
    /** A remote food's accessible name, which starts with its visible name (contains `{name}`, `{source}`; 2.5.3). */
    readonly hitName: string;
    /** `{source}` while the register's names are unread or unreadable. */
    readonly sourceUnnamed: string;
    /** The loader's text once the database part is in, until the answer ends (P3). */
    readonly stillSearching: string;
    /** Said at the end of a slow answer for a source that added one food (contains `{source}`; P7). */
    readonly moreOne: string;
    /** Said at the end of a slow answer for a source that added more (contains `{count}`, `{source}`; P7). */
    readonly moreOther: string;
    /** Said at the end of a slow answer that added no food and failed nowhere (P7). */
    readonly noMore: string;
    /** The answer ended before it completed: its body ended, or its deadline passed (P6). */
    readonly incomplete: string;
    /** A source whose shared window was full: try later (contains `{source}`; P6). */
    readonly sourceBusy: string;
    /** A source that did not answer in time: try now (contains `{source}`; P6). */
    readonly sourceUnavailable: string;
    /**
     * The cook's own limit skipped sources, once for the answer (contains `{time}`, `{sources}` in the locale's list
     * format; P6). It never states the figure and never blames the source.
     */
    readonly sourceLimited: string;
    /** A remote pick the source could not make now (contains `{source}`; P8). */
    readonly busy: string;
    /** A remote pick or row 6 candidate the cook's own limit refused, and when it ends (contains `{time}`; P8). */
    readonly sourceLimitReached: string;
}

/**
 * Copy for the U16 create-your-own-food affordance and form, shared by both ingredient pickers.
 *
 * ⛔ Shared for the {@link IngredientSearchMessages} reason: every string here renders on BOTH platforms,
 * and the create/duplicate/failed states must say the same thing about the same food everywhere.
 *
 * ⚠️ {@link IngredientCreateFoodMessages.privateHint} is a PROMISE the backend keeps (U10/U11): a created
 * food is visible to its author alone until promotion. Do not soften or drop it — it is the one line that
 * tells a cook their grandma's blend is not being published.
 */
export interface IngredientCreateFoodMessages {
    /** The form's heading (contains `{query}` when opened from a typed search). */
    readonly formTitle: string;
    /** Only-you visibility promise, shown under the form. */
    readonly privateHint: string;
    /** Name field label. */
    readonly nameLabel: string;
    /** Per-100g section hint over the macro fields. */
    readonly per100gHint: string;
    /** Calories field label. */
    readonly caloriesLabel: string;
    /** Protein field label. */
    readonly proteinLabel: string;
    /** Carbohydrate field label. */
    readonly carbsLabel: string;
    /** Fat field label. */
    readonly fatLabel: string;
    /** Submit control — creates AND attaches to the line. */
    readonly submit: string;
    /** Cancel/dismiss the form. */
    readonly cancel: string;
    /** In-flight caption (live-region content while the create runs). */
    readonly submitting: string;
    /** Inline field error: the field is required. */
    readonly errorRequired: string;
    /** Inline field error: not a number. */
    readonly errorNotANumber: string;
    /** Inline field error: outside the published bounds. */
    readonly errorOutOfRange: string;
    /** ⛔ The retryable SUBMIT failure — network/server, distinct from any field error. */
    readonly submitFailed: string;
    /**
     * ⛔ The per-author duplicate — a DISTINCT sentence from validation copy, because the fix is different:
     * the cook already made this food, and the affordance below attaches it (contains `{name}`).
     */
    readonly duplicateNotice: string;
    /** The reuse affordance on the duplicate notice. */
    readonly duplicateReuse: string;
    /** The reuse admission failed — retryable. */
    readonly duplicateReuseFailed: string;
    /**
     * The accessible name of the authored-food Sheet's close button (`docs/design/rowEditorOpenDecisions.md` item 1),
     * the house form "Close {thing}".
     */
    readonly close: string;
}

/**
 * The stand-ins a recipe line shows where its name would be, when it has none (plan 002 R9;
 * `docs/design/namelessLineCopy.md` §2b). Every surface that names a line renders these through
 * `detail/lineName.ts`, so a missing name reads the same on the detail page, in the editor and in a version.
 *
 * ⛔ Each one states WHY the name is missing, and none of them guesses at the food.
 */
export interface IngredientLineNameMessages {
    /** The line's food is another cook's private food (`RESOLVED_UNAVAILABLE`). It does not say whose. */
    readonly privateFood: string;
    /**
     * The line's food is gone and took its name with it (`FOOD_REMOVED` with no name).
     *
     * ⛔ "Removed FOOD", never "Removed ingredient": the line is still in the recipe with its amount, and only its
     * food was removed — the same ruling `recipeFormMessages`' `rowStateFoodRemoved` records.
     */
    readonly removedFood: string;
    /**
     * Food could not be asked about the line just now (`FOOD_UNREACHABLE`).
     *
     * ⛔ "not loaded", never "removed" or "missing" (R2): an outage must never read as a permanent fact.
     */
    readonly notLoaded: string;
    /** A version snapshot that froze no name for the line. A version is history, so nothing more is known. */
    readonly notSavedInVersion: string;
}

/**
 * Copy for the variant details dialog (curated plan U14; `docs/design/ingredientSpecialization.md` §S11). `{food}` is
 * the root's name and `{parts}` a variant's parts as `spokenVariantParts` joins them.
 *
 * ⛔ No string says kind, typical, variant, root, part, attribute or FoodOn, and each sentence is one template.
 */
export interface IngredientDetailsMessages {
    /** The menu item and the dialog title when the line has no details yet. One key, so the two cannot drift. */
    readonly actionAdd: string;
    /** The menu item and the dialog title when the line has details. */
    readonly actionEdit: string;
    /** The accessible name of the icon-only Close button (house form "Close {thing}"). */
    readonly close: string;
    /** The visible footer button in `detailsNoneLeft`. It differs from `close`, so two controls do not share a name. */
    readonly dismiss: string;
    /** The line under the food name. */
    readonly intro: string;
    /** The caption that heads the calorie column. */
    readonly caloriesBasis: string;
    /** The long list's visible search label (`{count}`). A long list always has 8 or more, so there is no singular. */
    readonly searchLabelOther: string;
    /** The accessible name of the icon-only Clear button. */
    readonly searchClear: string;
    /** The search count announced while one row matches (`{count}`). */
    readonly searchCountOne: string;
    /** The search count announced otherwise (`{shown}`, `{count}`). */
    readonly searchCountOther: string;
    /** No row matches (`{query}`, `{count}`). */
    readonly noMatches: string;
    /** The current details, in `edit` mode (`{parts}`). */
    readonly currentLine: string;
    /** The current details when they are no longer listed (`{parts}`). States the cost of a change (§S8.7). */
    readonly currentRetired: string;
    /** The word under the current row's parts. Never a chip. */
    readonly tagCurrent: string;
    /** The calorie column for a variant that states no energy. Never `0`. */
    readonly caloriesAbsent: string;
    /** The same, as a screen reader hears it. */
    readonly caloriesAbsentSpoken: string;
    /** A row's accessible name (`{parts}`, `{calories}`). It starts with the visible text (SC 2.5.3). */
    readonly optionName: string;
    /** A grouped row's accessible name; it ends with the group's part (R27) (`{parts}`, `{calories}`, `{group}`). */
    readonly optionNameInGroup: string;
    /** The current row's accessible name (`{parts}`, `{calories}`). */
    readonly optionNameCurrent: string;
    /** The current grouped row's accessible name (`{parts}`, `{calories}`, `{group}`). */
    readonly optionNameCurrentInGroup: string;
    /** The footer button in `edit` mode. */
    readonly remove: string;
    /** The status while the details load. */
    readonly loading: string;
    /** The alert when the details could not be loaded. */
    readonly loadFailed: string;
    /** The button that loads the details again. */
    readonly retry: string;
    /** The root has no details to choose from (`{food}`). */
    readonly noVariants: string;
    /** The current details are retired and nothing else is listed (`{food}`). */
    readonly noneLeft: string;
    /** Announced after a pick in `add` mode (`{parts}`). */
    readonly statusAdded: string;
    /** Announced after a pick in `edit` mode (`{parts}`). */
    readonly statusChanged: string;
    /** Announced after `Remove details`. */
    readonly statusRemoved: string;
    /** The read view's ingredient checkbox name on a variant-bound line (`{quantity}`, `{food}`, `{parts}`; §S5). */
    readonly checkLabelWithDetails: string;
    /** A search result that carries a variant: its accessible name (contains `{food}` and `{parts}`; §S2). */
    readonly suggestionWithDetails: string;
    /** One of the cook's own foods in a search list: its accessible name (contains `{name}`; §S15, S5 list L4.2). */
    readonly ownFoodName: string;
    /** A pick that bound a variant, announced (contains `{food}` and `{parts}`; §S2). */
    readonly matchedWithDetails: string;
    /** The server refused a details pick or removal; the row says it, with no Retry (§S8.9, §S12 row 11). */
    readonly saveRejected: string;
}

/** The shape of the recipe feature's shared copy. */
/**
 * How a duration stored in seconds is said (F1): in hours and minutes, never in seconds. Each template takes the
 * named number(s) it shows.
 */
/** Copy for Home's "Recent recipes" block (`docs/design/uiOverhaul/buildSpec.md` §4.2). */
export interface RecipeHomeMessages {
    /** The first run's line. */
    readonly recentEmptyBody: string;
    /** The first run's primary action. */
    readonly firstRecipe: string;
    /** The first run's paste action. */
    readonly pasteIngredients: string;
    /** The first run's link to Discover. */
    readonly findOnDiscover: string;
    /** The heading row's link to My recipes: what it shows. */
    readonly seeAll: string;
    /** …and its accessible name, which contains it (SC 2.5.3). */
    readonly seeAllLabel: string;
    /** When the recent recipes fail to load. */
    readonly loadError: string;
    /** Retry the load. */
    readonly retry: string;
}

export interface RecipeDurationMessages {
    /** Under an hour (contains `{minutes}`), e.g. "20 min". */
    readonly minutes: string;
    /** Whole hours (contains `{hours}`), e.g. "4 h". */
    readonly hours: string;
    /** Hours and minutes (contains `{hours}` and `{minutes}`), e.g. "4 h 30 min". */
    readonly hoursMinutes: string;
}

export interface RecipeMessages {
    /** Title of the recent-recipes Home widget card. */
    readonly widgetTitle: string;
    /** Empty state shown in the live recipe widget when the viewer has no recipes yet. */
    readonly emptyState: string;
    /** Copy for Home's "Recent recipes" block (`docs/design/uiOverhaul/buildSpec.md` §4.2). */
    readonly home: RecipeHomeMessages;
    /** Copy for the recipe-list screen. */
    readonly list: RecipeListMessages;
    /** Copy for the recipe-detail screen. */
    readonly detail: RecipeDetailMessages;
    /** How a duration is said, shared by every surface that shows one. */
    readonly duration: RecipeDurationMessages;
    /** Copy for the shared recipe card (Home widget + list). */
    readonly card: RecipeCardMessages;
    /** Copy for the ingredient-search minimum (003-FR-010a), shared by all four search surfaces. */
    readonly ingredientSearch: IngredientSearchMessages;
    /** Copy for the remote sources' part of every food list (ADR-0055, S7 list contract). */
    readonly ingredientRemoteSearch: IngredientRemoteSearchMessages;
    /** Copy for the picker's own search read (searching, failed), shared by both ingredient pickers. */
    readonly ingredientPickerSearch: IngredientPickerSearchMessages;
    /** Copy for the picker's outcome status (what was just added), shared by both ingredient pickers. */
    readonly ingredientPickerStatus: IngredientPickerStatusMessages;
    /** Copy for the U16 create-your-own-food affordance and form, shared by both ingredient pickers. */
    readonly ingredientCreateFood: IngredientCreateFoodMessages;
    /** The stand-ins for a line with no name, shared by the detail, editor, review and version surfaces. */
    readonly ingredientLineName: IngredientLineNameMessages;
    /** Copy for the variant details dialog (curated U14), shared by web and native. */
    readonly ingredientDetails: IngredientDetailsMessages;
}

export const recipeMessages: LocalizedMessages<RecipeMessages> = {
    en: {
        widgetTitle: 'Recent recipes',
        emptyState: 'No recipes yet. Create your first recipe to see it here.',
        home: {
            recentEmptyBody: 'Your recipes will show up here.',
            firstRecipe: 'Add your first recipe',
            pasteIngredients: 'Paste ingredients',
            findOnDiscover: 'Or find one on Discover',
            seeAll: 'See all',
            seeAllLabel: 'See all recipes',
            loadError: 'We couldn’t load your recent recipes.',
            retry: 'Try again',
        },
        duration: {
            minutes: '{minutes} min',
            hours: '{hours} h',
            hoursMinutes: '{hours} h {minutes} min',
        },
        ingredientSearch: {
            tooShort: 'Keep typing — {minimum} characters or more. Anything shorter matches half the pantry.',
        },
        ingredientPickerSearch: {
            searching: 'Searching ingredients',
            failed: 'We couldn’t search ingredients. Edit your search to try again.',
        },
        ingredientPickerStatus: {
            added: 'Added {name}',
        },
        ingredientDetails: {
            actionAdd: 'Add details',
            actionEdit: 'Edit details',
            close: 'Close details',
            dismiss: 'Close',
            intro: 'Nutrition uses the one you pick.',
            caloriesBasis: 'Calories per 100 g',
            searchLabelOther: 'Search {count} options',
            searchClear: 'Clear search',
            searchCountOne: '1 of {count} options',
            searchCountOther: '{shown} of {count} options',
            noMatches: 'Nothing matches “{query}”. Clear the search to see all {count}.',
            currentLine: 'Current: {parts}',
            currentRetired: 'Current: {parts}. It’s no longer listed, so if you change it, you can’t pick it again.',
            tagCurrent: 'Current',
            caloriesAbsent: 'no figure',
            caloriesAbsentSpoken: 'no calorie figure',
            optionName: '{parts}, {calories}',
            optionNameInGroup: '{parts}, {calories}, {group}',
            optionNameCurrent: '{parts}, Current, {calories}',
            optionNameCurrentInGroup: '{parts}, Current, {calories}, {group}',
            remove: 'Remove details',
            loading: 'Loading details…',
            loadFailed: 'We couldn’t load the details. Your ingredient hasn’t changed.',
            retry: 'Try again',
            noVariants: 'There are no details to pick for {food} right now. Your ingredient hasn’t changed.',
            noneLeft:
                'There are no other details for {food} now. Your recipe keeps these numbers. If you remove the details, you can’t add them back.',
            statusAdded: 'Details added: {parts}.',
            statusChanged: 'Details changed: {parts}.',
            statusRemoved: 'Details removed.',
            checkLabelWithDetails: '{quantity} {food}, {parts}',
            suggestionWithDetails: '{food}, {parts}',
            ownFoodName: '{name}, your food',
            matchedWithDetails: 'Matched: {food}, {parts}. Nutrition is counted now.',
            saveRejected: 'The details didn’t save, so this ingredient is unchanged.',
        },
        ingredientLineName: {
            privateFood: 'Private ingredient',
            removedFood: 'Removed food',
            notLoaded: 'Ingredient not loaded',
            notSavedInVersion: 'Name not saved',
        },
        ingredientRemoteSearch: {
            groupHeading: 'From {source}',
            hitName: '{name}, from {source}',
            sourceUnnamed: 'another food database',
            stillSearching: 'Still searching other food databases',
            moreOne: '1 more food from {source}',
            moreOther: '{count} more foods from {source}',
            noMore: 'No more foods found.',
            incomplete: 'The search didn’t finish, so this list isn’t complete. Edit your search to try again.',
            sourceBusy: 'We couldn’t search {source} just now. Try again later.',
            sourceUnavailable: 'We didn’t hear back from {source}. Edit your search to try again.',
            sourceLimited: 'You’ve reached your limit for food lookups until {time}, so we didn’t search {sources}.',
            busy: 'Lookups from {source} aren’t available right now. Try again later.',
            sourceLimitReached: 'You’ve reached your limit for food lookups. You can try again at {time}.',
        },
        ingredientCreateFood: {
            formTitle: 'Create “{query}”',
            privateHint: 'Only you can see foods you create.',
            nameLabel: 'Food name',
            per100gHint: 'Nutrition per 100 g',
            caloriesLabel: 'Calories (kcal)',
            proteinLabel: 'Protein (g)',
            carbsLabel: 'Carbs (g)',
            fatLabel: 'Fat (g)',
            submit: 'Create and add',
            cancel: 'Cancel',
            submitting: 'Creating your food…',
            errorRequired: 'Required',
            errorNotANumber: 'Enter a number',
            errorOutOfRange: 'Outside the allowed range',
            submitFailed: 'Could not create the food. Check your connection and try again.',
            duplicateNotice: 'You already have a food named “{name}”.',
            duplicateReuse: 'Use that one',
            duplicateReuseFailed: 'Could not add your existing food. Try again.',
            close: 'Close new food form',
        },
        list: {
            heading: 'Recipes',
            searchLabel: 'Search your recipes',
            searchPlaceholder: 'Search your recipes',
            countOne: '{count} recipe',
            countOther: '{count} recipes',
            durationMinutes: '{minutes} min',
            loadingLabel: 'Loading recipes',
            emptyTitle: 'Your recipe box is empty',
            emptyBody: 'Add a recipe you love, or paste an ingredient list and we’ll set it up.',
            noMatchTitle: 'No recipes match',
            noMatchBody: 'No recipes match your search. Try a different term.',
            createCta: 'New recipe',
            emptyCreateCta: 'Add your first recipe',
            tabMine: 'My recipes',
            tabCommunity: 'Community',
            tabsLabel: 'Recipe source',
            filtersLabel: 'Quick filters',
            filterAll: 'All',
            filterQuick: 'Under 30 min',
            errorTitle: 'We couldn’t load your recipes.',
            retry: 'Try again',
            refreshError: 'We couldn’t refresh your recipes.',
            tabCollections: 'Collections',
            segmentsLabel: 'Recipes',
            pasteIngredients: 'Paste ingredients',
            noMatchQuery: 'Nothing matches “{query}”.',
            noMatchFilters: 'No recipes match these filters.',
            clearSearch: 'Clear search',
            clearFilters: 'Clear filters',
            viewLabel: 'View',
            viewList: 'List view',
            viewGrid: 'Grid view',
            sortButton: 'Sort: {choice}',
            sortMenuLabel: 'Sort recipes',
            sortRecent: 'Recently edited',
            sortNewest: 'Newest',
            sortTitle: 'A–Z',
            sortClose: 'Close sort',
            loadMore: 'Load more',
            loadingMore: 'Loading more recipes',
            loadMoreError: 'We couldn’t load more recipes.',
        },
        detail: {
            refreshError: 'We couldn’t refresh this recipe.',
            refreshRetry: 'Try again',
            prepLabel: 'Prep',
            cookLabel: 'Cook',
            totalLabel: 'Total',
            servingsLabel: 'Serves',
            photosLabel: 'Recipe photos',
            photoAlt: '{title} photo {index}',
            photoOpen: 'Open {title} photo {index} full screen',
            photoDotsLabel: 'Photo navigation',
            photoDot: 'Go to {title} photo {index}',
            lightboxClose: 'Close photo',
            ingredientsHeading: 'Ingredients',
            userEnteredBadge: 'Your own food',
            needsReviewBadge: 'Needs review',
            needsReviewNoticeOne:
                'One ingredient didn’t match its original wording, so it isn’t counted here. Check it and pick the right food.',
            needsReviewNoticeMany:
                '{count} ingredients didn’t match their original wording, so they aren’t counted here. Check them and pick the right foods.',
            ambiguousBadge: 'Choose a match',
            ambiguousNoticeOne: '1 ingredient could match more than one food. Review it to sharpen the nutrition.',
            ambiguousNoticeMany:
                '{count} ingredients could match more than one food. Review them to sharpen the nutrition.',
            ambiguousReviewHeading: 'Review ingredient matches',
            ambiguousReviewToggle: 'Review ingredient matches',
            ambiguousReviewLoading: 'Finding matches…',
            ambiguousReviewSaved: 'Saved — future recipes will use this match.',
            ambiguousReviewFailed: 'Could not save this pick. The rest are unaffected.',
            ambiguousReviewRetry: 'Try again',
            ambiguousReviewRetryLabel: 'Try again for “{phrase}”',
            ambiguousReviewRefreshed: 'The match list was refreshed.',
            removedFoodBadge: 'Food no longer listed',
            removedFoodNoticeOne:
                'Nutrition only: “{name}” was removed from our food database, so it isn’t counted below. Its name and amount in this recipe are unchanged.',
            removedFoodNoticeOneUnnamed:
                'Nutrition only: one ingredient was removed from our food database, so it isn’t counted below. Its amount in this recipe is unchanged.',
            removedFoodNoticeMany:
                'Nutrition only: {count} ingredients were removed from our food database, so the nutrition figures leave them out. They’re marked below, and their amounts are unchanged.',
            removedFoodNoticeAll:
                'Nutrition only: every ingredient here was removed from our food database, so there’s no nutrition to show. Their amounts in this recipe are unchanged.',
            unreachableNoticeOne:
                'We couldn’t load one ingredient’s name and nutrition just now. Your recipe hasn’t changed.',
            unreachableNoticeMany:
                'We couldn’t load the names and nutrition of {count} ingredients just now. Your recipe hasn’t changed.',
            unreachableResolved: 'Ingredient names loaded.',
            clonePrivateFoodsBannerOne:
                'One ingredient uses the original cook’s private food, so you can’t see its name or nutrition. Its amount is kept.',
            clonePrivateFoodsBannerMany:
                '{count} ingredients use the original cook’s private foods, so you can’t see their names or nutrition. Their amounts are kept.',
            clonePrivateFoodsDismiss: 'Dismiss',
            instructionsHeading: 'Steps',
            stepTimer: '{duration}',
            stepTimerIcon: 'Timer',
            stepToggleLabel: 'Mark step {step} as current',
            nutritionHeading: 'Nutrition (per serving)',
            nutritionPartial: 'Estimated — some items aren’t counted yet',
            nutritionNoneCounted: 'Not counted yet: no ingredient has a food.',
            nutritionRangeDerivedLow: 'Estimated from the lower amount of each stated range',
            nutritionRangeDerivedHigh: 'Estimated from the upper amount of each stated range',
            nutritionStale: 'These figures include saved food data, so they may be out of date.',
            nutritionSourceNote: 'Nutrition comes from public food databases.',
            nutritionSourcesLink: 'Data sources',
            nutritionCustomNote: 'Custom ingredients count only the nutrition you entered for them.',
            caloriesLabel: 'Calories',
            proteinLabel: 'Protein',
            carbsLabel: 'Carbs',
            fatLabel: 'Fat',
            gramsUnit: '{grams} g',
            versionBadge: 'v{version}',
            versionLabel: 'Version {version}',
            visibilityPublic: 'Public',
            visibilityPrivate: 'Private',
            badgesLabel: 'Recipe status',
            sourceHeading: 'Source',
            servingsAdjustLabel: 'Servings',
            servingsDecrease: 'Fewer servings',
            servingsIncrease: 'More servings',
            servingsValueOne: '{count} serving',
            servingsValueOther: '{count} servings',
            servingsValueAtMinimum: '{value}, minimum',
            servingsValueAtMaximum: '{value}, maximum',
            scaledNotice: 'Adjusted from {original} servings — ingredient amounts and prep time are scaled.',
            scaledTimingCaveat:
                'Cook times and step timers are shown unchanged: cooking time does not scale with batch size. Check for doneness.',
            difficultyLabel: 'Difficulty',
            byAuthor: 'by @{handle}',
            ingredientsFor: 'for {count}',
            scaledFrom: 'Amounts scaled from {original} servings.',
            resetScale: 'Reset',
            scaledAnnounce: 'Amounts for {count} servings.',
            screenOn: 'Screen on',
            screenOnHint: 'Keeps the screen awake while you cook.',
            noSteps: 'No steps yet.',
            addSteps: 'Add steps',
            noIngredients: 'No ingredients yet.',
            addIngredients: 'Add ingredients',
            editSection: 'Edit',
            editIngredientsLabel: 'Edit ingredients',
            editStepsLabel: 'Edit steps',
            descriptionMore: 'More',
            descriptionLess: 'Less',
            sectionsLabel: 'Recipe sections',
            nutritionLink: 'Nutrition',
            versionHistory: 'Version history',
        },
        card: {
            proBadge: 'PRO',
            proBadgeLabel: 'Premium recipe',
            difficultyEasy: 'Easy',
            difficultyMedium: 'Medium',
            difficultyHard: 'Hard',
            difficultyLabel: 'Difficulty: {difficulty}',
            timeLabel: '{minutes} minutes total time',
            servingsLabel: 'Serves {count}',
            ratingSummary: 'Rated {average} out of 5, {ratings}',
            ratingCountOne: '{count} rating',
            ratingCountOther: '{count} ratings',
            unrated: 'No ratings yet',
            ratingShort: '{average} ({count})',
            moreTags: '+{count}',
            separator: ' · ',
            noPhotoLabel: 'No photo yet',
            versionBadge: 'v{version}',
            versionLabel: 'Version {version}',
            visibilityPublic: 'Public',
            visibilityPrivate: 'Private',
            draftBadge: 'Draft',
            editedRelative: 'Edited {time}',
            createdRelative: 'Created {time}',
            justNow: 'just now',
        },
    },
};
