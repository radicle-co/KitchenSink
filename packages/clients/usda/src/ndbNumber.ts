/**
 * USDA's NDB number, read the same way from the live API and from the bulk CSVs.
 *
 * A module of its own, apart from the HTTP client: food's bulk reader, which the catalog seed function bundles, shares
 * this rule with the client, and the seed must ship no HTTP code (curated catalog plan R38,
 * `packages/infra/global/__tests__/seedBundleImports.test.ts`).
 */

/**
 * An NDB number as a decimal string with no leading zeros, from either form USDA sends: the integer the live API
 * sends, or the digit string its spec and its bulk CSVs carry. Pure.
 *
 * @param value - A raw `ndbNumber` or `NDB_number`.
 * @returns The number, or `undefined` for an absent or malformed value.
 */
export function normalizeNdbNumber(value: unknown): string | undefined {
    if (typeof value === 'number') {
        return Number.isSafeInteger(value) && value > 0 ? String(value) : undefined;
    }

    if (typeof value === 'string') {
        return /^0*([1-9][0-9]*)$/u.exec(value)?.[1];
    }

    return undefined;
}
