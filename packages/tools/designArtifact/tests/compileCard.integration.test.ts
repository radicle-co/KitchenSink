import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';

import { CONTENT_DIR, PACKAGE_ROOT, UI_SRC } from '../src/config.js';
import { compileCard } from '../src/cards/compileCard.js';
import { cardPage } from '../src/cards/cardPage.js';
import type { CardSpec } from '../src/cards/cardSpec.js';
import { isDesignArtifactError } from '../src/errors.js';

const BUTTON_CARD = join(CONTENT_DIR, 'designSystem/cards/Button/Button.card.tsx');
const DEFINE_CARD = join(PACKAGE_ROOT, 'src/cards/defineCard.ts');

interface Element {
    readonly type: unknown;
    readonly props: Record<string, unknown>;
}

/** Runs a card page in jsdom with recording stand-ins for the JSX runtime, ReactDOM and the two namespaces. */
function mount(html: string): Record<string, Element> {
    const roots: Record<string, Element> = {};

    new JSDOM(html, {
        runScripts: 'dangerously',
        beforeParse(window) {
            const w = window as unknown as Record<string, unknown>;
            const jsx = (type: unknown, props: Record<string, unknown>): Element => ({ type, props });

            w['__jsx'] = { jsx, jsxs: jsx, Fragment: 'Fragment' };
            w['Commise'] = { Button: 'WebButton', Native: { Button: 'NativeButton' } };
            w['ReactDOM'] = {
                flushSync: (work: () => void) => work(),
                createRoot: (el: { id: string }) => ({
                    render: (node: Element) => {
                        roots[el.id] = node;
                    },
                }),
            };
        },
    });

    return roots;
}

async function compileSource(source: string): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'card-'));
    const file = join(dir, 'Probe.card.tsx');

    await writeFile(file, source);

    return compileCard(file);
}

describe('compileCard over the real esbuild', () => {
    it('compiles the Button card into a script with no @commise code and no React of its own', async () => {
        const script = await compileCard(BUTTON_CARD);

        expect(script).toMatch(/^(?:"use strict";\n)?var __card = /u);
        expect(script).not.toContain('@commise');
        expect(script).not.toContain('react.production');
        expect(script).toContain('window.__jsx');
    });

    it('fails closed when a card imports runtime code from the design system', async () => {
        const failure = await compileSource(
            `import { BUTTON_VISUAL_HEIGHT } from '@commise/ui/button';\nexport default { n: BUTTON_VISUAL_HEIGHT };`,
        ).catch((error: unknown) => error);

        expect(isDesignArtifactError(failure)).toBe(true);
        expect(failure).toMatchObject({ code: 'bundle-failed', message: expect.stringContaining('"import type"') });
    });

    it.each([
        ['relative', (dir: string) => relative(dir, join(UI_SRC, 'button/Button.tsx'))],
        ['relative with .js', (dir: string) => relative(dir, join(UI_SRC, 'button/Button.js'))],
        ['absolute', () => join(UI_SRC, 'button/Button.tsx')],
    ])('fails closed when a card reaches into product code by a %s path', async (_kind, specifier) => {
        const dir = await mkdtemp(join(tmpdir(), 'card-'));
        const file = join(dir, 'Probe.card.tsx');
        const target = specifier(dir);

        await writeFile(file, `import { Button } from ${JSON.stringify(target)};\nexport default { Button };`);

        const failure = await compileCard(file).catch((error: unknown) => error);

        expect(failure).toMatchObject({
            code: 'bundle-failed',
            message: expect.stringContaining('second copy of product code'),
        });
    });

    it.each([
        // `Spinner` imports nothing relative, so only the alias itself can be what refuses it.
        ['the `#commise/` alias', '#commise/ui/src/spinner/Spinner'],
        ['an exact `@/` alias into the web app', '@/i18n/messages'],
    ])('fails closed when a card imports product code as a value through %s', async (_name, specifier) => {
        // Inside the package, so esbuild finds this package's tsconfig and its `paths`, which is where the aliases live.
        const parent = join(PACKAGE_ROOT, 'dist');

        await mkdir(parent, { recursive: true });

        const dir = await mkdtemp(join(parent, 'aliasProbe-'));
        const file = join(dir, 'Probe.card.tsx');

        try {
            await writeFile(file, `import * as probe from ${JSON.stringify(specifier)};\nexport default { probe };`);

            const failure = await compileCard(file).catch((error: unknown) => error);

            expect(failure).toMatchObject({
                code: 'bundle-failed',
                message: expect.stringContaining('second copy of product code'),
            });
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });

    it('still allows a relative import inside the package (the card helpers)', async () => {
        const script = await compileSource(
            `import { waitFor } from ${JSON.stringify(join(PACKAGE_ROOT, 'src/cards/waitFor.ts'))};\nexport default { waitFor };`,
        );

        expect(script).toContain('WaitTimeoutError');
    });

    it('erases type-only imports of the design system', async () => {
        const script = await compileSource(
            `import type { ButtonProps } from '@commise/ui/button';\nconst props: ButtonProps = { children: 'x', icon: 'plus', variant: 'primary' };\nexport default { props };`,
        );

        expect(script).not.toContain('@commise');
    });

    it('reports a syntax error as a bundle failure', async () => {
        const failure = await compileSource('export default {').catch((error: unknown) => error);

        expect(failure).toMatchObject({ code: 'bundle-failed' });
    });

    it('wraps the defineCard import into the card so the page needs nothing else', async () => {
        const script = await compileSource(
            `import { defineCard } from ${JSON.stringify(DEFINE_CARD)};\nexport default defineCard({ group: 'G', height: 1, platforms: 'both', uses: [], render: () => null });`,
        );

        expect(script).toContain('__card');
        expect(script).not.toContain('import ');
    });
});

describe('the Button card, compiled and run as a page', () => {
    it('shows the five states of the prototype card, with the web namespace in a row and Native in a column', async () => {
        const script = await compileCard(BUTTON_CARD);
        const { default: spec } = (await import(BUTTON_CARD)) as { default: CardSpec };
        const html = cardPage(spec, script);
        const roots = mount(html);
        const childrenOf = (root: Element): unknown[] =>
            (root.props['children'] as Element[]).map((child) => ({ type: child.type, ...child.props }));

        expect(html.startsWith('<!-- @dsCard group="Actions" height=340 -->')).toBe(true);
        expect(roots['w']?.props['className']).toBe('row');
        expect(roots['n']?.props['className']).toBe('col');

        const states = (type: string): unknown[] => [
            { type, variant: 'primary', size: 'lg', icon: 'plus', children: 'Save recipe' },
            { type, variant: 'secondary', icon: 'plus', children: 'Add to collection' },
            { type, variant: 'ghost', children: 'Skip for now' },
            { type, variant: 'destructive', icon: 'trash', children: 'Delete recipe' },
            { type, variant: 'primary', busy: true, icon: 'plus', children: 'Saving' },
        ];

        expect(childrenOf(roots['w'] as Element)).toEqual(states('WebButton'));
        expect(childrenOf(roots['n'] as Element)).toEqual(states('NativeButton'));
    });
});
