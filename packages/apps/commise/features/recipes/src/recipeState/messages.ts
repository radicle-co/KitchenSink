/**
 * @module @commise/features-recipes/recipeState/messages — every string of the recipe state model (docs/architecture/
 * recipeStateModel.md 4.4, 4.5, 4.8). One object, typed by recipe-core's registry: a name without its key is a compile
 * error. Strings never go in recipe-core, because the backend shares it.
 *
 * Where the model says "existing key", the string is the existing one (referenced, not copied), so the model and the
 * screen that already shows it cannot drift. Collapsing the four Public/Private pairs and the two slot keys is the
 * rename task, which is not part of this change.
 *
 * `VIEW_ADAPTED_BY_COOK.earnedSentence` is NOT a toast. P4a's `finishedNoticeOf` adds it after the outcome sentence with
 * `noticeWithEarned`, and P4a's `adaptedEarned` key becomes this one. Until P4a merges, nothing reads it.
 *
 * Attested wording (`statement*.v1`, `publicConfirm.v1`, the lock notes) is not here and stays byte-identical where it is.
 */
import type { LabelKey, Refusal } from '@kitchensink/recipe-core/recipe-state';
import type { LocalizedMessages } from '@commise/i18n';

import { recipeActionMessages } from '../actions/messages.js';
import { editorMessages } from '../editor/messages.js';
import { recipeMessages } from '../messages.js';

/** The refusals that have a whole sentence in this file. The others have their sentence elsewhere or none (4.5). */
export const RECIPE_STATE_REFUSAL_LINES = [
    'REFUSAL_POLICY_WEB_PAGE',
    'REFUSAL_POLICY_BOOK',
    'REFUSAL_POLICY_PAID_SITE',
    'REFUSAL_FROM_PERSON',
    'REFUSAL_SOURCE_CONFLICT',
    'REFUSAL_SOURCE_CORRECTED',
    'REFUSAL_STATEMENT_REQUIRED',
    'REFUSAL_CONTENT_NOT_APPROVED',
    'REFUSAL_UNRECOGNISED',
] as const satisfies readonly Refusal[];

/** One refusal that has a line here. */
export type RecipeStateRefusalLine = (typeof RECIPE_STATE_REFUSAL_LINES)[number];

/** The model's strings. */
export interface RecipeStateMessages {
    /** Every label key of the registry. */
    readonly labels: Readonly<Record<LabelKey, string>>;
    /** Each refusal as a whole sentence (4.5). */
    readonly refusals: Readonly<Record<RecipeStateRefusalLine, string>>;
}

const existing = recipeActionMessages.en.publicRefusal;
const SEE_SOURCE = 'See the source';
const EDIT_STEPS = 'Edit steps';
const DISMISS = 'Dismiss';
const UPSELL_LINE = 'Let AI rewrite the steps in new words with Pro.';
const EDIT_WITH_AI = 'Edit with AI';
const ADAPTED_FROM_BOOK = 'a cookbook or magazine';
const ADAPTED_FROM_PAID = 'a paid website';
const ADAPTED_FROM_WEB = 'a web page';

