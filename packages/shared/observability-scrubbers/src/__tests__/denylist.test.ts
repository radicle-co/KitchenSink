import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { DENYLIST_KEYS, ID_KEYS, isDeniedKey, isIdKey, looksLikeBearerToken } from '../denylist.js';

/**
 * ⛔ THIS ENTRY MUST STAY PURE, OR THE SPLIT HAS BOUGHT NOTHING.
 *
 * It exists for exactly one reason: React Native has no `node:crypto`, so mobile could not import
 * `scrubbers.ts` and kept its own copy of this list — the fifth in the repository, held equal to the real one
 * by an assertion rather than by being the same list. The moment this module imports anything, mobile cannot
 * import it either, the copy comes back, and the only signal is an equality test that tells you the lists
 * diverged after they already have.
 *
 * ⚠️ So the assertion is on the MODULE GRAPH, not on behaviour. Behaviour is covered next door; a green
 * behaviour suite says nothing about whether this file can be loaded on a phone.
 */
describe('the denylist entry is importable from a runtime with no Node built-ins', () => {
    /**
     * The module's CODE, with comments removed.
     *
     * ⛔ A TEXT GATE OVER SOURCE READS ITS OWN DOCUMENTATION AS CODE. The first version of the assertion
     * below failed on this very file's docstring, which explains the rule by NAMING `node:crypto` — so the
     * guard reported the explanation as the violation. That is the same failure `RecipeWorkersStack.test.ts`
     * records for a dependency's JSDoc `@example`, and `testPoolWorkflowWiring.test.ts` for a step comment.
     */
    const code = (): string => {
        const source = readFileSync(new URL('../denylist.ts', import.meta.url), 'utf8');

        return source
            .replace(/\/\*[\s\S]*?\*\//gu, '')
            .split('\n')
            .filter((line) => !line.trimStart().startsWith('//'))
            .join('\n');
    };

    it('⛔ imports nothing at all', () => {
        const imports = [...code().matchAll(/^\s*import\s.+$/gmu)].map((match) => match[0].trim());

        expect(imports, 'the pure entry may not import anything — see the module docstring').toEqual([]);
    });

    it('⛔ and names no Node built-in even indirectly', () => {
        expect(code()).not.toMatch(/require\(|node:|process\./u);
    });

    /**
     * ⛔ Fired at a fake, because both assertions above pass on an EMPTY file. A guard whose subject is the
     * absence of something must be shown to notice a presence.
     */
    it('⛔ notices an import when there is one', () => {
        const withImport = "import { createHash } from 'node:crypto';\nexport const X = 1;\n";

        expect([...withImport.matchAll(/^\s*import\s.+$/gmu)]).toHaveLength(1);
        expect(withImport).toMatch(/node:/u);
    });
});

describe('the vocabulary', () => {
    it('redacts by key, case-insensitively', () => {
        expect(isDeniedKey('Authorization')).toBe(true);
        expect(isDeniedKey('recipeTitle')).toBe(false);
    });

    it('pseudonymises id-shaped keys rather than redacting them', () => {
        expect(ID_KEYS.length).toBeGreaterThan(0);
        expect(isIdKey(ID_KEYS[0] as string)).toBe(true);
    });

    it('recognises a three-segment bearer token', () => {
        expect(looksLikeBearerToken('aaaaaaaa.bbbbbbbb.cccccccc')).toBe(true);
        expect(looksLikeBearerToken('not a token')).toBe(false);
    });

    it('carries a non-empty denylist — an empty one would redact nothing and pass every behaviour test', () => {
        expect(DENYLIST_KEYS.length).toBeGreaterThan(5);
    });
});

/**
 * `looksLikeBearerToken` is equivalent to the unanchored pattern it replaced, and no longer quadratic.
 *
 * ⛔ THE POSITIVE RATE IS ASSERTED FIRST. A parity test over inputs that never match the original agrees
 * vacuously and is indistinguishable from a passing one — my first fuzz of this predicate found 9 positives
 * in 500,000 random strings and proved nothing. The generator below builds segments of 6-10 token
 * characters, straddling the eight-character threshold, so roughly a fifth of its inputs match.
 */
describe('looksLikeBearerToken', () => {
    const original = /[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/;

    it('⛔ agrees with the unanchored pattern on input that actually contains tokens', () => {
        const alphabet = 'abZ019_-';
        const inputs: string[] = [];

        // Deterministic rather than random: a guard that fuzzes differently on each run reports a different
        // thing on each run, and a failure nobody can reproduce gets deleted rather than fixed.
        for (let seed = 0; seed < 4_000; seed += 1) {
            const parts: string[] = [];

            for (let part = 0; part < 3 + (seed % 3); part += 1) {
                const length = 6 + ((seed >> part) % 5);
                let segment = '';

                for (let index = 0; index < length; index += 1) {
                    segment += alphabet[(seed + index * 7 + part * 3) % alphabet.length];
                }

                // ⛔ THE JUNK GOES IN THE MIDDLE, not only at the end. A segment whose first eight
                // characters are tokens but which then contains `@` is exactly what distinguishes "this
                // whole segment is token characters" from "this segment STARTS with eight" — and a
                // generator that only appended junk never built it, so weakening the middle-segment rule
                // to a prefix test passed every case.
                parts.push(
                    seed % 3 === 0
                        ? `${segment.slice(0, 8)}@${segment.slice(8)}`
                        : seed % 7 === 0
                          ? `${segment.slice(1)}@`
                          : segment,
                );
            }

            inputs.push(parts.join('.'));
        }

        const positives = inputs.filter((input) => original.test(input));

        expect(positives.length).toBeGreaterThan(inputs.length / 10);

        for (const input of inputs) {
            expect(looksLikeBearerToken(input), input).toBe(original.test(input));
        }
    });

    it('⛔ is not quadratic on a long run of token characters', () => {
        const started = performance.now();

        looksLikeBearerToken(`${'a'.repeat(200_000)}@`);

        expect(performance.now() - started).toBeLessThan(1_000);
    });

    it('recognises a real JWT and refuses segments that are too short', () => {
        expect(looksLikeBearerToken('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K2')).toBe(true);
        expect(looksLikeBearerToken('a.b.c')).toBe(false);
        expect(looksLikeBearerToken('aaaaaaa.bbbbbbbb.cccccccc')).toBe(false);
        // ⛔ The MIDDLE segment must be token characters THROUGHOUT — it is delimited by dots on both
        // sides, so unlike the outer two it cannot match only a prefix.
        expect(looksLikeBearerToken('aaaaaaaa.bbbbbbbb@x.cccccccc')).toBe(false);
        expect(looksLikeBearerToken('aaaaaaaa.x@bbbbbbbb.cccccccc')).toBe(false);
    });
});
