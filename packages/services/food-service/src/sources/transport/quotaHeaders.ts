/**
 * A publisher's own count of its quota, read from the header names the source's register declaration states
 * (ADR-0053 §5). For USDA it is the only count that sees the API key's other users (plan U26), so the block rule
 * reads it as well as our own call log.
 *
 * ⚠️ Absence is not 0. A header the publisher did not send, or sent in a form this module cannot read, is reported
 * as absent: a 0 would read as an exhausted quota and block the source for an hour.
 *
 * @pattern Parser — headers in, a typed reading or nothing out
 * @module
 */

/** The header names a register declaration gives for its publisher's quota. */
export interface QuotaHeaderNames {
    /** The header carrying the calls left in the publisher's window. */
    readonly remainingHeader: string;
    /** The header carrying the size of the publisher's window. */
    readonly limitHeader: string;
}

/** One response's quota reading. A field is present only when the publisher sent it in a readable form. */
export interface QuotaReading {
    /** The calls the publisher says its window holds. */
    readonly limit?: number;
    /** The calls the publisher says are left in its window. */
    readonly remaining?: number;
}

/** The part of `Headers` this module reads: a case-insensitive lookup that answers `null` for an absent header. */
export interface HeaderBag {
    get(name: string): string | null;
}

/** A non-negative decimal whole number and nothing else. */
const COUNT = /^\d+$/u;

/**
 * One header's count. Pure.
 *
 * @param raw - The header's value, or `null` when absent.
 * @returns The count, or `undefined` when absent or not a non-negative whole number.
 */
function countOf(raw: string | null): number | undefined {
    const text = raw?.trim();

    return text !== undefined && COUNT.test(text) ? Number(text) : undefined;
}

/**
 * Read a response's quota counts. Pure.
 *
 * @param headers - The response's headers.
 * @param names - The header names the source declares.
 * @returns The reading, or `undefined` when neither count was readable.
 */
export function readQuota(headers: HeaderBag, names: QuotaHeaderNames): QuotaReading | undefined {
    const remaining = countOf(headers.get(names.remainingHeader));
    const limit = countOf(headers.get(names.limitHeader));

    if (remaining === undefined && limit === undefined) {
        return undefined;
    }

    return {
        ...(remaining === undefined ? {} : { remaining }),
        ...(limit === undefined ? {} : { limit }),
    };
}
