/**
 * What the two ADR-0091 graph-completeness guards read: the workspaces as turbo sees them, each tracked source file,
 * the manifest that governs it, and the module names and file paths written in it.
 *
 * Both guards keep the changed-only selector honest. It walks turbo's package graph, so a workspace import nobody
 * declared and a test that reads another package's files without saying so are each a change it cannot see.
 *
 * @pattern Adapter over the turbo CLI and the TypeScript parser
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';

import ts from 'typescript';

import { repoRoot } from './serviceSources.js';

export interface Workspace {
    readonly name: string;
    readonly dir: string;
}

/**
 * Runs turbo and parses its JSON answer.
 *
 * @sideEffect Runs turbo.
 * @param args - turbo arguments, ending in a JSON output flag.
 * @returns The parsed answer.
 */
export function turboJson(args: readonly string[]): unknown {
    const stdout = execFileSync(join(repoRoot, 'node_modules', '.bin', 'turbo'), [...args], {
        cwd: repoRoot,
        encoding: 'utf8',
        maxBuffer: 256 * 1024 * 1024,
        env: { ...process.env, TURBO_TELEMETRY_DISABLED: '1' },
    });

    return JSON.parse(stdout.slice(stdout.indexOf('{')));
}

/**
 * The packages a turbo filter selects, by name.
 *
 * @sideEffect Runs turbo.
 * @param filters - `--filter` flags.
 * @returns The names.
 */
export function turboPackages(filters: readonly string[]): string[] {
    const parsed = turboJson(['ls', ...filters, '--output=json']) as { packages: { items: { name: string }[] } };

    return parsed.packages.items.map((item) => item.name);
}

/**
 * Every workspace, deepest folder first, so the first match for a path is its owner.
 *
 * @sideEffect Runs turbo.
 * @returns The workspaces.
 */
export function workspaces(): Workspace[] {
    const parsed = turboJson(['ls', '--output=json']) as { packages: { items: { name: string; path: string }[] } };

    return parsed.packages.items
        .map((item) => ({ name: item.name, dir: item.path }))
        .sort((a, b) => b.dir.length - a.dir.length);
}

/**
 * The workspace a repo-relative path sits in.
 *
 * @param path - Repo-relative path.
 * @param all - From {@link workspaces}.
 * @returns The owner, or undefined.
 */
export const ownerOf = (path: string, all: readonly Workspace[]): Workspace | undefined =>
    all.find((workspace) => path === workspace.dir || path.startsWith(`${workspace.dir}/`));

/**
 * Tracked files under `packages/`.
 *
 * @sideEffect Runs git.
 * @returns Repo-relative paths.
 */
export function trackedPackageFiles(): string[] {
    return execFileSync('git', ['ls-files', '-z', 'packages'], { cwd: repoRoot, encoding: 'utf8' })
        .split('\0')
        .filter((path) => path !== '');
}

/** JavaScript and TypeScript sources, declaration files excluded. */
export const isSource = (path: string): boolean => /\.[cm]?[jt]sx?$/u.test(path) && !path.endsWith('.d.ts');

/**
 * The names a manifest declares in any dependency field.
 *
 * @sideEffect Reads the file system.
 * @param dir - Repo-relative folder holding `package.json`.
 * @returns The declared names.
 */
export function declaredDependencies(dir: string): Set<string> {
    const manifest = JSON.parse(readFileSync(join(repoRoot, dir, 'package.json'), 'utf8')) as Record<
        string,
        Record<string, string> | undefined
    >;

    return new Set(
        ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'].flatMap((field) =>
            Object.keys(manifest[field] ?? {}),
        ),
    );
}

const MODULE_CALLS = /^(import|require|mock|doMock|unmock|importActual|requireActual|importMock)$/u;

const calleeName = (node: ts.Expression): string => {
    if (node.kind === ts.SyntaxKind.ImportKeyword) {
        return 'import';
    }

    if (ts.isIdentifier(node)) {
        return node.text;
    }

    return ts.isPropertyAccessExpression(node) ? node.name.text : '';
};

