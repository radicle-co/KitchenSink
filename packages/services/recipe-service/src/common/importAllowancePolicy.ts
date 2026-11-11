/**
 * The import allowance (004 FR-022, ADR-0072 §8), judged by one pure function.
 *
 * FR-022: every user has a per-day import quota, and exceeding it is a distinct, machine-readable refusal carrying the
 * time more room opens. It is a PRODUCT allowance, not a transport rate limit: it is decided in the domain layer and is
 * expected to vary by subscription tier once 010 lands. Per-minute burst limiting stays the shipped throttler's job
 * (plan.md §5, "Daily allowance is NOT a throttler").
 *
 * ## The numbers, and where they come from
 *
 * Two channels, each with its OWN limit, its OWN rows and its own window (owner ruling 2026-10-26, ADR-0072 §8):
 *
 *  - **paste: 200 a rolling day**, one unit per paste (004 plan.md §5; spec D-006);
 *  - **bulk: 1,000 recipes a rolling day**, one unit per recipe (`/api/v1/import`).
 *
 * A trailing window, not a calendar day: a calendar day resets every user at the same instant and lets a burst straddle
 * midnight at double the allowance. Each channel sums ONLY its own rows, so paste and bulk import never borrow from each
 * other. The 50-a-day OCR sub-quota does not live here: plan.md moved it to 011 with its channel, which must inherit it
 * rather than re-derive it.
 *
 * ## One unit, and "admit what fits"
 *
 * A paste costs ONE unit however many lines it has (it does no outbound fetching and no OCR). A bulk import costs one unit
 * PER RECIPE, because LLM spend starts when a recipe's lines are first sent for parsing. A bulk file of ANY size is
 * accepted (owner ruling, second round): the policy admits the units that fit in today's room and says when more opens,
 * so a 2,000-recipe export imports 1,000 today and the rest follows. There is no per-file cap and no error for a large
 * file.
 *
 * ## The window edge
 *
 * An event counts while it is strictly younger than 24 h. One exactly 24 h old no longer counts: it left the window at
 * that instant, so the room it held is available at `createdAt + 24 h` and not a tick later. The edge is defined here and
 * nowhere else ({@link importAllowanceWindowStart}); the DAL prunes and reads with it.
 *
 * ## No tier input (yet)
 *
 * Every caller gets the same limit today, so the decision takes no tier. 010 adds the input, and the first rule that
 * reads it, together; an input nothing reads is a promise nothing checks. `isPremium` is the one tier fact every policy
 * here reads (`isPremiumPrincipal` in `auth/principal.ts`).
 *
 * @pattern Specification — one pure decision over the window's events; the DAL supplies the facts, this module owns the rule
 */
import type { ImportAllowanceChannel } from '../database/schema/importAllowanceEvents.js';

/** A rolling day, in milliseconds. */
const DAY_MS = 24 * 60 * 60 * 1000;

/** What one channel allows: how many units, over how long a trailing window. */
export interface ImportAllowanceRule {
    /** Units a user may spend in one window (the same for every caller until 010 specifies tier rules). */
    readonly limit: number;
    /** The trailing window an event counts in, in milliseconds. */
    readonly windowMs: number;
}

/**
 * Each channel's own rule: its limit and its own window (ADR-0072 §8). Typed over the channel union, so a channel added to
 * the ledger without a rule is a compile error rather than an unlimited channel. Both windows are a rolling day today;
 * they are separate values so that one can change without the other.
 */
export const IMPORT_ALLOWANCE_RULES: Readonly<Record<ImportAllowanceChannel, ImportAllowanceRule>> = {
    paste: { limit: 200, windowMs: DAY_MS },
    bulk: { limit: 1000, windowMs: DAY_MS },
};

/** One spent unit on the ledger: which channel spent it, how many units, and when. */
export interface AllowanceEvent {
    readonly channel: ImportAllowanceChannel;
    readonly units: number;
    readonly createdAt: Date;
}

/** What {@link evaluateImportAllowance} decides. */
export type ImportAllowanceDecision =
    /** Every requested unit fits. */
    | { readonly kind: 'admit'; readonly units: number }
    /** Only `units` (at least 1, fewer than requested) fit. The rest waits until `resetsAt`. */
    | { readonly kind: 'partial'; readonly units: number; readonly resetsAt: Date }
    /** No unit fits. More room opens at `resetsAt`. */
    | { readonly kind: 'refuse'; readonly resetsAt: Date };

/** What {@link evaluateImportAllowance} reads. */
export interface ImportAllowanceInput {
    /** The channel asking. Only this channel's events count against this channel's limit. */
    readonly channel: ImportAllowanceChannel;
    /** The user's ledger events. Other channels' and out-of-window ones are ignored here, so a caller may pass a superset. */
    readonly windowEvents: readonly AllowanceEvent[];
    /** Units this request would spend: a positive integer. There is no upper bound; the policy admits what fits. */
    readonly requestedUnits: number;
    /** The instant the decision is made at. */
    readonly now: Date;
}

