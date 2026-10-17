// @vitest-environment node
/**
 * Tests for `withoutTsComments` — the comment stripper TEN guards read their source text through.
 *
 * ⛔ WHY THIS EARNS ITS OWN SUITE. Every guard that asks "does this file contain X" asks it of the
 * stripper's output, so a stripper that removes too much answers "no violation found" for a violation that
 * is right there. `lockOutReading`, `masterSecretConsumers`, `dbUserGrantRegister` and
 * `leaseFenceBypassRegister` are all of that shape, and all four fail SILENTLY in that direction.
 *
 * The regex pair this replaced removed block comments first, so a `/*` sequence appearing INSIDE a line
 * comment opened a block that ran to the next `*\/` — or to the end of the file. That is not a contrived
 * input: writing the path glob `packages/infra/global/**` in a `//` comment does it, which is how it was
 * found.
 */
import { describe, expect, it } from 'vitest';

import { readSource, sinkScanSources, withoutTsComments } from './roleSplitSources.js';

describe('withoutTsComments', () => {
    it('removes a line comment', () => {
        expect(withoutTsComments('const a = 1; // why\nconst b = 2;')).toContain('const b = 2;');
        expect(withoutTsComments('const a = 1; // why\nconst b = 2;')).not.toContain('why');
    });

    it('removes a block comment while preserving line numbering', () => {
        expect(withoutTsComments('/* one\n   two */\nconst b = 2;').split('\n')).toHaveLength(3);
        expect(withoutTsComments('/* one\n   two */\nconst b = 2;')).not.toContain('one');
    });

    /**
     * ⛔ THE DEFECT THIS SUITE EXISTS FOR. A path glob in a line comment is ordinary prose, and under the
     * previous implementation it swallowed every line after it — so the guard below reported that the file
     * declares no subscription filter at all.
     */
    it('⛔ does not let a /* sequence inside a LINE comment swallow the code after it', () => {
        const source = [
            '// a change under `packages/infra/global/**` arms the deploy',
            'const kept = 1;',
            '/** A LATER docstring — its close is what the stray open above reaches. */',
            'const alsoKept = 2;',
        ].join('\n');

        expect(withoutTsComments(source)).toContain('const kept = 1;');
        expect(withoutTsComments(source)).toContain('const alsoKept = 2;');
    });

    it('⛔ does not let a // sequence inside a BLOCK comment swallow the code after the close', () => {
        expect(withoutTsComments('/* see // below */ const kept = 1;')).toContain('const kept = 1;');
    });

    it('keeps a URL in a string — the `://` is not a comment', () => {
        expect(withoutTsComments("const u = 'https://example.com';")).toContain('https://example.com');
    });

    it('⚠️ keeps comment-LIKE text inside a string literal, in all three quotings', () => {
        expect(withoutTsComments('const a = "x // y";')).toContain('x // y');
        expect(withoutTsComments("const a = 'x /* y */ z';")).toContain('x /* y */ z');
        expect(withoutTsComments('const a = `x // y`;')).toContain('x // y');
    });

    it('does not treat an escaped quote as closing the string', () => {
        expect(withoutTsComments('const a = "he said \\" // not a comment"; const b = 2;')).toContain('const b = 2;');
    });

    /**
     * ⛔ THE REGEX LITERAL, which the first version of this scanner got wrong and its docstring then claimed
     * was theoretical. `/^https?:\/\//i` writes each slash as `\/`, so the pair `\/\/` presented `//` to
     * the line-comment check and everything after it on the line was eaten. Measured over the 1,346 files
     * the guards read, that damaged 8 real files — silently, in the direction where a guard finds nothing
     * and reports success.
     */
    it('⛔ does not read an escaped slash inside a REGEX LITERAL as a comment', () => {
        expect(withoutTsComments('const u = /^https?:\\/\\//i; const kept = 2;')).toContain('const kept = 2;');
        expect(withoutTsComments("const p = value.replace(/^\\.\\/src\\//u, ''); const kept = 3;")).toContain(
            'const kept = 3;',
        );
    });

    it('leaves a file with no comments byte-identical', () => {
        const source = 'export const a = 1;\nexport const b = a + 1;\n';

        expect(withoutTsComments(source)).toBe(source);
    });

    /**
     * ⛔ THE BLANKING LEMMA, asserted over the REAL corpus rather than argued in a comment — and it is here
     * rather than beside its one consumer because every guard that reads through this stripper may lean on
     * it. `prototypePollutionSinks.test.ts` screens a file's RAW text for a space-free PATTERN (a token is
     * the same thing with no alternation) before paying for the strip, which is only sound if blanking
     * cannot MANUFACTURE a match.
     *
     * Two properties make it so, and both are checked here over `sinkScanSources()` — the SAME set the
     * sweep reads, which is the point: asserted over `productionSources()` the lemma covered 1,254 files
     * while the sweep ran over 1,947, leaving the 693 `.tsx`/`.mjs` it had just been widened to include
     * outside its own soundness argument. The output is the same LENGTH as the input, and every position
     * it changes becomes a SPACE. Together they give `stripped[i] ∈ {raw[i], ' '}`.
     *
     * ⚠️ The space-free corollary is a THEOREM of those two, not a third check: a space-free match in the
     * stripped text sits on identical raw characters. It briefly had an `it` of its own, which asserted
     * that two strings both contain `{}` and passed under every stripper mutant including the identity —
     * coverage theatre carrying the name of the load-bearing claim. The case below is the one that
     * discriminates, and it is kept.
     *
     * ⚠️ THE COROLLARY IS NARROWER THAN IT FIRST LOOKS, and getting that wrong is what this test exists to
     * stop. It licenses only tokens containing NO SPACE: for those, `stripped.includes(token)` implies
     * `raw.includes(token)`. A token WITH a space can absolutely be manufactured — an inline comment
     * between two identifiers blanks to a run of spaces, so the stripped text contains `space c` where the
     * raw does not. A pre-filter screening for `space = {}` would therefore skip an annotated accumulator
     * whose comment sits immediately before the `=`, which IS a real sink. Both cases are pinned below, as
     * code rather than as prose, so the distinction cannot be lost to a later reader's summary of it.
     *
     * ⚠️ The examples live in the assertions and NOT in this block on purpose: an inline comment written
     * literally here would CLOSE it, which is the same defect that once blinded ten guards at once.
     */
    describe('the blanking lemma every raw-text pre-filter rests on', () => {
        // ⛔ AN EXPLICIT BUDGET, and the reasoning rather than a round number. This reads and per-character
        // scans all 1,947 files the sweep reads — the most work any test in this package does — and measures
        // 8.9s pinned to two cores. The failing CI run that started all this reported 517s of test time
        // against 221s for the same suite pinned here, a 2.3x factor, which puts this at ~21s against the
        // package's 30s default: 1.4x margin, on the exact axis that just failed. 60s restores ~2.8x.
        //
        // ⚠️ This is the lever the SWEEP should not have used — there the fix was to stop doing redundant
        // work, and it went 9.0s to 3.5s. Here the work is not redundant: the corpus IS the assertion, and
        // narrowing it is what the round that added this was blocked for.
        it(
            '⛔ preserves length and only ever substitutes spaces, across every file the guards read',
            // ⛔ 180s, AND THE CORPUS IS NOT NARROWED TO FIT. This sweeps every file the guards read
            // (~1,950) byte-for-byte, so it is genuinely slow; CI runs ~2.3x slower than a local pinned-to-
            // two-cores run, which is exactly the gap that turned a comfortable local pass into a 60s CI
            // timeout. Sampling or restricting the corpus would make it fast by making it prove less — and
            // the whole point of the lemma is that it holds for EVERY file a guard reads, not a sample.
            { timeout: 180_000 },
            () => {
                const defects: string[] = [];
                let changed = 0;

                for (const path of sinkScanSources()) {
                    const raw = readSource(path);
                    const stripped = withoutTsComments(raw);

                    if (stripped !== raw) {
                        changed += 1;
                    }

                    if (stripped.length !== raw.length) {
                        defects.push(`${path}: length ${raw.length} -> ${stripped.length}`);
                        continue;
                    }

                    for (let index = 0; index < raw.length; index += 1) {
                        if (stripped[index] !== raw[index] && stripped[index] !== ' ') {
                            defects.push(`${path}: offset ${index} became ${JSON.stringify(stripped[index])}`);
                            break;
                        }
                    }
                }

                expect(defects, defects.join('\n')).toEqual([]);

                // ⛔ A FLOOR THE IDENTITY FUNCTION CANNOT MEET. `defects === []` is satisfied by a stripper
                // that changes nothing at all, and by an empty corpus — so the lemma would hold vacuously in
                // exactly the two ways a derived-set assertion usually fails. Counting files the strip really
                // CHANGED rules out both; a path count only rules out the second.
                expect(changed, 'the stripper changed almost nothing — is it still stripping?').toBeGreaterThan(1_500);
            },
        );

        it('⛔ CAN manufacture a token containing a space — the property a pre-filter may NOT use', () => {
            expect(withoutTsComments('a/*b*/c')).toBe('a     c');
            expect('a/*b*/c'.includes(' c')).toBe(false);

            // The consequence, on a real sink: screening the raw text for ` = {}` would skip this file.
            const sink = 'const out: Record<string, unknown>/*why*/= {};';

            expect(sink.includes(' = {}')).toBe(false);
            expect(withoutTsComments(sink).includes(' = {}')).toBe(true);
        });
    });
});
