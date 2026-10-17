/**
 * Every workspace package the web app renders from must be scanned by Tailwind.
 *
 * Tailwind v4 scans only the app's own files; a workspace package's utility classes are generated only when
 * `packages/apps/commise/web/src/app/globals.css` names its source with `@source`. A package that ships `.tsx` and is
 * missing from that list builds and tests green (jsdom never paints a class) and ships unstyled in production. This is
 * how `@commise/features-core` gained components with no `@source` line.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../../../..');
const WEB = join(ROOT, 'packages/apps/commise/web');
const GLOBALS = join(WEB, 'src/app/globals.css');

/** The `@source` globs in a stylesheet, resolved to absolute directories (the part before the first `*`). */
export function sourcedDirectories(css: string, stylesheetDir: string): readonly string[] {
    return [...css.matchAll(/^@source\s+"([^"]+)";/gmu)].map((match) => {
        const glob = match[1] ?? '';
        const base = glob.split('*')[0] ?? glob;

        return resolve(stylesheetDir, base);
    });
}

/** Whether a directory tree holds a non-test `.tsx` file that sets a `className` (so it carries utility classes). */
function rendersClasses(dir: string): boolean {
    if (!existsSync(dir)) {
        return false;
    }

    return readdirSync(dir).some((entry) => {
        const path = join(dir, entry);

        if (statSync(path).isDirectory()) {
            return entry !== 'node_modules' && entry !== '__tests__' && rendersClasses(path);
        }

        return (
            entry.endsWith('.tsx') && !entry.endsWith('.test.tsx') && readFileSync(path, 'utf8').includes('className=')
        );
    });
}

/** The source directory of every `@commise/*` workspace dependency of the web app whose components carry classes. */
function renderingWorkspaceSources(): readonly string[] {
    const manifest = JSON.parse(readFileSync(join(WEB, 'package.json'), 'utf8')) as {
        dependencies?: Record<string, string>;
    };
    const names = Object.keys(manifest.dependencies ?? {}).filter((name) => name.startsWith('@commise/'));
    const packageDirs = ['packages/apps/commise/ui', 'packages/apps/commise/query', 'packages/apps/commise/i18n']
        .concat(
            readdirSync(join(ROOT, 'packages/apps/commise/features')).map((d) => `packages/apps/commise/features/${d}`),
        )
        .map((dir) => join(ROOT, dir))
        .filter((dir) => existsSync(join(dir, 'package.json')));

    return packageDirs
        .filter((dir) =>
            names.includes((JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { name: string }).name),
        )
        .map((dir) => join(dir, 'src'))
        .filter(rendersClasses);
}

describe('sourcedDirectories', () => {
    it.each([
        ['@source "../../../ui/src/**/*.{ts,tsx}";', '/r/web/src/app', ['/r/ui/src/']],
        ['  @source "x";', '/a', []],
        [
            '@source "../../../features/core/src/**/*.tsx";\n@source "../lib/*";',
            '/r/w/s/a',
            ['/r/features/core/src/', '/r/w/s/lib/'],
        ],
    ])('reads %j', (css, dir, expected) => {
        expect(sourcedDirectories(css, dir).map((d) => (d.endsWith('/') ? d : `${d}/`))).toEqual(expected);
    });
});

describe('the web stylesheet scans every workspace package it renders from', () => {
    it('names each rendering @commise dependency with an @source line', () => {
        const sourced = sourcedDirectories(readFileSync(GLOBALS, 'utf8'), join(WEB, 'src/app'));
        const missing = renderingWorkspaceSources().filter(
            (src) => !sourced.some((dir) => src === dir.replace(/\/$/u, '') || src.startsWith(dir)),
        );

        expect(missing.map((dir) => relative(ROOT, dir))).toEqual([]);
    });
});
