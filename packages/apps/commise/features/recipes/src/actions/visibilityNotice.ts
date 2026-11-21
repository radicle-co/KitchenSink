/**
 * @module @commise/features-recipes/actions — what the recipe page says about its visibility, inline under the rating
 * and visibility line (`docs/design/uiOverhaul/buildSpec.md` §6.4; plan 2026-10-14-009 T3). One answer for both
 * platforms, so web and native cannot disagree about when the sentence shows.
 *
 * It serves two kinds of words (board P6, KTD-3). A MOMENT is something that just happened and needs action now: a Private
 * refused, the page's own write failed, the editor's finish claim. A STANDING line says why a private recipe stays private
 * (`publicRefusalOf`); it is always there for the owner while the recipe is private, so it is muted, and a moment line
 * comes before it.
 *
 * A moment serves three ways a Private is refused: the editor withheld it because the server would refuse it (the finish
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
import { fillTemplate } from '@commise/i18n';
import type { PublicRefusalMessages, RecipeVisibilityToggleMessages } from './messages.js';
import type { PrivateRefusal } from './privateGate.js';
import { publicRefusalLineOf, type PublicRefusal } from './publicRefusal.js';

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
    /**
     * Why Private is KNOWN to be refused for this viewer on this recipe (`recipePrivateRefusalOf`): `undefined` while
     * nothing is known, a loading or failed read of the paid features or the slot count included.
     */
    readonly knownRefusal: PrivateRefusal | undefined;
    /** Whether the page's own visibility write failed, and no dialog says so itself. */
    readonly writeFailed: boolean;
    /**
     * The cook's private-slot limit as the SERVER stated it (the 403's `limit`, else the standing's), or `undefined` when
     * it has not said. The `slots` sentence names it, so without one that sentence cannot be said truthfully and the
     * generic failure is said instead.
     */
    readonly slotLimit: number | undefined;
    /**
     * Why the recipe cannot be public (`publicRefusalOf`, which reads the held flag: the server's `publicNeedsCheck`, or its
     * refusal `SOURCE_CONFLICT` a moment ago). Said as a standing line while the recipe is not public; `none` says nothing.
     */
    readonly standing: PublicRefusal;
}

/**
 * What the slot says. A `moment` needs action now, so it is the page's assertive danger line. A `standing` line is why a
 * private recipe stays private: muted, with no icon, and announced once, when it first appears (KTD-6).
 */
export type VisibilityNotice =
    | { readonly kind: 'moment'; readonly text: string }
    | { readonly kind: 'standing'; readonly reason: Exclude<PublicRefusal, 'none'>; readonly text: string };

/**
 * The words the page's visibility slot shows, if any.
 *
 * Precedence: a refusal the server gave, then the failure of the page's own write (it is the more recent word than a
 * finish that happened before it), then the finish claim, confirmed; these are moments. A refusal says nothing once the
 * recipe is no longer public. Last, while the recipe is not public, the standing reason.
 *
 * @param input - What the page knows.
 * @param messages - The visibility copy and the reason lines.
 * @returns The notice, or `undefined` when there is nothing to say.
 */
export function visibilityNoticeOf(
    input: VisibilityNoticeInput,
    messages: Pick<RecipeVisibilityToggleMessages, 'error' | 'privateRefused'> & {
        /** One line per reason a recipe stays private (`publicRefusalLineOf`). */
        readonly publicRefusal: PublicRefusalMessages;
    },
): VisibilityNotice | undefined {
    if (!input.viewerIsOwner) {
        return undefined;
    }

    const moment = (text: string): VisibilityNotice => ({ kind: 'moment', text });

    const say = (reason: PrivateRefusal): VisibilityNotice => {
        // Every refusal a recipe can meet is `slots` (ADR-0077 section 6); any other reason, from a link made before it,
        // is said as the generic `final`.
        if (reason !== 'slots') {
            return moment(messages.privateRefused.final);
        }

        return moment(
            input.slotLimit === undefined
                ? messages.error
                : fillTemplate(messages.privateRefused.slots, { total: input.slotLimit }),
        );
    };

    if (input.serverRefusal !== undefined && input.isPublic) {
        return say(input.serverRefusal);
    }

    if (input.writeFailed) {
        return moment(messages.error);
    }

    const claimed = input.finishRefused ? input.knownRefusal : undefined;

    if (claimed !== undefined && input.isPublic) {
        return say(claimed);
    }

    if (input.isPublic || input.standing === 'none') {
        return undefined;
    }

    const text = publicRefusalLineOf(input.standing, messages.publicRefusal);

    return text === undefined ? undefined : { kind: 'standing', reason: input.standing, text };
}
