/**
 * The screens of the web app, derived from Next's file-system routes, and the matching of a visited path to one.
 *
 * ## Why this is not Next's own matcher
 *
 * Next's route matcher is a private module of the `next` package; depending on it would put a 100 MB framework
 * under a planning tool for the sake of four segment kinds, and its path would change with a release. This file
 * implements only the segment kinds a path can take: static, `[x]`, `[...x]` and `[[...x]]`, with Next's
 * precedence (static over dynamic over catch-all). Anything it cannot map (`@slot`, intercepting routes, `route.ts`
 * handlers) THROWS, and the caller widens to the full suite: an unmapped route is never a silent gap.
 */
import type { Terminals } from './reachability.js';

const LOCALE_DIR = '[locale]';
const BOUNDARIES = new Set(['layout', 'loading', 'error', 'not-found', 'template', 'default']);
const TEST_FILE = /\.test\.[cm]?[jt]sx?$/u;

export interface WebRegistry {
    /** Route names such as `/recipes/[id]`, without the locale. */
    readonly screens: readonly string[];
    readonly terminals: Pick<Terminals, 'screenEntries' | 'roots'>;
}

export interface WebRegistryInput {
    /** The repo-relative app directory, e.g. `packages/apps/commise/web/src/app`. */
    readonly appDir: string;
    /** Repo-relative files outside the app directory that every screen runs through: middleware, instrumentation. */
    readonly extraRoots: readonly string[];
    /** Repo-relative files under `appDir`. */
    readonly files: readonly string[];
}

const stemOf = (name: string): string => name.replace(/\.[^.]+$/u, '');

function unmappable(file: string, why: string): never {
    throw new Error(`cannot map ${file} to one screen: ${why}`);
}

/** The route name of a directory below the locale folder, with route groups dropped. */
function routeName(segments: readonly string[], file: string): string {
    const parts = segments.filter((segment) => {
        if (segment.startsWith('@')) {
            return unmappable(file, 'it is a parallel route slot');
        }

        if (segment.startsWith('(.') || segment.startsWith('(..') || segment.startsWith('(...')) {
            return unmappable(file, 'it is an intercepting route');
        }

        return !(segment.startsWith('(') && segment.endsWith(')'));
    });

    return `/${parts.join('/')}`;
}

/**
 * Derives the screens and where a change to a file reaches them.
 *
 * @param input - The app directory and its files.
 * @returns The screens, the files that are part of one, and the files that are part of all.
 * @throws When a file cannot be mapped to a screen, so the caller can run everything instead.
 */
export function webRegistry(input: WebRegistryInput): WebRegistry {
    const prefix = `${input.appDir}/`;
    const roots = new Set<string>(input.extraRoots);
    const pages: { readonly file: string; readonly dir: readonly string[] }[] = [];
    const boundaries: { readonly file: string; readonly dir: readonly string[] }[] = [];

    for (const file of input.files) {
        const segments = file.slice(prefix.length).split('/');
        const name = segments[segments.length - 1] ?? '';

        if (segments.includes('__tests__') || TEST_FILE.test(name)) {
            continue;
        }

        if (segments[0] !== LOCALE_DIR) {
            roots.add(file);

            continue;
        }

        const dir = segments.slice(1, -1);
        const stem = stemOf(name);

        if (stem === 'route') {
            unmappable(file, 'it is a route handler');
        }

        if (stem === 'page') {
            pages.push({ file, dir });
        } else if (BOUNDARIES.has(stem)) {
            boundaries.push({ file, dir });
        }
    }

    const screenEntries = new Map<string, string[]>();
    const nameOf = new Map(pages.map((page) => [page.file, routeName(page.dir, page.file)]));
    const below = (parent: readonly string[], child: readonly string[]): boolean =>
        parent.every((segment, index) => child[index] === segment);

    for (const page of pages) {
        screenEntries.set(page.file, [nameOf.get(page.file) ?? '']);
    }

    for (const boundary of boundaries) {
        const owned = pages.filter((page) => below(boundary.dir, page.dir));

        // The locale folder's own layout/error/loading wrap everything: they are roots, not part of one screen.
        if (boundary.dir.length === 0 || owned.length === 0) {
            roots.add(boundary.file);
        } else {
            screenEntries.set(
                boundary.file,
                owned.map((page) => nameOf.get(page.file) ?? ''),
            );
        }
    }

    return { screens: [...new Set(nameOf.values())].sort(), terminals: { screenEntries, roots } };
}

type Segment =
    | { readonly kind: 'static'; readonly text: string }
    | { readonly kind: 'dynamic' }
    | { readonly kind: 'catchAll' }
    | { readonly kind: 'optionalCatchAll' };

const parseSegment = (segment: string): Segment => {
    if (segment.startsWith('[[...') && segment.endsWith(']]')) {
        return { kind: 'optionalCatchAll' };
    }

    if (segment.startsWith('[...') && segment.endsWith(']')) {
        return { kind: 'catchAll' };
    }

    return segment.startsWith('[') && segment.endsWith(']') ? { kind: 'dynamic' } : { kind: 'static', text: segment };
};

/** Higher is more specific, as in Next: static over dynamic over catch-all over optional catch-all. */
const RANK = { static: 3, dynamic: 2, catchAll: 1, optionalCatchAll: 0 } as const;

/** The per-segment ranks of a match, or undefined when the pattern does not serve the path. */
function rankMatch(pattern: readonly Segment[], path: readonly string[]): readonly number[] | undefined {
    const ranks: number[] = [];

    for (const [index, segment] of pattern.entries()) {
        const part = path[index];

        if (segment.kind === 'catchAll' || segment.kind === 'optionalCatchAll') {
            const needed = segment.kind === 'catchAll' ? 1 : 0;

            return path.length - index >= needed && index === pattern.length - 1
                ? [...ranks, RANK[segment.kind]]
                : undefined;
        }

        if (part === undefined || (segment.kind === 'static' && segment.text !== part)) {
            return undefined;
        }

        ranks.push(RANK[segment.kind]);
    }

    return path.length === pattern.length ? ranks : undefined;
}

const moreSpecific = (a: readonly number[], b: readonly number[]): boolean => {
    for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
        if (a[index] !== b[index]) {
            return (a[index] ?? 0) > (b[index] ?? 0);
        }
    }

    return a.length > b.length;
};

/**
 * Finds the screen that serves a path.
 *
 * @param screens - Route names such as `/recipes/[id]`.
 * @param path - A visited path without the locale; a query or fragment is ignored.
 * @returns The most specific screen, or undefined when none serves the path.
 */
export function matchRoute(screens: readonly string[], path: string): string | undefined {
    const parts = (path.split(/[?#]/u)[0] ?? '').split('/').filter((part) => part !== '');
    let best: { readonly screen: string; readonly ranks: readonly number[] } | undefined;

    for (const screen of screens) {
        const ranks = rankMatch(
            screen
                .split('/')
                .filter((part) => part !== '')
                .map(parseSegment),
            parts,
        );

        if (ranks !== undefined && (best === undefined || moreSpecific(ranks, best.ranks))) {
            best = { screen, ranks };
        }
    }

    return best?.screen;
}
