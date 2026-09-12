import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * ⛔ THE `./core` ENTRY MUST REACH NO NODE BUILT-IN, TRANSITIVELY — that is the whole reason it exists.
 *
 * `@commise/web` and `@commise/mobile` import it into a browser bundle and a Hermes bundle. One
 * `node:crypto` anywhere in its import graph does not degrade them; it breaks the build, and it breaks it
 * in the app rather than here — which is exactly how those two apps came to keep their own copies of this
 * module for months, drifting into a prototype-pollution sink and a 38-second regex apiece.
 *
 * ⚠️ TRANSITIVE, not just the entry file. `core.ts` is clean today because it imports only `./denylist.js`;
 * the failure this guards is someone adding a third module that pulls a built-in two hops down, where no
 * reviewer of `core.ts` would see it.
 */
const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Every form a module specifier can arrive in: `from 'x'`, the side-effect `import 'x'`, and the dynamic
 * `import('x')`.
 *
 * ⛔ ONE PATTERN FOR BOTH DETECTORS, because they drifted. The graph walk was widened to follow side-effect
 * and dynamic imports while `bareSpecifiers` — the half that actually names the Node built-in — was left
 * reading `from '…'` only. A single `await import('node:crypto')` two hops down then passed a test whose
 * name is "imports NO Node built-in, anywhere in its transitive graph", which is the most likely way this
 * defect would really arrive: it is the canonical trick for keeping a module browser-safe while still
 * hashing on Node. `{@link NODE_BUILT_IN_FIXTURE}` keeps that mutation permanent.
 *
 * ⚠️ `import type { … } from 'node:crypto'` is erased at compile time and harmless, so a finding on one
 * would be a false positive. That is the cheap direction — it asks for an import that was already fine to
 * be spelled differently — and is left as a note rather than machinery.
 */
const SPECIFIER = /(?:from\s+|import[\s(])'([^']+)'/gu;

/** Every local module reachable from an entry, following relative `.js` specifiers back to their source. */
function importGraph(entry: string): readonly string[] {
    const seen = new Set<string>();
    const queue = [entry];

    while (queue.length > 0) {
        const file = queue.pop() as string;

        if (seen.has(file)) {
            continue;
        }

        seen.add(file);

        const text = readFileSync(file, 'utf8');

        for (const match of text.matchAll(SPECIFIER)) {
            const raw = match[1] ?? '';

            if (!raw.startsWith('.')) {
                continue;
            }

            queue.push(resolve(dirname(file), raw.replace(/\.js$/u, '.ts')));
        }
    }

    return [...seen].sort();
}

/** Every bare (non-relative) module specifier imported anywhere in a graph, in ANY import form. */
function bareSpecifiers(files: readonly string[]): readonly string[] {
    return [
        ...new Set(
            files.flatMap((file) =>
                [...readFileSync(file, 'utf8').matchAll(SPECIFIER)]
                    .map((match) => match[1] ?? '')
                    .filter((specifier) => !specifier.startsWith('.')),
            ),
        ),
    ].sort();
}

/** The negative control: a module reaching `node:crypto` in the form the walk used to miss. */
const NODE_BUILT_IN_FIXTURE = join(SRC, '__tests__/__fixtures__/dynamicNodeImport.ts');

describe('the ./core entry is browser- and Hermes-safe', () => {
    /**
     * ⛔ THE DETECTOR STILL DETECTS, asserted before anything is asserted ABOUT the tree. This exact shape —
     * one `await import('node:crypto')` two hops down — passed the test below, under its current name, until
     * `bareSpecifiers` was widened to match every import form rather than `from '…'` alone. Without this
     * case, the suite would go green again the next time one of the two detectors is hardened and the other
     * is not, which is how it happened the first time.
     */
    it('⛔ is not vacuous — a DYNAMIC bare import of a built-in is seen', () => {
        expect(bareSpecifiers([NODE_BUILT_IN_FIXTURE])).toContain('node:crypto');
        expect(importGraph(NODE_BUILT_IN_FIXTURE)).toContain(NODE_BUILT_IN_FIXTURE);
    });

    it('⛔ imports NO Node built-in, anywhere in its transitive graph', () => {
        const imported = bareSpecifiers(importGraph(join(SRC, 'core.ts')));

        expect(imported.filter((specifier) => specifier.startsWith('node:'))).toEqual([]);
    });

    /**
     * ⚠️ A bare dependency is not automatically unsafe, but it is a decision — this package declares no
     * runtime dependencies at all, so the honest invariant is that `./core` stays self-contained.
     */
    it('⛔ imports nothing outside this package', () => {
        expect(bareSpecifiers(importGraph(join(SRC, 'core.ts')))).toEqual([]);
    });

    it('is not vacuous — the graph really reaches more than the entry file', () => {
        // ⛔ Without this, a walker that stopped following imports would pass by inspecting one clean file.
        expect(importGraph(join(SRC, 'core.ts')).length).toBeGreaterThanOrEqual(2);
    });

    /**
     * ⚠️ The NODE entry is where `node:crypto` belongs, and asserting that keeps the split honest in both
     * directions: this test would also pass if someone "fixed" it by deleting the pseudonymizer.
     */
    it('⛔ the package entry DOES reach node:crypto — the split is real, not cosmetic', () => {
        expect(bareSpecifiers(importGraph(join(SRC, 'index.ts')))).toContain('node:crypto');
    });
});
