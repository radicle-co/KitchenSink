/**
 * @module @commise/features-recipes/actions — what the recipe page says about its visibility, inline under the rating
 * and visibility line (`docs/design/uiOverhaul/buildSpec.md` §6.4; plan 2026-10-14-009 T3). One answer for both
 * platforms, so web and native cannot disagree about when the sentence shows.
 *
 * It serves three ways a Private is refused: the editor withheld it because the server would refuse it (the finish
 * CLAIM), the editor's follow-up was refused after the editor left (`useServerRefusedPrivate`), and the page's own Make
 * private was refused. The generic "we couldn't change who can see this recipe" lives in the same slot.
 *
 * ⛔ THE FINISH CLAIM IS NOT TRUSTED. It arrives as `?done=<outcome>.<reason>` on web, which is a link anyone can write,
 * and the editor withheld that Private, so the server never saw it and there is no server answer to carry. The sentence
 * is therefore only said when every clause of it is TRUE by facts the page already holds from the server: the viewer
 * owns the recipe, the recipe is public, and the profile says Private is refused for this viewer. The words come from
 * the profile's reason, and the link's reason is never read. A forged link then shows nothing to a non-owner, to the
 * owner of a private recipe, or to an entitled owner. The one thing left is an owner who cannot make a recipe private
 * opening a forged link to their own public recipe: the sentence is true there.
 *
 * Pure.
 *
 * @pattern Specification — a pure predicate-and-pick over facts the page already holds
 */
import type { PaidFeatureState } from '@commise/features-account';

import type { RecipeVisibilityToggleMessages } from './messages.js';
import { privateRefusalOf, type PrivateRefusal } from './privateGate.js';

/** What decides the notice. */
export interface VisibilityNoticeInput {
    /** Whether the viewer owns the recipe. A non-owner is never told anything about visibility. */
    readonly viewerIsOwner: boolean;
    /** Whether the recipe is public now. A refusal is true only while it is. */
    readonly isPublic: boolean;
    /** Why the server refused the LATEST Private for this recipe, if it did (`useServerRefusedPrivate`). */
    readonly serverRefusal: PrivateRefusal | undefined;
    /** Whether the finish said the editor withheld a Private: a claim, confirmed against `known` below. */
    readonly finishRefused: boolean;
    /** The profile's own answer (`knownPaidFeaturesOf`): `undefined` while unknown or after a failed read. */
    readonly known: PaidFeatureState | undefined;
    /** Whether the page's own visibility write failed, and no dialog says so itself. */
    readonly writeFailed: boolean;
}

/**
 * The words the page's visibility slot shows, if any.
 *
 * Precedence: a refusal the server gave, then the failure of the page's own write (it is the more recent word than a
 * finish that happened before it), then the finish claim, confirmed. A refusal says nothing once the recipe is no
 * longer public.
 *
 * @param input - What the page knows.
 * @param messages - The visibility copy.
 * @returns The sentence, or `undefined` when there is nothing to say.
 */
export function visibilityNoticeOf(
    input: VisibilityNoticeInput,
    messages: Pick<RecipeVisibilityToggleMessages, 'error' | 'privateRefused'>,
): string | undefined {
    if (!input.viewerIsOwner) {
        return undefined;
    }

    if (input.serverRefusal !== undefined) {
        return input.isPublic ? messages.privateRefused[input.serverRefusal] : undefined;
    }

    if (input.writeFailed) {
        return messages.error;
    }

    const claimed = input.finishRefused ? privateRefusalOf(input.known ?? 'loading') : undefined;

    return claimed !== undefined && input.isPublic ? messages.privateRefused[claimed] : undefined;
}