/**
 * Every module a source names: static and type-only imports and re-exports, `import('x')` types and calls,
 * `require`, and the module arguments of `vi.mock` and its siblings.
 *
 * @param fileName - Used for the parser's dialect (JSX or not).
 * @param text - The source.
 * @returns The specifiers, in order of appearance.
 */
export function moduleSpecifiers(fileName: string, text: string): string[] {
    const found: string[] = [];

    const visit = (node: ts.Node): void => {
        if (
            (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
            node.moduleSpecifier !== undefined &&
            ts.isStringLiteral(node.moduleSpecifier)
        ) {
            found.push(node.moduleSpecifier.text);
        } else if (
            ts.isImportTypeNode(node) &&
            ts.isLiteralTypeNode(node.argument) &&
            ts.isStringLiteral(node.argument.literal)
        ) {
            found.push(node.argument.literal.text);
        } else if (ts.isCallExpression(node) && MODULE_CALLS.test(calleeName(node.expression))) {
            const [first] = node.arguments;

            if (first !== undefined && ts.isStringLiteralLike(first)) {
                found.push(first.text);
            }
        }

        ts.forEachChild(node, visit);
    };

    visit(ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true));

    return found;
}

/** Calls that turn a string into a file-system path or read one. */
const PATH_CALLS =
    /^(join|resolve|normalize|readFileSync|readFile|readdirSync|readdir|existsSync|statSync|stat|lstatSync|globSync|glob|URL|execFileSync|execFile|spawnSync|spawn)$/u;

const literalText = (node: ts.Node): string | undefined =>
    ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) ? node.text : undefined;

/**
 * The file-system paths a source spells out: literal arguments of path-forming and file-reading calls (consecutive
 * literals joined, so `join(root, 'docs', 'x.md')` reads as `docs/x.md`), and literals assigned
 * to a variable (`const WEB = 'packages/apps/commise/web'`), which a later read builds on. A literal in a comment, an
 * import, or any other position is not a path read; the caller keeps only those that resolve to something that exists.
 *
 * @param fileName - Used for the parser's dialect.
 * @param text - The source.
 * @returns The paths as written: relative (`../x`) or from the repository root (`docs/x`).
 */
export function pathLiterals(fileName: string, text: string): string[] {
    const found: string[] = [];

    const visit = (node: ts.Node): void => {
        if ((ts.isCallExpression(node) || ts.isNewExpression(node)) && PATH_CALLS.test(calleeName(node.expression))) {
            const parts = (node.arguments ?? []).map(literalText);
            const tail = parts.slice(parts.findIndex((part) => part !== undefined));

            if (parts.some((part) => part !== undefined)) {
                const joined = tail.every((part) => part !== undefined) ? tail.join('/') : undefined;

                found.push(...parts.filter((part): part is string => part !== undefined));

                if (joined !== undefined && tail.length > 1) {
                    found.push(joined);
                }
            }
        } else if (ts.isVariableDeclaration(node)) {
            const value = node.initializer === undefined ? undefined : literalText(node.initializer);

            if (value !== undefined) {
                found.push(value);
            }
        }

        ts.forEachChild(node, visit);
    };

    visit(ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true));

    return found.map((path) => path.trim()).filter((path) => path !== '');
}

/** A path written from the repository root. */
const FROM_ROOT = /^(packages|docs|specs|\.github|scripts)\//u;

/**
 * Where a written path points, from the repository root, if it can be told: a relative path from the file's folder, or
 * a root-relative one. A path that is only `..` segments names a folder to join onto, not a file, and is skipped.
 *
 * @param file - The repo-relative file the path is written in.
 * @param written - The path as written.
 * @returns The repo-relative target, or undefined.
 */
export function pathTarget(file: string, written: string): string | undefined {
    if (written.startsWith('../')) {
        if (!/[A-Za-z]/u.test(written.replaceAll('../', ''))) {
            return undefined;
        }

        const target = normalize(join(dirname(file), written)).replace(/\/+$/u, '');

        return target.startsWith('..') ? undefined : target;
    }

    return FROM_ROOT.test(written) ? written.replace(/\/+$/u, '') : undefined;
}
