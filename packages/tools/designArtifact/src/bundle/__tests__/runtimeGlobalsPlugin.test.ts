import { runInNewContext } from 'node:vm';

import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';

import { RUNTIME_GLOBALS, runtimeGlobalsPlugin } from '../runtimeGlobalsPlugin.js';

async function evaluate(entry: string, window: Record<string, unknown>): Promise<Record<string, unknown>> {
    const result = await build({
        stdin: { contents: entry, resolveDir: import.meta.dirname, loader: 'ts' },
        bundle: true,
        format: 'iife',
        globalName: 'M',
        write: false,
        plugins: [runtimeGlobalsPlugin()],
        logLevel: 'silent',
    });
    const context = { window, M: undefined as unknown };

    runInNewContext(`${result.outputFiles[0]?.text ?? ''}\nthis.M = M;`, context);

    return context.M as Record<string, unknown>;
}

describe('RUNTIME_GLOBALS', () => {
    it('maps exactly the React specifiers the sources import onto the globals the host and bridge define', () => {
        expect(RUNTIME_GLOBALS).toEqual({
            react: 'window.__react',
            'react-dom': 'window.ReactDOM',
            'react-dom/client': 'window.ReactDOM',
            'react/jsx-runtime': 'window.__jsx',
            'react/jsx-dev-runtime': 'window.__jsx',
        });
    });
});

describe('runtimeGlobalsPlugin', () => {
    const react = { id: 'react' };
    const jsx = { id: 'jsx' };
    const dom = { id: 'dom' };
    const window = { __react: react, __jsx: jsx, ReactDOM: dom };

    it.each([
        ['react', 'react', react],
        ['react/jsx-runtime', 'react/jsx-runtime', jsx],
        ['react/jsx-dev-runtime', 'react/jsx-dev-runtime', jsx],
        ['react-dom', 'react-dom', dom],
        ['react-dom/client', 'react-dom/client', dom],
    ])('resolves %s to the runtime global instead of bundling it', async (_label, specifier, expected) => {
        const exported = await evaluate(`import value from '${specifier}'; export { value };`, window);

        expect(exported['value']).toBe(expected);
    });

    it('leaves the React source out of the output', async () => {
        const result = await build({
            stdin: { contents: "import R from 'react'; export { R };", resolveDir: import.meta.dirname, loader: 'ts' },
            bundle: true,
            format: 'iife',
            write: false,
            plugins: [runtimeGlobalsPlugin()],
            logLevel: 'silent',
        });

        expect(result.outputFiles[0]?.text.length).toBeLessThan(2000);
    });

    it('does not claim a specifier that merely starts with react', async () => {
        await expect(evaluate("import x from 'react-native-not-a-thing'; export { x };", window)).rejects.toThrowError(
            /react-native-not-a-thing/u,
        );
    });
});
