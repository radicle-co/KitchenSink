/**
 * @module @kitchensink/docgen-components/serialize — the ONE place a generated artifact becomes bytes.
 *
 * ⛔ DETERMINISM IS THE CONTRACT, not a nicety. The committed output is guarded by regenerate-and-diff
 * (`tests/generatedOutput.integration.test.ts`), so anything that varies between two runs over the same
 * sources turns the guard into a permanently-red check nobody can explain — and a guard people learn to
 * ignore is worse than no guard. That rules out, specifically:
 *
 *  - a generation TIMESTAMP (every run would differ),
 *  - absolute paths (every checkout would differ),
 *  - a tool VERSION stamp (a dependency bump would look like documentation drift),
 *  - iteration order that depends on the filesystem (every machine could differ).
 *
 * The first three are simply absent; the fourth is handled by sorting at every level in `extract.ts`,
 * `catalog.ts` and `findings.ts`.
 */

/**
 * Render a value as the exact bytes written to disk.
 *
 * Four-space indent and a trailing newline match this repository's Prettier settings, so the artifact reads
 * like the rest of the tree. `docs/generated/**` is nonetheless in `.prettierignore`, following the precedent
 * set for `packages/schemas/*\/openapi.yaml`: reformatting derived output — even harmlessly — reads as drift
 * to the guard, and a future Prettier release must not be able to turn today's coincidence into a red check.
 *
 * @param value - Any JSON-serializable value.
 * @returns The file text.
 */
export function toJsonText(value: unknown): string {
    return `${JSON.stringify(value, null, 4)}\n`;
}
