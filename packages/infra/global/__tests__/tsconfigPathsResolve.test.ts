/**
 * Repo-wide guard: every `compilerOptions.paths` target in every workspace tsconfig points at something
 * that exists.
 *
 * ## The defect this exists to prevent
 *
 * `packages/apps/commise/mobile/tsconfig.json` mapped `@kitchensink/schema-identity` to
 * `../../schemas/identity/src/index.ts`. From `packages/apps/commise/mobile` that is
 * `packages/apps/schemas/identity` — a directory that has never existed; the package lives at
 * `packages/schemas/identity`. `tsc --noEmit` stayed green the whole time, because a `paths` entry that
 * resolves to nothing is not an error: TypeScript falls through to ordinary `node_modules` resolution and
 * finds the hoisted workspace link. The alias was silently a no-op. The vitest alias beside it had ALREADY
 * been corrected for the identical off-by-one, with a comment explaining the trap — the tsconfig copy was
 * missed, which is what a guard is for.
 *
 * The same mistake in a package WITHOUT the hoisted fallback is a hard break that surfaces as
 * `Cannot find module`, i.e. it reads as a missing dependency rather than a wrong path.
 *
 * ## What is asserted
 *
 * TypeScript's own config parser is asked for each project's effective `paths` and the base they resolve
 * against (`pathsBasePath`: the directory of the config that declared them, or `baseUrl` when set — the rule
 * the compiler applies, so nothing here re-derives it). Each target is resolved against that base and must
 * exist: exactly, for a literal mapping; as the directory before the `*`, for a wildcard mapping. An
 * `extends` chain is honoured by the parser, so inherited `paths` are checked too.
 *
 * ## Non-vacuity
 *
 * At least the two projects known to carry `paths` today (`@commise/web`, `@commise/mobile`) must be
 * discovered with mappings, so a discovery that iterates nothing cannot pass.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { presentFiles, repoRoot } from './serviceSources.js';

/** One `paths` mapping, with every target resolved to an absolute path. */
interface PathMapping {
    /** Repo-relative tsconfig. */
    readonly project: string;
    readonly pattern: string;
    /** The raw target and where it resolves to (for a wildcard target, the directory before the `*`). */
    readonly targets: readonly { readonly raw: string; readonly resolved: string }[];
}

/**
 * The base TypeScript resolves a project's `paths` against.
 *
 * `pathsBasePath` is set by the compiler's config parser to the directory of the config file that DECLARED
 * `paths` (so an inherited mapping resolves from where it was written, not from the inheriting project);
 * `baseUrl`, when present, overrides it. Neither is part of the public `CompilerOptions` typing, hence the
 * narrow structural read.
 *
 * @param options - Parsed compiler options.
 * @param projectDir - Absolute directory of the project, the last-resort base.
 * @returns An absolute base directory.
 */
function pathsBase(options: ts.CompilerOptions, projectDir: string): string {
    const internal = options as { readonly pathsBasePath?: string };

    return options.baseUrl ?? internal.pathsBasePath ?? projectDir;
}

/**
 * Every `paths` mapping declared by any workspace tsconfig, with targets resolved.
 *
 * @returns The mappings, in project then declaration order.
 * @sideEffect Shells out to git and reads every tsconfig under `packages/`.
 */
function discoverPathMappings(): readonly PathMapping[] {
    return presentFiles(['packages/*/tsconfig*.json']).flatMap((project) => {
        const absolute = path.join(repoRoot, project);
        const read = ts.readConfigFile(absolute, ts.sys.readFile);

        if (read.error !== undefined) {
            throw new Error(
                `unreadable tsconfig ${project}: ${ts.flattenDiagnosticMessageText(read.error.messageText, ' ')}`,
            );
        }

        const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, path.dirname(absolute), undefined, absolute);
        const paths = parsed.options.paths ?? {};
        const base = pathsBase(parsed.options, path.dirname(absolute));

        return Object.entries(paths).map(([pattern, targets]) => ({
            project,
            pattern,
            targets: targets.map((raw) => {
                const wildcardIndex = raw.indexOf('*');
                const prefix = wildcardIndex === -1 ? raw : raw.slice(0, wildcardIndex);

                return { raw, resolved: path.resolve(base, prefix) };
            }),
        }));
    });
}

const mappings = discoverPathMappings();

describe('tsconfig `paths` targets exist', () => {
    it('discovers the projects known to declare paths, with their mappings', () => {
        const projects = new Set(mappings.map((mapping) => mapping.project));

        expect([...projects]).toEqual(
            expect.arrayContaining([
                'packages/apps/commise/web/tsconfig.json',
                'packages/apps/commise/mobile/tsconfig.json',
            ]),
        );
        expect(mappings.length).toBeGreaterThanOrEqual(4);
    });

    it.each(mappings.map((mapping) => [`${mapping.project} → ${mapping.pattern}`, mapping] as const))(
        '%s resolves to something on disk',
        (_label, mapping) => {
            const missing = mapping.targets.filter((target) => !existsSync(target.resolved));

            expect(
                missing,
                `${mapping.project} maps '${mapping.pattern}' to a target that does not exist. TypeScript ` +
                    `silently falls back to node_modules resolution for a dead \`paths\` entry, so \`tsc\` will ` +
                    `not tell you:\n` +
                    missing
                        .map((target) => `  '${target.raw}' → ${path.relative(repoRoot, target.resolved)}`)
                        .join('\n'),
            ).toEqual([]);
        },
    );
});
