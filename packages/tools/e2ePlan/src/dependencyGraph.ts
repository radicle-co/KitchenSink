/**
 * The import graph of one platform's app, built by dependency-cruiser.
 *
 * ## What this module must get right, because everything else trusts it
 *
 * The selector walks this graph BACKWARDS from a changed file to the screens that import it. An import the graph
 * cannot see is an edge that is missing, and a missing edge is a screen that does not run after a change that
 * breaks it. So the graph reports its own blind spots as `problems`, and the caller widens to the full suite
 * whenever there is one. Three things make an edge invisible by default, and each is handled here:
 *
 * 1. dependency-cruiser ignores a package's `exports` map unless told otherwise (`exportsFields`), and falls back
 *    to `main`, which the workspace packages mostly do not have.
 * 2. `@commise/ui` publishes `./dist/*` that is only built on demand, so `exports` leads to a file that does not
 *    exist in a clean checkout. Each such export is mapped to its `src` twin.
 * 3. tsconfig `paths` (`@/*`) are not applied unless the resolver is handed them. They become aliases.
 *
 * Dynamic `import(variable)` and `require(variable)` stay invisible. No resolver can see them.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { cruise, type ICruiseResult } from 'dependency-cruiser';
import extractTsConfig from 'dependency-cruiser/config-utl/extract-ts-config';
import { glob } from 'tinyglobby';

/** What to cruise and how its imports resolve. All paths are relative to the repo root. */
export interface GraphProfile {
    readonly name: string;
    /** Files and directories the cruise starts from. */
    readonly cruise: readonly string[];
    /** The tsconfig whose `paths` the app resolves with. */
    readonly tsConfig: string;
    /** File extensions in the order a bare import tries them: `.native.tsx` before `.tsx` on mobile. */
    readonly extensions: readonly string[];
}

export interface ImportGraph {
    /** Whether the cruise reached this file. */
    readonly has: (file: string) => boolean;
    /** Every file the cruise holds, repo-relative and sorted. */
    readonly files: readonly string[];
    /** The files that import `file`, repo-relative and sorted. */
    readonly importersOf: (file: string) => readonly string[];
    /** The files `file` imports, repo-relative and sorted. */
    readonly importsOf: (file: string) => readonly string[];
    /** Every import of the repo's own code that the graph could not follow. Not empty means the graph is incomplete. */
    readonly problems: readonly string[];
}

interface Alias {
    readonly name: string;
    readonly alias: string;
    readonly onlyModule?: true;
}

interface Workspace {
    readonly name: string;
    readonly dir: string;
    readonly exports: unknown;
}

const asRecord = (value: unknown): Readonly<Record<string, unknown>> =>
    typeof value === 'object' && value !== null ? (value as Readonly<Record<string, unknown>>) : {};

/** The target an `exports` entry reaches for an `import`: a string, or the first of `import`/`default` that is one. */
function exportTarget(entry: unknown): string | undefined {
    if (typeof entry === 'string') {
        return entry;
    }

    const record = asRecord(entry);
    const picked = record['import'] ?? record['default'];

    return typeof picked === 'string' ? picked : undefined;
}

/** Whether `exports` names this package's source of truth in `dist`, which a clean checkout has not built. */
const isDistTarget = (target: string): boolean => target.startsWith('./dist/');

/** The `src` twin of a `./dist/...` target, if one exists on disk. */
function srcTwin(dir: string, target: string): string | undefined {
    const base = target.replace('./dist/', './src/').replace(/(\.d)?\.[cm]?js$/u, '');

    return ['.ts', '.tsx', '/index.ts', '/index.tsx']
        .map((suffix) => join(dir, `${base}${suffix}`))
        .find((candidate) => existsSync(candidate));
}

