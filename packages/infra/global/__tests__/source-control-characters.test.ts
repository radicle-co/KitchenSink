/**
 * Repo-wide guard: no tracked source file may contain a RAW control character.
 *
 * ── WHY THIS EXISTS: A CHECK THAT PRINTS NOTHING AND READS AS CLEAN ──
 *
 * Three files carried deliberate control-character separators written as LITERAL bytes rather than escapes —
 * `packages/clients/{food-service,recipe-service}/src/contractSkew.ts` used a raw `NUL` to join an origin and a
 * hash into a latch key, and `food-service/src/sources/usda/bulk/usda-bulk.parser.ts` used raw `NUL`, `0x01` and
 * `0x02` to join fields into a change-detection fingerprint. The VALUES were fine; the encoding was not.
 *
 * A single control byte makes a file BINARY to the POSIX toolchain. Measured consequences:
 *
 *  - `file(1)` reports the file as `data`, not text.
 *  - **`grep` treats it as binary and skips it — `grep -c` prints NOTHING, not `0`.** So a shell- or grep-based
 *    gate scanning these paths silently excluded them AND REPORTED SUCCESS. That is worse than a wrong answer: a
 *    wrong count invites a second look, an empty one looks like a clean sweep.
 *  - `git diff` shows "Binary files differ" instead of the change, so a review of one of these files shows nothing.
 *
 * Node-based gates (and every `vitest` suite) were unaffected, which is exactly why it survived: the tests that
 * could see the bytes did not care, and the tools that cared could not see the file.
 *
 * The fix is one escape per site — `\\u0000` written as characters, rather than the byte itself — for an
 * IDENTICAL runtime string. So the rule this test enforces costs nothing and removes a whole class of invisible
 * tooling failure.
 *
 * ⚠️ This file's own docstring tripped the gate on first run, because describing the defect in prose is the
 * easiest way to commit it. That is a feature: the gate has no exemption for itself.
 *
 * ⛔ Do NOT "fix" a future failure here by deleting the separator or switching to a printable one. A control
 * character is a GOOD separator precisely because it cannot occur in the data being joined; the defect was only
 * ever the encoding. Write the escape.
 *
 * ⚠️ This gate is deliberately NOT implemented with grep, for the reason above: it reads bytes with `node:fs`.
 */
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

// .../packages/infra/global/__tests__ → repo root is four levels up.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

/** Extensions this gate covers: everything a human authors and a shell tool might scan. */
const SOURCE_EXTENSIONS = /\.(?:ts|tsx|mjs|cjs|js|jsx|sh|yml|yaml|json|md|css|sql)$/u;

/**
 * Byte values that are illegal in a source file.
 *
 * TAB (`0x09`), LF (`0x0a`), VT (`0x0b`), FF (`0x0c`) and CR (`0x0d`) are excluded — they are ordinary whitespace
 * that every text tool handles. `DEL` (`0x7f`) is included because it is a control character with the same
 * effect on `file(1)` and `grep`.
 *
 * @param byte - The byte to classify.
 * @returns Whether the byte would make the file binary to the POSIX toolchain. Pure.
 */
function isIllegalControlByte(byte: number): boolean {
    return byte < 0x09 || (byte > 0x0d && byte < 0x20) || byte === 0x7f;
}

/** Every tracked source file, from the INDEX rather than the worktree (so `dist`/`.next` cannot inflate it). */
function trackedSources(): readonly string[] {
    const listed = execSync('git ls-files -z', { cwd: repoRoot, encoding: 'utf8', maxBuffer: 1 << 28 });

    return listed.split('\0').filter((file) => file.length > 0 && SOURCE_EXTENSIONS.test(file));
}

const files = trackedSources();

/** `file:offset` for every illegal byte found, with the byte named so a failure is actionable. */
function violations(): readonly string[] {
    const found: string[] = [];

    for (const file of files) {
        let bytes: Buffer;

        try {
            bytes = readFileSync(path.join(repoRoot, file));
        } catch {
            // A listed-but-absent path (a mid-rebase index) is not this gate's business.
            continue;
        }

        const counts = new Map<number, number>();

        for (const byte of bytes) {
            if (isIllegalControlByte(byte)) {
                counts.set(byte, (counts.get(byte) ?? 0) + 1);
            }
        }

        for (const [byte, count] of counts) {
            const hex = `0x${byte.toString(16).padStart(2, '0')}`;

            found.push(
                `${file}: ${count}× raw ${hex} — write it as the escape '\\u${byte.toString(16).padStart(4, '0')}' instead`,
            );
        }
    }

    return found.sort();
}

describe('no tracked source file contains a raw control character', () => {
    // A guard on the guard: if discovery yields nothing (a bad glob, a `git ls-files` that failed), the assertion
    // below passes against an empty set forever. This is the same class of failure the gate itself exists to
    // catch, so it is asserted first.
    it('discovers the sources it is meant to constrain', () => {
        expect(files.length).toBeGreaterThan(1_000);
        expect(files).toContain('packages/clients/food-service/src/contractSkew.ts');
        expect(files).toContain('packages/services/food-service/src/sources/usda/bulk/usda-bulk.parser.ts');
    });

    it('finds none', () => {
        expect(violations()).toEqual([]);
    });

    /*
     * MUTATION PROOF. The classifier is asserted to FIRE on each byte the three real files carried, and to stay
     * quiet for the whitespace it must not reject — so a change that inverted the range, or that "simplified" it
     * to `byte < 0x20` and started rejecting every tab and newline in the repo, fails here rather than turning
     * the suite red everywhere or green vacuously.
     */
    it.each([
        ['NUL', 0x00],
        ['SOH (0x01)', 0x01],
        ['STX (0x02)', 0x02],
        ['ESC', 0x1b],
        ['DEL', 0x7f],
    ])('classifies %s as illegal', (_label, byte) => {
        expect(isIllegalControlByte(byte)).toBe(true);
    });

    it.each([
        ['tab', 0x09],
        ['line feed', 0x0a],
        ['carriage return', 0x0d],
        ['space', 0x20],
        ['a printable letter', 0x41],
    ])('classifies %s as legal', (_label, byte) => {
        expect(isIllegalControlByte(byte)).toBe(false);
    });
});
