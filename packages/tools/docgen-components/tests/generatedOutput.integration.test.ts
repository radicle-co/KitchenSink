/**
 * THE STALENESS GUARD for `docs/generated/components` and `docs/generated/design`.
 *
 * ## Why this exists at all
 *
 * The artifact this package produces is committed. Committed derived output rots the moment somebody edits a
 * component and does not regenerate — and a documentation site serving stale prop tables is WORSE than no
 * site, because a reader cannot tell. That rot is the reason this work was commissioned. So the derivation is
 * re-run here, in memory, over the real sources, and every byte is compared with what is on disk.
 *
 * ## Why it COMPARES rather than shelling out to the generator
 *
 * Running the real generator from a test would WRITE into the repository: a genuinely drifted checkout would
 * come out of `npm test` silently REPAIRED, so the gate would report success having erased its own evidence.
 * The same reasoning, and the same shape, as `packages/services/identity/contract/__tests__/contract.test.ts`
 * (`docs/CODING_STANDARDS.md` §15.2.5).
 *
 * ## Why it runs in the ORDINARY `test` script
 *
 * The package's `test` script runs the unit tier and then this one, exactly as `@commise/ui` does. A gate
 * behind a tier no CI job invokes is a gate that has never run. ⚠️ It is also declared `cache: false` in
 * `turbo.json`: turbo hashes only the task's OWN package files and cannot hash another workspace's sources
 * (measured and written up on `@kitchensink/infra-global#test`), so a cached PASS here would certify a
 * component surface it never read.
 */
import { readdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { COMPONENTS_OUT_DIR, COMPONENT_GROUPS, DESIGN_OUT_DIR, REPO_ROOT } from '../src/config.js';
import { discoverComponentFiles } from '../src/discovery.js';
import { buildArtifacts, readCommittedArtifacts, readGroup } from '../src/generate.js';
import { buildDesignTokens } from '../src/tokens.js';

const artifacts = buildArtifacts(REPO_ROOT);
const committed = await readCommittedArtifacts([...artifacts.keys()], REPO_ROOT);

/** Every file actually present under an output directory, repo-relative. */
async function filesUnder(directory: string): Promise<readonly string[]> {
    const found: string[] = [];

    const walk = async (current: string): Promise<void> => {
        for (const entry of await readdir(current, { withFileTypes: true })) {
            const path = join(current, entry.name);

            if (entry.isDirectory()) {
                await walk(path);
            } else {
                found.push(path.slice(REPO_ROOT.length + 1));
            }
        }
    };

    await walk(join(REPO_ROOT, directory));

    return found.sort();
}

describe('the committed component + design documentation', () => {
    it('is not empty, so a generator that silently produced nothing cannot pass', () => {
        expect(artifacts.size).toBeGreaterThan(0);

        for (const text of artifacts.values()) {
            expect(text.length).toBeGreaterThan(2);
        }
    });

    // THE gate. Every difference is named at once rather than stopping at the first, so a regeneration is one
    // round trip instead of one per file.
    it('matches what regenerating from the current sources produces, byte for byte', () => {
        const stale: string[] = [];

        for (const [path, expected] of artifacts) {
            if (committed.get(path) !== expected) {
                stale.push(path);
            }
        }

        expect(stale, 'run: npm run docs:generate --workspace=packages/tools/docgen-components').toEqual([]);
    });

    it('holds no file the generator does not produce, so a deleted component leaves no orphan behind', async () => {
        const onDisk = [...(await filesUnder(COMPONENTS_OUT_DIR)), ...(await filesUnder(DESIGN_OUT_DIR))].sort();

        expect(onDisk).toEqual([...artifacts.keys()].sort());
    });

    // Determinism is the precondition of the gate above: output that varies run to run makes it permanently
    // red for a reason unrelated to the code, and a guard people learn to ignore is worse than no guard.
    it('is deterministic — a second derivation over the same sources produces identical bytes', () => {
        const second = buildArtifacts(REPO_ROOT);

        expect([...second.keys()].sort()).toEqual([...artifacts.keys()].sort());

        for (const [path, text] of second) {
            expect(artifacts.get(path), path).toBe(text);
        }
    });
});

describe('the catalogue covers the component surface', () => {
    // The failure this catches is SILENT: a component shape the extractor stops recognising simply vanishes,
    // and every coverage number stays green because it is computed over what survived. Asserting per FILE is
    // what makes the loss visible — the fixtures cannot, because they only contain shapes already handled.
    it.each(COMPONENT_GROUPS)('documents at least one component from every .tsx file in $id', (group) => {
        const files = group.sourceRoots
            .flatMap((root) => discoverComponentFiles(resolve(REPO_ROOT, root)))
            .map((file) => file.slice(REPO_ROOT.length + 1));
        const documented = new Set(
            readGroup(group, REPO_ROOT).flatMap((entry) => entry.implementations.map((leaf) => leaf.sourcePath)),
        );

        expect(files.length).toBeGreaterThan(0);
        expect(files.filter((file) => !documented.has(file))).toEqual([]);
    });

    it('pairs the cross-platform leaves of a component into ONE entry with two implementations', () => {
        const designSystem = readGroup(COMPONENT_GROUPS[0]!, REPO_ROOT);
        const button = designSystem.find((entry) => entry.name === 'Button');

        expect(button?.platforms).toEqual(['web', 'native']);
        expect(button?.implementations.map((leaf) => leaf.sourcePath)).toEqual([
            'packages/apps/commise/ui/src/button/Button.tsx',
            'packages/apps/commise/ui/src/button/Button.native.tsx',
        ]);
        // Both leaves implement the SAME contract module, which is what makes them one component.
        expect(button?.propsDiverge).toBe(false);
        expect(button?.implementations.every((leaf) => leaf.props.some((prop) => prop.name === 'icon'))).toBe(true);
    });
});

describe('the design tokens are the values the app itself consumes', () => {
    // Crossing the package boundary is the point: a unit test with a fixture palette proves the serializer
    // works, not that the style guide shows the colours the product paints.
    it('serializes the real @commise/ui palette, with the docblock that governs it', () => {
        const tokens = buildDesignTokens(REPO_ROOT);
        const palette = tokens.groups.find((group) => group.id === 'palette');

        expect(palette?.source).toBe('packages/apps/commise/ui/src/tokens/colors.ts');
        expect(palette?.tokens.find((token) => token.name === 'seafoam')).toEqual({
            name: 'seafoam',
            kind: 'color',
            value: '#31807A',
        });
        expect(palette?.doc).toContain('WCAG');
    });

    it('expands the native projection into renderable scales rather than one opaque blob', () => {
        const ids = buildDesignTokens(REPO_ROOT).groups.map((group) => group.id);

        expect(ids).toContain('native.spacing');
        expect(ids).toContain('native.fontSize');
        expect(ids).toContain('gradient');
    });
});

describe('the output directories', () => {
    it('exist, so the docs site has something to read', async () => {
        for (const directory of [COMPONENTS_OUT_DIR, DESIGN_OUT_DIR]) {
            expect((await stat(join(REPO_ROOT, directory))).isDirectory()).toBe(true);
        }
    });
});