async function readWorkspaces(root: string): Promise<readonly Workspace[]> {
    const manifest = asRecord(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')));
    const patterns = Array.isArray(manifest['workspaces']) ? (manifest['workspaces'] as string[]) : [];
    const files = await glob(
        patterns.map((pattern) => `${pattern}/package.json`),
        { cwd: root, ignore: ['**/node_modules/**'] },
    );

    return files.sort().flatMap((file) => {
        const parsed = asRecord(JSON.parse(readFileSync(join(root, file), 'utf8')));

        return typeof parsed['name'] === 'string'
            ? [{ name: parsed['name'], dir: join(root, dirname(file)), exports: parsed['exports'] }]
            : [];
    });
}

/** The file or directory a workspace export target names: its `src` twin when it points into an unbuilt `dist`. */
function sourceOf(dir: string, target: string, isDirectory: boolean): string | undefined {
    if (isDistTarget(target)) {
        const twin = isDirectory ? join(dir, target.replace('./dist/', './src/')) : srcTwin(dir, target);

        return twin !== undefined && existsSync(twin) ? twin : undefined;
    }

    const own = join(dir, target);

    return existsSync(own) ? own : undefined;
}

/**
 * The aliases that send each export of a workspace package to the file it names, and the exports that name nothing.
 *
 * Every export is aliased, not only the `dist` ones: a worktree that was never installed has no `node_modules`
 * symlink to a sibling package, and the graph must not depend on one.
 *
 * @param workspace - One workspace package.
 * @returns The aliases. An export with no file behind it gets none, and an import of it then fails to resolve, which
 * `buildImportGraph` reports as a problem: nothing is lost by saying nothing here.
 */
export function workspaceAliases(workspace: Workspace): readonly Alias[] {
    const entries = Object.entries(asRecord(workspace.exports));

    if (entries.length === 0) {
        return [{ name: workspace.name, alias: workspace.dir }];
    }

    const aliases: Alias[] = [];

    for (const [key, entry] of entries) {
        const target = exportTarget(entry);
        const name = `${workspace.name}${key.slice(1)}`;

        if (target === undefined) {
            continue;
        }

        if (key.includes('*')) {
            const dir = sourceOf(workspace.dir, target.slice(0, target.indexOf('*')), true);

            if (dir !== undefined) {
                aliases.push({
                    name: name.slice(0, name.indexOf('*')).replace(/\/$/u, ''),
                    alias: dir.replace(/\/$/u, ''),
                });
            }

            continue;
        }

        const file = sourceOf(workspace.dir, target, false);

        if (file !== undefined) {
            aliases.push({ name, alias: file, onlyModule: true });
        }
    }

    return aliases;
}

/** `paths` of a tsconfig as resolver aliases. */
function pathAliases(
    root: string,
    tsConfig: string,
): { readonly aliases: readonly Alias[]; readonly keys: readonly string[] } {
    const file = join(root, tsConfig);

    if (!existsSync(file)) {
        return { aliases: [], keys: [] };
    }

    const options = extractTsConfig(file).options;
    const base = typeof options.pathsBasePath === 'string' ? options.pathsBasePath : dirname(file);
    const paths = options.paths ?? {};
    const aliases = Object.entries(paths).flatMap(([key, targets]): Alias[] => {
        const target = targets[0];

        if (target === undefined) {
            return [];
        }

        return key.endsWith('/*')
            ? [{ name: key.slice(0, -2), alias: resolve(base, target.replace(/\/\*$/u, '')) }]
            : [{ name: key, alias: resolve(base, target), onlyModule: true }];
    });

    return { aliases, keys: Object.keys(paths).map((key) => key.replace(/\/?\*$/u, '')) };
}

const scopeOf = (name: string): string | undefined => (name.startsWith('@') ? name.split('/')[0] : undefined);

/** A test file is not part of what ships, and the graph would only grow by it. */
const TEST_FILES = ['(^|/)__tests__/', '\\.test\\.[cm]?[jt]sx?$'];

/**
 * Builds the import graph of one platform.
 *
 * @sideEffect Reads the repository and runs dependency-cruiser over it.
 * @param repo - The repository root.
 * @param profile - What to cruise.
 * @returns The graph.
 */
export async function buildImportGraph(repo: string, profile: GraphProfile): Promise<ImportGraph> {
    const root = resolve(repo);
    const workspaces = await readWorkspaces(root);
    const fromExports = workspaces.map(workspaceAliases);
    const fromPaths = pathAliases(root, profile.tsConfig);
    const scopes = new Set(workspaces.flatMap((workspace) => scopeOf(workspace.name) ?? []));
    const names = new Set(workspaces.map((workspace) => workspace.name));

    const result = await cruise(
        [...profile.cruise],
        {
            baseDir: root,
            doNotFollow: { path: 'node_modules' },
            exclude: { path: ['node_modules', ...TEST_FILES] },
            tsPreCompilationDeps: true,
        },
        {
            alias: [...fromPaths.aliases, ...fromExports.flat()],
            exportsFields: ['exports'],
            conditionNames: ['import', 'default'],
            extensions: [...profile.extensions],
        },
    );

    if (typeof result.output === 'string') {
        throw new Error('error: dependency-cruiser returned text, not a result');
    }

    const modules = (result.output as ICruiseResult).modules.filter(
        (module) => !module.source.includes('node_modules'),
    );
    const importers = new Map<string, Set<string>>();
    const imports = new Map<string, Set<string>>();
    const problems: string[] = [];

    const isOwn = (specifier: string): boolean =>
        specifier.startsWith('.') ||
        fromPaths.keys.some((key) => specifier === key || specifier.startsWith(`${key}/`)) ||
        names.has(specifier) ||
        [...names].some((name) => specifier.startsWith(`${name}/`)) ||
        (scopeOf(specifier) !== undefined && scopes.has(scopeOf(specifier) ?? ''));

    for (const module of modules) {
        for (const dependency of module.dependencies) {
            if (!dependency.couldNotResolve && !dependency.coreModule) {
                const set = importers.get(dependency.resolved) ?? new Set<string>();

                set.add(module.source);
                importers.set(dependency.resolved, set);
                imports.set(module.source, (imports.get(module.source) ?? new Set<string>()).add(dependency.resolved));
            }

            const builtOnDemand = /(^|\/)dist\//u.test(dependency.resolved) || dependency.resolved.endsWith('.d.ts');

            if (isOwn(dependency.module) && (dependency.couldNotResolve || builtOnDemand)) {
                problems.push(`${module.source} imports ${dependency.module}, which the graph cannot follow`);
            }
        }
    }

    const files = new Set(modules.map((module) => module.source));

    return {
        has: (file) => files.has(file),
        files: [...files].sort(),
        importersOf: (file) => [...(importers.get(file) ?? [])].sort(),
        importsOf: (file) => [...(imports.get(file) ?? [])].sort(),
        problems: [...new Set(problems)].sort(),
    };
}
