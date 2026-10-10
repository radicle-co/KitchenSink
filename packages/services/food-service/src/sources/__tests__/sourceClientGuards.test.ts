/**
 * Guards: every source request leaves through the rate-limited transport (ADR-0053 §3, "Guards").
 *
 * - `new UsdaApiClient(` appears in production code only in `sources/sourceRegistry.ts`, the one composition that
 *   hands the client the transport's `fetch`. A second construction site could hand it anything.
 * - No production file under `src/sources/**` calls a bare `fetch(`. A source client calls the `RateLimitedFetch` it
 *   was given; a bare `fetch` is a request no admission saw.
 *
 * The files are found by walking the file system, not the git index, so a new, untracked file is checked too. Each
 * matcher is pinned by a fixture table over the shapes it must and must not flag.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '../..');

/** Whether a path is test or fixture code rather than production code. Pure. */
function isTestPath(path: string): boolean {
    return /(^|\/)(__tests__|__fixtures__)\//u.test(path) || /\.test\.ts$/u.test(path);
}

/**
 * Every production `.ts` file under a directory, as paths relative to `src`.
 *
 * @param directory - The directory, absolute.
 * @returns The files.
 * @sideEffect Reads the file system.
 */
function productionFiles(directory: string): string[] {
    return readdirSync(directory, { recursive: true, encoding: 'utf8' })
        .map((entry) => relative(SRC, join(directory, entry)))
        .filter((path) => path.endsWith('.ts') && !path.endsWith('.d.ts') && !isTestPath(path));
}

/** Whether a line is a comment line, which names code without running it. Pure. */
function isCommentLine(line: string): boolean {
    return /^\s*(\/\/|\/\*|\*)/u.test(line);
}

/** The code lines of a text that construct a USDA client. Pure. */
function usdaClientConstructions(text: string): string[] {
    return text.split('\n').filter((line) => !isCommentLine(line) && /\bnew\s+UsdaApiClient\s*\(/u.test(line));
}

/** The code lines of a text that call a bare `fetch(`, not a method or a differently named function. Pure. */
function bareFetchCalls(text: string): string[] {
    return text.split('\n').filter((line) => !isCommentLine(line) && /(^|[^.\w$])fetch\s*\(/u.test(line));
}

describe('the matchers this guard relies on', () => {
    it.each([
        ['a construction', 'const client = new UsdaApiClient({ apiKey });', 1],
        ['a construction across a line break', '            new UsdaApiClient(', 1],
        ['a type reference', 'function f(client: UsdaApiClient): void {}', 0],
        ['an import', "import { UsdaApiClient } from '@kitchensink/usda-client';", 0],
        ['a comment naming it', ' * Never `new UsdaApiClient(` outside the registry.', 0],
    ])('usdaClientConstructions: %s', (_, text, count) => {
        expect(usdaClientConstructions(text)).toHaveLength(count);
    });

    it.each([
        ['a bare call', 'const response = await fetch(url);', 1],
        ['a call at the start of a line', 'fetch(url).then(read);', 1],
        ['a globalThis call', 'await globalThis.fetch(url);', 0],
        ['a call through a parameter of another name', 'await limitedFetch(url, init);', 0],
        ['a method that starts with fetch', 'await adapter.fetchByKey(key);', 0],
        ['a reference without a call', 'upstream: deps.upstream ?? globalThis.fetch,', 0],
        ['a comment naming it', '// a bare fetch( is a request no admission saw', 0],
    ])('bareFetchCalls: %s', (_, text, count) => {
        expect(bareFetchCalls(text)).toHaveLength(count);
    });
});

describe('every source request leaves through the transport (ADR-0053 §3)', () => {
    it('constructs a USDA client only in sources/sourceRegistry.ts', () => {
        const sites = productionFiles(SRC).filter(
            (path) => usdaClientConstructions(readFileSync(join(SRC, path), 'utf8')).length > 0,
        );

        expect(sites).toEqual(['sources/sourceRegistry.ts']);
    });

    it('calls no bare fetch under src/sources', () => {
        const files = productionFiles(join(SRC, 'sources'));

        expect(files).not.toEqual([]);

        const offenders = files.flatMap((path) =>
            bareFetchCalls(readFileSync(join(SRC, path), 'utf8')).map((line) => `${path}: ${line.trim()}`),
        );

        expect(offenders).toEqual([]);
    });
});
