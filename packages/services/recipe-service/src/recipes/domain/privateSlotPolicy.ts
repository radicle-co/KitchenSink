/**
 * ADR-0073 - the free-tier private slots, as pure rules: how many a cook may hold, whether they have one, and when
 * the question needs asking at all. No database, no principal, no I/O.
 *
 * @pattern Policy module (specification + value object) - the sibling of `visibilityPolicy.ts`, which consumes the
 *   OUTCOME of {@link hasFreePrivateSlot} as one required boolean. The live count and the per-user lock that make that
 *   boolean true are the caller's, in the write's own transaction (`dal/privateSlots.dal.ts`); a fact computed anywhere
 *   else is exactly the race the lock exists to close.
 *
 * ## What a slot is
 *
 * A used slot is one `recipes` row that is owned by the cook, `private`, `published` and not deleted (ADR-0073 sections
 * 2 and 12; owner ruling 2026-10-26: a DRAFT holds no slot) - every label. It is counted live; this module never sees a
 * stored counter because there is none. {@link holdsPrivateSlot} is the in-memory twin of the count's `WHERE`
 * (`dal/privateSlots.dal.ts`): change one and the other moves with it.
 *
 * ## The seam 015 will extend (ADR-0073 section 9)
 *
 * The limit is resolved in ONE place, {@link privateSlotAllowanceOf}. 015's earned slots will add to the base there and
 * nowhere else; the policy's input does not change.
 */
import { RecipeStatus, RecipeVisibility, privateRuleOf } from '@kitchensink/recipe-core';
import type { RecipeSourceType } from '@kitchensink/recipe-core';

/**
 * The private recipes a free cook may hold: the owner ruling of 2026-10-26. The ONLY place the number is stated.
 *
 * Raising it is free; lowering it leaves cooks over the limit (they keep their recipes, and cannot add more).
 */
export const FREE_PRIVATE_SLOT_LIMIT = 50;

/** How many private slots a cook may use: a number, or no limit at all (Premium). */
export type PrivateSlotAllowance =
    { readonly kind: 'limited'; readonly limit: number } | { readonly kind: 'unlimited' };

/**
 * A cook's allowance. Pure.
 *
 * @param input.isPremium - Whether the cook holds the Premium entitlement (read from the signed token, never a field).
 * @returns `unlimited` for Premium; for a free cook the base of {@link FREE_PRIVATE_SLOT_LIMIT} (015's earned slots add here).
 */
export function privateSlotAllowanceOf(input: { readonly isPremium: boolean }): PrivateSlotAllowance {
    return input.isPremium ? { kind: 'unlimited' } : { kind: 'limited', limit: FREE_PRIVATE_SLOT_LIMIT };
}

/**
 * Whether a cook who already holds `used` private recipes may hold one more. Pure.
 *
 * The boundary: with a limit of 50, holding 49 leaves a slot and holding 50 does not. A downgraded cook over the limit
 * (60) has none, and keeps all 60.
 *
 * @param allowance - The cook's allowance.
 * @param used - The live count of the cook's private, undeleted recipes.
 */
export function hasFreePrivateSlot(allowance: PrivateSlotAllowance, used: number): boolean {
    return allowance.kind === 'unlimited' || used < allowance.limit;
}

/** The two facts of a recipe that decide whether it holds a slot (its owner and tombstone are the count's concern). */
export interface SlotFacts {
    readonly visibility: RecipeVisibility;
    readonly status: RecipeStatus;
}

/**
 * Whether a recipe holds a private slot: it is private AND published (ADR-0073 section 12). Pure.
 *
 * A private draft holds none; neither does anything public.
 */
export function holdsPrivateSlot(facts: SlotFacts): boolean {
    return facts.visibility === RecipeVisibility.PRIVATE && facts.status === RecipeStatus.PUBLISHED;
}

/**
 * Whether the slot rule can apply to this cook and this label at all. Pure.
 *
 *  - Premium never counts slots.
 *  - `imported_public` goes private only with Premium and a substantive edit (ADR-0073 section 6): a free cook is refused
 *    for want of Premium before slots are looked at, so a slot never makes one private.
 *
 * It is the cheap gate in front of the per-user lock, for a write whose recipe facts are only known under that lock.
 */
export function slotRuleApplies(input: {
    readonly sourceType: RecipeSourceType;
    readonly isPremium: boolean;
}): boolean {
    return !input.isPremium && privateRuleOf(input.sourceType) !== 'premium';
}

/**
 * Whether a write makes a recipe COME TO HOLD a slot, so that the live count must be consulted. Pure.
 *
 * The check runs on that transition only (ADR-0073 section 3): the recipe holds no slot before the write (or does not yet
 * exist) and holds one after it. So a private draft saved or edited never checks; publishing it does; a published private
 * recipe saved again does not (it already holds its slot); and making a recipe public or sending it back to draft frees one.
 *
 * Every field is required, so a call site cannot forget the half of the transition it did not think about.
 *
 * @param input.before - The recipe's facts before the write, `undefined` for one being created.
 * @param input.after - Its facts after the write.
 * @returns `true` only for a free cook, on a label the slot rule applies to ({@link slotRuleApplies}), when the write
 *   takes a slot.
 */
export function requiresPrivateSlotCheck(input: {
    readonly sourceType: RecipeSourceType;
    readonly isPremium: boolean;
    readonly before: SlotFacts | undefined;
    readonly after: SlotFacts;
}): boolean {
    return (
        slotRuleApplies(input) &&
        !(input.before !== undefined && holdsPrivateSlot(input.before)) &&
        holdsPrivateSlot(input.after)
    );
}

/**
 * A cook's private-slot standing at the moment of a write: either one more private recipe fits, or it does not and the
 * refusal can say how many they hold and what their limit is. The `used` and `limit` exist ONLY in the no-slot arm, so a
 * refusal cannot be built without them and a free slot cannot be mistaken for a full one.
 */
export type PrivateSlotStanding =
    | { readonly hasAvailablePrivateSlot: true }
    | { readonly hasAvailablePrivateSlot: false; readonly used: number; readonly limit: number };

/** The standing of a write for which no slot is needed (public, draft, Premium, imported_public, already holding one): none is lacking. */
export const SLOT_NOT_NEEDED: PrivateSlotStanding = { hasAvailablePrivateSlot: true };

/**
 * The standing of a cook who holds `used` private recipes. Pure.
 *
 * @param allowance - The cook's allowance ({@link privateSlotAllowanceOf}).
 * @param used - The live count, read under the per-user lock.
 * @returns A free slot, or none with the count and the limit.
 */
export function privateSlotStandingOf(allowance: PrivateSlotAllowance, used: number): PrivateSlotStanding {
    if (hasFreePrivateSlot(allowance, used)) {
        return SLOT_NOT_NEEDED;
    }

    // Only a limited allowance can run out.
    return allowance.kind === 'limited'
        ? { hasAvailablePrivateSlot: false, used, limit: allowance.limit }
        : SLOT_NOT_NEEDED;
}
