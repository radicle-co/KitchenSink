import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { runInNewContext } from 'node:vm';

import { build } from 'esbuild';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { nativeFirstPlugin } from '../nativeFirstPlugin.js';

let root = '';

function put(relative: string, contents: string): string {
    const path = join(root, relative);

    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, contents);

    return path;
}

async function run(entry: string): Promise<Record<string, unknown>> {
    const result = await build({
        entryPoints: [entry],
        bundle: true,
        format: 'iife',
        globalName: 'M',
        write: false,
        plugins: [nativeFirstPlugin({ root })],
        logLevel: 'silent',
    });
    const context = { M: undefined as unknown };

    runInNewContext(`${result.outputFiles[0]?.text ?? ''}\nthis.M = M;`, context);

    return context.M as Record<string, unknown>;
}

beforeAll(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'nativeFirst-')));
    put('ui/Chip.tsx', "export const Chip = 'web';");
    put('ui/Chip.native.tsx', "export const Chip = 'native';");
    put('ui/Plain.tsx', "export const Plain = 'only-web';");
    put('ui/Hook.ts', "export const hook = 'web';");
    put('ui/Hook.native.ts', "export const hook = 'native-ts';");
});

afterAll(() => {
    rmSync(root, { recursive: true, force: true });
});

describe('nativeFirstPlugin', () => {
    it('serves the .native.tsx sibling to an importer inside the tree', async () => {
        const entry = put('app/one.ts', "import { Chip } from '../ui/Chip'; export { Chip };");

        expect((await run(entry))['Chip']).toBe('native');
    });

    it('serves a .native.ts sibling too', async () => {
        const entry = put('app/two.ts', "import { hook } from '../ui/Hook'; export { hook };");

        expect((await run(entry))['hook']).toBe('native-ts');
    });

    it('keeps the plain file when no native sibling exists', async () => {
        const entry = put('app/three.ts', "import { Plain } from '../ui/Plain'; export { Plain };");

        expect((await run(entry))['Plain']).toBe('only-web');
    });

    it('does not rewrite imports made from inside node_modules', async () => {
        put('node_modules/lib/index.js', "import { Chip } from '../../ui/Chip'; export { Chip };");
        const entry = put('app/four.ts', "import { Chip } from '../node_modules/lib/index.js'; export { Chip };");

        expect((await run(entry))['Chip']).toBe('web');
    });

    it('lets an unresolvable import fail the build with esbuild’s own error', async () => {
        const entry = put('app/five.ts', "import { x } from './missing'; export { x };");

        await expect(run(entry)).rejects.toThrowError(/missing/u);
    });
});
