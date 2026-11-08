import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

/** Repo-relative path to file text. */
export type FixtureFiles = Readonly<Record<string, string>>;

export interface FixtureRepo {
    readonly root: string;
    readonly remove: () => void;
}

/**
 * Writes a throwaway repository to the temp directory.
 *
 * @sideEffect Creates files under `os.tmpdir()`; the caller calls `remove`.
 * @param files - Repo-relative path to file text.
 * @returns The root and a function that deletes it.
 */
export function makeFixtureRepo(files: FixtureFiles): FixtureRepo {
    const root = mkdtempSync(join(tmpdir(), 'e2ePlanFixture-'));

    for (const [path, text] of Object.entries(files)) {
        mkdirSync(dirname(join(root, path)), { recursive: true });
        writeFileSync(join(root, path), text);
    }

    return { root, remove: () => rmSync(root, { recursive: true, force: true }) };
}

const json = (value: unknown): string => JSON.stringify(value, null, 2);

/**
 * A monorepo shaped like the real one where it matters to module resolution: a package whose `exports` point at a
 * `dist` that was never built, one whose `exports` point at `src`, a tsconfig `@/` alias, and a platform leaf.
 */
export const resolutionFixture: FixtureFiles = {
    'package.json': json({ name: 'fx', private: true, workspaces: ['packages/*', 'apps/*'] }),
    'packages/ui/package.json': json({
        name: '@fx/ui',
        exports: {
            '.': { types: './dist/index.d.ts', import: './dist/index.js', default: './dist/index.js' },
            './tokens/*': { import: './dist/tokens/*.js', default: './dist/tokens/*.js' },
        },
    }),
    'packages/ui/src/index.ts': "export { colors } from './tokens/colors';\n",
    'packages/ui/src/tokens/colors.ts': 'export const colors = [];\n',
    'packages/core/package.json': json({
        name: '@fx/core',
        exports: { '.': './src/index.ts', './deep': './src/deep.ts' },
    }),
    'packages/core/src/index.ts': 'export const core = 1;\n',
    'packages/core/src/deep.ts': 'export const deep = 1;\n',
    'apps/web/package.json': json({ name: '@fx/web' }),
    'apps/web/tsconfig.json': json({ compilerOptions: { paths: { '@/*': ['./src/*'] } } }),
    'apps/web/src/app/page.tsx':
        "import { colors } from '@fx/ui';\nimport { colors as c2 } from '@fx/ui/tokens/colors';\n" +
        "import { core } from '@fx/core';\nimport { a } from '@/lib/a';\nexport default [colors, c2, core, a];\n",
    'apps/web/src/lib/a.ts': "import { deep } from '@fx/core/deep';\nexport const a = deep;\n",
    'apps/mobile/package.json': json({ name: '@fx/mobile' }),
    'apps/mobile/tsconfig.json': json({ compilerOptions: {} }),
    'apps/mobile/src/button.tsx': 'export const Button = 1;\n',
    'apps/mobile/src/button.native.tsx': 'export const Button = 2;\n',
    'apps/mobile/src/screen.tsx': "import { Button } from './button';\nexport const Screen = Button;\n",
    'apps/mobile/src/list.tsx':
        "import { Button } from './button.js';\nimport { util } from './util.js';\nexport const List = [Button, util];\n",
    'apps/mobile/src/util.ts': 'export const util = 1;\n',
};
