/**
 * The bulk import's view of a free cook's private slots (ADR-0073, ADR-0072 §9).
 *
 * DESIGN PATTERN: **Port (hexagonal)**, with an explicit STUB. The slot count, the per-user lock and the `PRIVATE_SLOTS_FULL`
 * denial are built by ANOTHER lane (ADR-0073's builder). This is the seam the import reads, and nothing else:
 *
 *  - It is a NON-LOCKING READ and an ADVISORY one. The authoritative check runs inside the recipe's own transaction under the
 *    per-user advisory lock (ADR-0073 §5), where `RecipesService.create` takes it; "a slot fact computed before the
 *    transaction is never trusted". So this port takes no transaction, and the importer treats a `true` from it as "worth
 *    trying" and a `PRIVATE_SLOTS_FULL` thrown by the save as the truth.
 *  - It exists so the view can DERIVE the pause (§8: the pause is derived from the live count and never stored) and so a
 *    cook who is already out of slots is not sent through a doomed save per recipe.
 *
 * ⚠️ THE BOUND IMPLEMENTATION IS A STUB: {@link UNLIMITED_PRIVATE_SLOTS} says a slot is always free, because today's policy
 * has no slot count (a free cook's private `user_created` recipe is refused by the policy itself). The slots lane replaces the
 * binding in `ImportModule` with one that counts live (`COUNT(*)` of the cook's private, undeleted recipes against 50, no
 * limit for Premium). Nothing else in the import changes: the pause, the `outOfSlots` issue and the mapping of a
 * `PRIVATE_SLOTS_FULL` denial from the save are already wired against this port and its error code.
 */

/** DI token for {@link PrivateSlotsPort}. */
export const PRIVATE_SLOTS = 'IMPORT_PRIVATE_SLOTS';

/** The error code the save path throws when the cook has no private slot left (ADR-0073 §3). */
const PRIVATE_SLOTS_FULL_CODE = 'PRIVATE_SLOTS_FULL';

/**
 * Whether a thrown value is the save path's "no private slot left" denial (ADR-0073).
 *
 * ONE shape, on purpose: the slots lane throws a domain error, which is an `Error` carrying `code`. This is the only place that
 * knows how to read it, next to the code it reads.
 *
 * @param error - Anything thrown by the create path.
 * @returns Whether it is the denial. Pure.
 */
export function isPrivateSlotsFull(error: unknown): boolean {
    return error instanceof Error && 'code' in error && error.code === PRIVATE_SLOTS_FULL_CODE;
}

export interface PrivateSlotsPort {
    /**
     * Whether the cook has at least one private slot free right now.
     *
     * @param userId - The verified app-user ULID.
     * @returns `true` when one is free (or the cook has no limit). Advisory, not a reservation.
     */
    hasAvailable(userId: string): Promise<boolean>;
}

/** The stub: every cook has a slot free, until ADR-0073's lane binds the real count. */
export const UNLIMITED_PRIVATE_SLOTS: PrivateSlotsPort = { hasAvailable: () => Promise.resolve(true) };
