/**
 * The CI PARITY GUARD: the published artifact is a projection of the source tree. The checks live in the build
 * (`src/surface/surfaceChecks.ts`, run by `buildArtifact` before anything is written); this suite runs the SAME filter
 * over the real tree, with the real esbuild and the real discovery, so a red CI shows exactly what a build would
 * refuse. It owns no rule of its own.
 *
 * Circular imports are not checked here. esbuild's "No matching export" error is the real guard for an import of a
 * name a module does not export, and it fails the bundle step below.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { beforeAll, describe, expect, it } from 'vitest';

import { bundleComponents } from '../src/bundle/bundleComponents.js';
import { EsbuildBundler } from '../src/bundle/esbuildBundler.js';
import { BOARDS, BOARDS_DIR } from '../src/canvas/boards.js';
import { loadCardSpec } from '../src/cards/loadCardSpec.js';
import { UNCARDED } from '../src/cards/uncarded.js';
import { CARDS_DIR } from '../src/buildArtifact.js';
import { fsSourceFiles } from '../src/sources/fsSourceFiles.js';
import { discoverSurface } from '../src/surface/discoverSurface.js';
import type { Surface } from '../src/surface/discoverSurface.js';
import { surfaceProblems } from '../src/surface/surfaceChecks.js';
import type { BoardClaim, CardClaim } from '../src/surface/surfaceChecks.js';

const COMPONENT_NAME = /^[A-Z]/u;

describe('source parity', () => {
    let surface: Surface;
    let script: string;

    beforeAll(async () => {
        surface = discoverSurface();
        script = (await bundleComponents(surface, new EsbuildBundler())).script;
    });

    it('builds the web and native bundles with no errors', () => {
        expect(script).toMatch(/^\/\* @ds-bundle: /u);
        expect(script).toContain('window.Commise = Object.assign(');
    });

    it('lists in the bundle header exactly the components discovery found', () => {
        const header = /^\/\* @ds-bundle: (.*) \*\//u.exec(script)?.[1] ?? '{}';
        const named = (JSON.parse(header) as { components: { name: string }[] }).components.map(({ name }) => name);
        const discovered = surface.web.map(({ name }) => name).filter((name) => COMPONENT_NAME.test(name));

        expect([...named].sort()).toEqual([...discovered].sort());
    });

    it('has no card, board or UNCARDED entry that disagrees with the surface', async () => {
        const files = fsSourceFiles();
        const cards: CardClaim[] = [];
        const boards: BoardClaim[] = [];

        for (const name of await files.list(CARDS_DIR)) {
            const { uses, platforms } = await loadCardSpec(join(CARDS_DIR, name, `${name}.card.tsx`));

            cards.push({ name, uses, platforms });
        }

        for (const { file } of BOARDS) {
            boards.push({ file, html: await readFile(join(BOARDS_DIR, file), 'utf8') });
        }

        expect(surfaceProblems({ surface, cards, boards, uncarded: UNCARDED })).toEqual([]);
    });
});
