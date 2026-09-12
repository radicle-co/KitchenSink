/**
 * @module @commise/features-recipes/versions — Formatting a version's instant for the version surfaces — ABSOLUTE (`Intl.DateTimeFormat`) and
 * RELATIVE (`Intl.RelativeTimeFormat`).
 *
 * ⛔ This module takes a {@link Locale} and NEVER the localized copy: it knows no message keys, which is the
 * line that keeps it separate from `diffLabels.ts` (whose dependency set is the exact mirror — messages, no
 * locale). Two modules rather than one `labels.ts` because those dependency sets are DISJOINT.
 *
 * ⚠️ Deliberately NOT hoisted into a shared date module. `card/model.ts` states the ruling: its own relative
 * formatter is "its own compact, week-capable bucketing rather than a forced shared abstraction", because this
 * one renders a verbose day-capped sentence for the conflict banner. The sharing was considered and declined.
 *
 * Pure and platform-agnostic: shared unchanged by the web (`*.tsx`) and native (`*.native.tsx`) leaves, so
 * the two renders can never drift. No React, no platform APIs.
 */
import type { Locale } from '@commise/i18n';

/**
 * Format a version's ISO 8601 timestamp for display in the active locale. Formatted in UTC so the output
 * is deterministic regardless of the runtime's timezone (a version's `createdAt` is an absolute instant,
 * not a local wall-clock time). Pure.
 *
 * @param isoDateTime - The ISO 8601 timestamp (with offset).
 * @param locale - The active BCP-47 locale.
 * @returns The localized date-time string.
 */
export const formatVersionTimestamp = (isoDateTime: string, locale: Locale): string =>
    new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(
        new Date(isoDateTime),
    );

// ─── Per-side banner (W7 Task 3 / X3) ────────────────────────────────────────────────────────────────
//
// The conflict view's top banner names each side plainly: the server's winning version (its version number,
// and when it was saved) and the user's own in-progress draft (which was never persisted, so it carries no
// version number of its own). Server is ALWAYS first (X7).

/**
 * Format an ISO 8601 instant as a localized "N units ago" relative-time string via `Intl.RelativeTimeFormat`
 * (library-first — never hand-rolled pluralization/wording; mirrors `formatHomeDate`'s split of "the caller
 * reads the clock, this module only formats an instant"). Buckets to the largest whole unit that has elapsed
 * at least once — minutes, then hours, then days — floored, so e.g. 90 elapsed seconds reads as "1 minute
 * ago", not "90 seconds ago". An instant within the same minute (or, degenerately, in the future — clock
 * skew) reads as "0 minutes ago". Pure — the caller supplies `now`.
 *
 * @param isoDateTime - The past instant to render, in ISO 8601.
 * @param now - The current instant, supplied by the caller (its own `new Date()` read is the side effect).
 * @param locale - The active BCP-47 locale.
 * @returns The localized "N units ago" string.
 */
export const formatRelativeTimeAgo = (isoDateTime: string, now: Date, locale: Locale): string => {
    const elapsedSeconds = Math.max(0, Math.floor((now.getTime() - new Date(isoDateTime).getTime()) / 1000));
    const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'always' });

    const [amount, unit]: [number, Intl.RelativeTimeFormatUnit] =
        elapsedSeconds < 60
            ? [0, 'minute']
            : elapsedSeconds < 3600
              ? [Math.floor(elapsedSeconds / 60), 'minute']
              : elapsedSeconds < 86400
                ? [Math.floor(elapsedSeconds / 3600), 'hour']
                : [Math.floor(elapsedSeconds / 86400), 'day'];

    // `-amount` even at `amount === 0`: `Intl.RelativeTimeFormat` reads the SIGN, not the magnitude, to pick
    // "ago" vs. "in" — `format(0, 'minute')` renders "in 0 minutes" (treated as the future direction), while
    // `format(-0, 'minute')` renders "0 minutes ago". A sub-minute-old server side must still read "ago", not
    // "in 0 minutes", so this always negates (JS's `-0` is a distinct, valid float from `0`).
    return rtf.format(-amount, unit);
};
