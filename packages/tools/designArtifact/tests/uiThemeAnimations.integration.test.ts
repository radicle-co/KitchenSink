import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { bundleComponents } from '../src/bundle/bundleComponents.js';
import { EsbuildBundler } from '../src/bundle/esbuildBundler.js';
import { animationsUsed, undefinedAnimations } from '../src/css/animationsUsed.js';
import { CONTENT_SOURCE_ROOTS } from '../src/css/artifactCssEntry.js';
import { discoverSurface } from '../src/surface/discoverSurface.js';

const SOURCE_FILE = /\.(?:[cm]?[jt]sx?|html)$/u;
const TEST_FILE = /\.test\.[jt]sx?$/u;

/** Every non-test source file under a directory. */
function sourcesUnder(directory: string): readonly string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const path = join(directory, entry.name);

        if (entry.isDirectory()) {
            return entry.name === '__tests__' || entry.name === 'node_modules' ? [] : sourcesUnder(path);
        }

        return SOURCE_FILE.test(entry.name) && !TEST_FILE.test(entry.name) ? [path] : [];
    });
}

describe('the @commise/ui theme against the real bundle', () => {
    it('defines every custom animate-* utility the bundled sources and the previews use', async () => {
        const themeCss = readFileSync(fileURLToPath(import.meta.resolve('@commise/ui/theme.css')), 'utf8');
        const { sourceRoots } = await bundleComponents(discoverSurface(), new EsbuildBundler());
        const used = [...sourceRoots, ...CONTENT_SOURCE_ROOTS]
            .flatMap((root) => sourcesUnder(root))
            .flatMap((file) => animationsUsed(readFileSync(file, 'utf8')));

        expect(used.length, 'the scan found the product’s own animations').toBeGreaterThan(0);
        expect(undefinedAnimations([...new Set(used)], themeCss)).toEqual([]);
    });
});
