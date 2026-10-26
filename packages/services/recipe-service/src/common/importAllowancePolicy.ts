/**
 * The daily import allowance (004 FR-022), judged by one pure function.
 *
 * FR-022: every user has a per-day import quota across all channels, and exceeding it is a distinct, machine-readable
 * refusal carrying the time the quota resets. It is a PRODUCT allowance, not a transport rate limit: it is decided in the
 * domain layer and is expected to vary by subscription tier once 010 lands. Per-minute burst limiting stays the shipped
 * throttler's job (plan.md §5, "Daily allowance is NOT a throttler").
 *
 * ## The numbers, and where they come from
 *
 * **200 units a day per user, over a trailing 24 hours** (004 plan.md §5, "Rate limiting and backpressure"; spec D-006).
 * A trailing window, not a calendar day: a calendar day resets every user at the same instant and lets a burst straddle
 * midnight at double the allowance. The 50-a-day OCR sub-quota does not live here: plan.md moved it to 011 with its
 * channel, which must inherit it rather than re-derive it.
 *
 * ## One unit
 *
 * A paste costs ONE unit however many lines it has, and a bulk file import costs one unit (D-013): the allowance bounds
 * outbound fetching and OCR spend, and a paste does neither, so charging per line would make a first-day migration spend a
 * user's whole allowance on the day they join.
 *
 * ## The window edge
 *
 * An event counts while it is strictly younger than 24 h. One exactly 24 h old no longer counts: it left the window at
 * that instant, so the allowance it held is available at `createdAt + 24 h` and not a tick later. The edge is defined here
 * and nowhere else ({@link importAllowanceWindowStart}); the DAL prunes and reads with it.
 *
 * ## The tier seam
 *
 * The tier is a parameter and today changes nothing, which is the seam 010 needs without inventing tier rules it has not
 * specified. `isPremium` is the one tier fact every policy here reads (`isPremiumPrincipal` in `auth/principal.ts`).
 *
 * @pattern Specification — one pure decision over the window's events; the DAL supplies the facts, this module owns the rule
 */

/** The trailing window an event counts in, in milliseconds: 24 hours. */
export const IMPORT_ALLOWANCE_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Units a user may spend in one window, whatever the tier (010 will vary this by tier). */
export const IMPORT_ALLOWANCE_DAILY_LIMIT = 200;

/** The caller's tier, as far as the allowance is concerned: the same fact `isPremiumPrincipal` reads. */
export interface ImportAllowanceTier {
    readonly isPremium: boolean;
}

/** One spent unit on the ledger: how many units, and when. */
export interface AllowanceEvent {
    readonly units: number;
    readonly createdAt: Date;
}

/** What {@link evaluateImportAllowance} decides. */
export type ImportAllowanceDecision =
    | { readonly kind: 'admit' }
    | {
          readonly kind: 'refuse';
          /** The first instant at which the requested units fit: the allowance reopens then. Always after `now`. */
          readonly resetsAt: Date;
      };

/** What {@link evaluateImportAllowance} reads. */
export interface ImportAllowanceInput {
    readonly tier: ImportAllowanceTier;
    /** The user's ledger events. Ones outside the window are ignored here, so a caller may pass a superset. */
    readonly windowEvents: readonly AllowanceEvent[];
    /** Units this request would spend: a positive integer no larger than the daily limit. */
    readonly requestedUnits: number;
    /** The instant the decision is made at. */
    readonly now: Date;
}

/**
 * The limit for a tier. Today every tier gets the same one; 010 will make this the only place that differs.
 *
 * @param _tier - The caller's tier (unread until 010 specifies tier rules).
 * @returns Units per window. Pure.
 */
function limitFor(_tier: ImportAllowanceTier): number {
    return IMPORT_ALLOWANCE_DAILY_LIMIT;
}

/**
 * The instant before which an event no longer counts. An event at or before this instant is out of the window.
 *
 * @param now - The instant the decision is made at.
 * @returns `now` minus 24 h. Pure.
 */
export function importAllowanceWindowStart(now: Date): Date {
    return new Date(now.getTime() - IMPORT_ALLOWANCE_WINDOW_MS);
}

/**
 * Decide whether a request fits the allowance, and when it would if it does not.
 *
 * `resetsAt` is derived from the events, never from `now`: it is the moment enough of the OLDEST counted units leave the
 * window for the request to fit, so the answer is true to the second a cook would otherwise have to guess.
 *
 * @param input - The tier, the user's window events, the units requested and the clock.
 * @returns `admit`, or `refuse` with the instant the allowance reopens for this request.
 * @throws {RangeError} when `requestedUnits` is not a positive integer within the daily limit: such a request can never
 *   be admitted, so a "refusal" with a reset time would be a lie. It is a caller defect, not a quota answer.
 */
export function evaluateImportAllowance(input: ImportAllowanceInput): ImportAllowanceDecision {
    const limit = limitFor(input.tier);

    if (!Number.isInteger(input.requestedUnits) || input.requestedUnits < 1 || input.requestedUnits > limit) {
        throw new RangeError(
            `requestedUnits must be an integer from 1 to ${String(limit)}, got ${String(input.requestedUnits)}`,
        );
    }

    const windowStart = importAllowanceWindowStart(input.now).getTime();
    const counted = input.windowEvents
        .filter((event) => event.createdAt.getTime() > windowStart)
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    const spent = counted.reduce((sum, event) => sum + event.units, 0);
    const overBy = spent + input.requestedUnits - limit;

    if (overBy <= 0) {
        return { kind: 'admit' };
    }

    // Walk the oldest units off the window until enough have left to fit the request. `overBy > 0` and the request fits
    // the limit on its own, so freeing every counted unit would certainly fit it: the walk always ends on an event.
    let freed = 0;

    for (const event of counted) {
        freed += event.units;

        if (freed >= overBy) {
            return { kind: 'refuse', resetsAt: new Date(event.createdAt.getTime() + IMPORT_ALLOWANCE_WINDOW_MS) };
        }
    }

    throw new Error('unreachable: freeing every counted unit always fits a request within the limit');
}
