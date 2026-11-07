/**
 * The workspace packages of the monorepo, read from the manifests, and the closure of what some of them depend on.
 */
import { globSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import picomatch from 'picomatch';

export interface WorkspacePackage {
    readonly name: string;
    /** Repo-relative folder. */
    readonly dir: string;
    readonly exports: unknown;
    /** The names it depends on in any section of its manifest: dependencies, dev, peer and optional. */
    readonly deps: readonly string[];
}

const asRecord = (value: unknown): Readonly<Record<string, unknown>> =>
    typeof value === 'object' && value !== null ? (value as Readonly<Record<string, unknown>>) : {};

const DEP_SECTIONS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'] as const;

/**
 * Reads every workspace package the root manifest lists.
 *
 * @sideEffect Reads the root manifest and every workspace manifest.
 * @param root - The repository root.
 * @returns The packages, sorted by folder.
 */
export function readWorkspaces(root: string): readonly WorkspacePackage[] {
    const manifest = asRecord(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')));
    const patterns = Array.isArray(manifest['workspaces']) ? (manifest['workspaces'] as string[]) : [];
    const files = globSync(
        patterns.map((pattern) => `${pattern}/package.json`),
        { cwd: root, exclude: (name) => name === 'node_modules' },
    );

    return files.sort().flatMap((file) => {
        const parsed = asRecord(JSON.parse(readFileSync(join(root, file), 'utf8')));

        if (typeof parsed['name'] !== 'string') {
            return [];
        }

        return [
            {
                name: parsed['name'],
                dir: dirname(file),
                exports: parsed['exports'],
                deps: DEP_SECTIONS.flatMap((section) => Object.keys(asRecord(parsed[section]))),
            },
        ];
    });
}

/**
 * The folders of the packages the roots depend on, roots included.
 *
 * Derived from the manifests so it cannot rot: a package a service starts to use joins the set by being declared.
 *
 * @param packages - Every workspace package.
 * @param roots - Folder patterns (`packages/services/*`) or exact folders of the starting packages.
 * @returns Repo-relative folders.
 */
export function closureOf(packages: readonly WorkspacePackage[], roots: readonly string[]): ReadonlySet<string> {
    const isRoot = picomatch([...roots]);
    const byName = new Map(packages.map((entry) => [entry.name, entry] as const));
    const folders = new Set<string>();
    const queue = packages.filter((entry) => isRoot(entry.dir));

    for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
        if (folders.has(next.dir)) {
            continue;
        }

        folders.add(next.dir);

        for (const name of next.deps) {
            const dependency = byName.get(name);

            if (dependency !== undefined && !folders.has(dependency.dir)) {
                queue.push(dependency);
            }
        }
    }

    return folders;
}