/**
 * The instant before which an event no longer counts on `channel`. An event at or before this instant is out of the window.
 *
 * @param channel - The channel whose window this is.
 * @param now - The instant the decision is made at.
 * @returns `now` minus the window. Pure.
 */
export function importAllowanceWindowStart(channel: ImportAllowanceChannel, now: Date): Date {
    return new Date(now.getTime() - IMPORT_ALLOWANCE_RULES[channel].windowMs);
}

/**
 * The first instant at which `needed` more units have left the window.
 *
 * @param counted - The counted events, oldest first.
 * @param needed - Units that must leave: at least 1.
 * @param windowMs - The channel's window.
 * @returns The moment the last of the units needed leaves. Pure.
 */
function whenUnitsLeave(
    counted: readonly { units: number; createdAt: Date }[],
    needed: number,
    windowMs: number,
): Date {
    let freed = 0;

    for (const event of counted) {
        freed += event.units;

        if (freed >= needed) {
            return new Date(event.createdAt.getTime() + windowMs);
        }
    }

    throw new Error('unreachable: the counted units are the units that must leave, so freeing them all is enough');
}

/**
 * Decide how much of a request fits the channel's allowance, and when more room opens.
 *
 * `resetsAt` is derived from the events, never from `now`: it is the moment ONE more unit becomes available, because
 * "admit what fits" reopens the allowance as soon as any unit frees, not when the whole request would fit. After a
 * partial admission the units being written at `now` are part of the ledger the answer is read from.
 *
 * @param input - The channel, the user's window events, the units requested and the clock.
 * @returns `admit` (all of it), `partial` (the room that is left, and when more opens), or `refuse` (none, and when).
 * @throws {RangeError} when `requestedUnits` is not a positive integer: that is a caller defect, not a quota answer.
 */
export function evaluateImportAllowance(input: ImportAllowanceInput): ImportAllowanceDecision {
    if (!Number.isInteger(input.requestedUnits) || input.requestedUnits < 1) {
        throw new RangeError(`requestedUnits must be a positive integer, got ${String(input.requestedUnits)}`);
    }

    const windowStart = importAllowanceWindowStart(input.channel, input.now).getTime();
    const counted = input.windowEvents
        .filter((event) => event.channel === input.channel && event.createdAt.getTime() > windowStart)
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    const spent = counted.reduce((sum, event) => sum + event.units, 0);
    const { windowMs } = IMPORT_ALLOWANCE_RULES[input.channel];
    const room = IMPORT_ALLOWANCE_RULES[input.channel].limit - spent;

    if (room >= input.requestedUnits) {
        return { kind: 'admit', units: input.requestedUnits };
    }

    if (room < 1) {
        // Over the limit by `-room` (or exactly at it): ONE unit of room needs `1 - room` units to leave.
        return { kind: 'refuse', resetsAt: whenUnitsLeave(counted, 1 - room, windowMs) };
    }

    // The `room` units admitted now sit on the ledger at `now`, so the allowance is full again and the next unit to
    // leave is the oldest one counted, or the units just written when nothing older counts.
    const afterAdmission = [...counted, { units: room, createdAt: input.now }];

    return { kind: 'partial', units: room, resetsAt: whenUnitsLeave(afterAdmission, 1, windowMs) };
}

/** The caller's allowance on one channel as the import view shows it. */
export interface ImportAllowanceState {
    readonly limit: number;
    /** Units spent inside the window on this channel. */
    readonly used: number;
    /** An ISO instant: when the oldest counted unit leaves the window and room opens, or `null` when nothing is spent. */
    readonly resetsAt: string | null;
}

/**
 * Describe a channel's allowance for the import view.
 *
 * Read with the SAME window edge and the same per-channel rows the decision uses, so what the view says and what the next
 * `advance` does cannot disagree. An `advance` that reaches the allowance answers `200` with this state in the view (ADR-0072
 * §8 as amended), so the client keeps the progress it paid for and explains the pause from `used`, `limit` and `resetsAt`.
 *
 * @param input - The channel, the user's ledger events and the clock.
 * @returns The limit, the units spent and when more opens. Pure.
 */
export function describeImportAllowance(input: {
    readonly channel: ImportAllowanceChannel;
    readonly windowEvents: readonly AllowanceEvent[];
    readonly now: Date;
}): ImportAllowanceState {
    const windowStart = importAllowanceWindowStart(input.channel, input.now).getTime();
    const counted = input.windowEvents
        .filter((event) => event.channel === input.channel && event.createdAt.getTime() > windowStart)
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    const [oldest] = counted;

    return {
        limit: IMPORT_ALLOWANCE_RULES[input.channel].limit,
        used: counted.reduce((sum, event) => sum + event.units, 0),
        resetsAt:
            oldest === undefined
                ? null
                : new Date(oldest.createdAt.getTime() + IMPORT_ALLOWANCE_RULES[input.channel].windowMs).toISOString(),
    };
}
