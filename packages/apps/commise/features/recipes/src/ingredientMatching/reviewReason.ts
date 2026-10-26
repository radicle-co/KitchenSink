/**
 * @module @commise/features-recipes/ingredientMatching — the cook-facing words for a server `reason` key (ADR-0071
 * section 9). The key is opaque on the wire and the client localises it; "See why" shows the sentence beside a late
 * review note on the cook's pick. A key this client does not know (a newer server's) reads the general sentence: a raw key
 * is never shown, and the lookup never reads a key off the prototype.
 *
 * Pure and platform-agnostic.
 */
import type { MatchLineMessages } from './messages.js';

/**
 * The words for a reason.
 *
 * @param copy - The matched line's localised copy.
 * @param reason - The wire's `reason` key.
 * @returns The sentence, or the general one for an unknown key.
 */
export function reviewReasonOf(copy: Pick<MatchLineMessages, 'reasons' | 'reasonFallback'>, reason: string): string {
    return Object.hasOwn(copy.reasons, reason)
        ? copy.reasons[reason as keyof MatchLineMessages['reasons']]
        : copy.reasonFallback;
}