export const recipeStateMessages: LocalizedMessages<RecipeStateMessages> = {
    en: {
        labels: {
            LIFECYCLE_DRAFT: recipeMessages.en.card.draftBadge,
            AUDIENCE_PRIVATE: recipeMessages.en.card.visibilityPrivate,
            AUDIENCE_PUBLIC: recipeMessages.en.card.visibilityPublic,
            'ORIGIN_OWN.owner': 'Written by you',
            'ORIGIN_OWN.reader': 'Written by {cook}',
            ORIGIN_WEB_PAGE: 'From a web page',
            'ORIGIN_WEB_PAGE.withSite': 'From {site}',
            ORIGIN_BOOK: 'From a cookbook or magazine',
            ORIGIN_PAID_SITE: 'From a paid website',
            ORIGIN_PERSON: 'From another person',
            ORIGIN_PUBLIC_DOMAIN: 'Public domain',
            ORIGIN_COMMISE_WRITTEN: 'Written by Commise',
            VIEW_IN_REVIEW: 'In review',
            VIEW_CHECKING: 'Checking',
            VIEW_NOT_APPROVED: 'Not approved to be public.',
            'VIEW_ADAPTED_BY_COOK.owner': 'Adapted by you',
            'VIEW_ADAPTED_BY_COOK.reader': 'Adapted by {cook}',
            'VIEW_ADAPTED_BY_COOK.heading.owner': 'Adapted by you from',
            'VIEW_ADAPTED_BY_COOK.heading.reader': 'Adapted by {cook} from',
            'VIEW_ADAPTED_BY_COOK.headingNoCitation.book.owner': `Adapted by you from ${ADAPTED_FROM_BOOK}`,
            'VIEW_ADAPTED_BY_COOK.headingNoCitation.book.reader': 'Adapted by {cook} from ' + ADAPTED_FROM_BOOK,
            'VIEW_ADAPTED_BY_COOK.headingNoCitation.paidSite.owner': `Adapted by you from ${ADAPTED_FROM_PAID}`,
            'VIEW_ADAPTED_BY_COOK.headingNoCitation.paidSite.reader': 'Adapted by {cook} from ' + ADAPTED_FROM_PAID,
            'VIEW_ADAPTED_BY_COOK.headingNoCitation.webPage.owner': `Adapted by you from ${ADAPTED_FROM_WEB}`,
            'VIEW_ADAPTED_BY_COOK.headingNoCitation.webPage.reader': 'Adapted by {cook} from ' + ADAPTED_FROM_WEB,
            'VIEW_ADAPTED_BY_COOK.earnedSentence': 'This recipe is now marked Adapted by you.',
            VIEW_COPY_OF: 'Copied from {name}',
            VIEW_COPY_OF_COMMISE_PAGE: 'Copied from a recipe Commise wrote',
            VIEW_CHANGES_ON_DEVICE: editorMessages.en.status.changesOnDevice,
            'VIEW_HIDDEN_AFTER_REPORT.owner': 'Hidden after a report. Only you can see it now.',
            'VIEW_HIDDEN_AFTER_REPORT.reader': 'This recipe isn’t available right now.',
            'VIEW_TOO_CLOSE_SAVED_PRIVATE.title': 'Saved as private',
            'VIEW_TOO_CLOSE_SAVED_PRIVATE.body':
                'Your steps are still too close to the source’s wording to share, so we saved this recipe as private. Change the steps in your own words to make it public.',
            'VIEW_TOO_CLOSE_SAVED_PRIVATE.link': SEE_SOURCE,
            'VIEW_TOO_CLOSE_SAVED_PRIVATE.primary': EDIT_STEPS,
            'VIEW_TOO_CLOSE_SAVED_PRIVATE.secondary': DISMISS,
            'VIEW_TOO_CLOSE_SAVED_PRIVATE.upsellLine': UPSELL_LINE,
            'VIEW_TOO_CLOSE_SAVED_PRIVATE.upsellAction': EDIT_WITH_AI,
            'VIEW_TOO_CLOSE_NO_SLOT.title': 'Not saved yet',
            'VIEW_TOO_CLOSE_NO_SLOT.body':
                'Your steps are too close to the source’s wording to share, and all {total} of your private recipes are in use. To save it, change the steps, delete a private recipe, or upgrade to Pro. Your changes are saved on this device.',
            'VIEW_TOO_CLOSE_NO_SLOT.link': SEE_SOURCE,
            'VIEW_TOO_CLOSE_NO_SLOT.primary': EDIT_STEPS,
            'VIEW_TOO_CLOSE_NO_SLOT.manageAction': 'Manage private recipes',
            'VIEW_TOO_CLOSE_NO_SLOT.upgradeAction': 'Upgrade to Pro',
            'VIEW_TOO_CLOSE_NO_SLOT.upsellAction': EDIT_WITH_AI,
            'VIEW_TOO_CLOSE_AFTER_REVIEW.title': 'Made private after a check',
            'VIEW_TOO_CLOSE_AFTER_REVIEW.body':
                'We checked this recipe, and its steps are too close to the source’s wording to share. Only you can see it now. Change the steps in your own words to make it public again.',
            'VIEW_TOO_CLOSE_AFTER_REVIEW.link': SEE_SOURCE,
            'VIEW_TOO_CLOSE_AFTER_REVIEW.primary': EDIT_STEPS,
            'VIEW_TOO_CLOSE_AFTER_REVIEW.secondary': 'Delete recipe',
            'VIEW_TOO_CLOSE_AFTER_REVIEW.upsellLine': UPSELL_LINE,
            'VIEW_TOO_CLOSE_AFTER_REVIEW.upsellAction': EDIT_WITH_AI,
            'VIEW_SOURCE_HOLD_SAVED_PRIVATE.title': 'Saved as private',
            'VIEW_SOURCE_HOLD_SAVED_PRIVATE.body':
                'This recipe was saved with a source, such as a web page or a book, so it can’t be public. We saved it as private, so only you can see it now.',
            'VIEW_SOURCE_HOLD_SAVED_PRIVATE.link': SEE_SOURCE,
            'VIEW_SOURCE_HOLD_SAVED_PRIVATE.primary': DISMISS,
            'VIEW_SOURCE_HOLD_AFTER_CHECK.title': 'Made private after a check',
            'VIEW_SOURCE_HOLD_AFTER_CHECK.body':
                'We checked this recipe’s source. It comes from a web page or a book, so it can’t be public. Only you can see it now.',
            'VIEW_SOURCE_HOLD_AFTER_CHECK.link': SEE_SOURCE,
            'VIEW_SOURCE_HOLD_AFTER_CHECK.primary': DISMISS,
            HOLD_REMOVED: 'Removed from public view. Only you can see it now.',
            SOURCE_HEADING: 'Source',
            REPORT_ACTION: 'Report a problem',
            'REPORT_SIGN_IN.title': 'Sign in to report a problem',
            'REPORT_SIGN_IN.body': 'A report hides this recipe until we check it, so we need to know who sent it.',
            REPORT_LIMIT_REACHED: 'You’ve reported a lot of recipes today. Try again tomorrow.',
            ANSWER_UNSTATED_PRIVATE: 'I’m not sure yet',
            'ANSWER_UNSTATED_PRIVATE.hint': 'It stays private. You can say where it’s from later.',
            LABEL_SEPARATOR: recipeMessages.en.card.separator,
        },
        refusals: {
            REFUSAL_POLICY_WEB_PAGE: existing.policyWebPage,
            REFUSAL_POLICY_BOOK: existing.policyBook,
            REFUSAL_POLICY_PAID_SITE: existing.policyPaidSite,
            REFUSAL_FROM_PERSON: existing.fromPerson,
            REFUSAL_SOURCE_CONFLICT: existing.sourceConflict,
            REFUSAL_SOURCE_CORRECTED: 'This recipe stays private because its source was corrected.',
            REFUSAL_STATEMENT_REQUIRED: 'Say where this recipe is from before making it public.',
            REFUSAL_CONTENT_NOT_APPROVED: 'This recipe stays private because it wasn’t approved to be public.',
            REFUSAL_UNRECOGNISED: existing.unrecognised,
        },
    },
};
