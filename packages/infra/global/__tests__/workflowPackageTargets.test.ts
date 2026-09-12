// @vitest-environment node
/**
 * Every `--workspace=` and `--filter=` target named in a workflow must resolve to a package that EXISTS.
 *
 * ## The failure this was written after
 *
 * Moving CDK out of the npm workspace renamed or removed packages that eight workflows still addressed by
 * name. `npm run bundle:lambda --workspace=packages/infra/global` cannot work once that directory is not a
 * workspace member; `turbo run build --filter=@kitchensink/infra-alb` cannot work once that package has been
 * consolidated into the published `@radicle-co/infra-shared`. Nothing typechecks a workflow, so each of these
 * was found the slow way — by a red job, one workflow at a time, and only for the workflows that happened to
 * run. `prod-deploy.yml` carried two of them and does not run on a pull request at all.
 *
 * ⛔ The dangerous half is the ones that do NOT fail loudly. A `--filter=` naming nothing selects nothing, so
 * turbo builds nothing and exits 0: the step goes green having done no work, and the failure surfaces later
 * as a missing `dist/` in a completely different job — which is exactly how `infra-security` and then
 * `infra-alb` each cost a debugging cycle before this file existed.
 *
 * ## What counts as existing
 *
 * A workspace member (by package name or by its path), or a standalone package — a directory outside the
 * `workspaces` globs that carries its own manifest, which is what every CDK app now is. Both are real, and a
 * target that is neither is a typo or a leftover.
 *
 * ⚠️ Glob and selector forms are NOT names and are skipped deliberately: `!./packages/apps/**` selects by
 * directory, and `^...`/`...` are turbo's dependency selectors, which decorate a name rather than replace it
 * — so the decoration is stripped and the name underneath is still checked.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { minimatch } from 'minimatch';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

/** Repo-tracked files matching a set of basename patterns. */
function trackedFiles(patterns: readonly string[]): readonly string[] {
    return execFileSync('git', ['ls-files', ...patterns], { cwd: repoRoot, encoding: 'utf8' })
        .split('\n')
        .filter(Boolean);
}

/** Every package this repository contains: workspace members and standalone packages alike. */
function knownPackages(): { readonly names: ReadonlySet<string>; readonly dirs: ReadonlySet<string> } {
    const globs =
        (
            JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as {
                readonly workspaces?: readonly string[];
            }
        ).workspaces ?? [];
    const names = new Set<string>();
    const dirs = new Set<string>();

    for (const manifestPath of trackedFiles(['*/package.json'])) {
        const dir = path.posix.dirname(manifestPath);

        if (/(^|\/)(__tests__|__fixtures__|fixtures|node_modules)(\/|$)/u.test(dir)) {
            continue;
        }

        dirs.add(dir);
        const manifest = JSON.parse(readFileSync(path.join(repoRoot, manifestPath), 'utf8')) as {
            readonly name?: string;
        };

        if (manifest.name !== undefined) {
            names.add(manifest.name);
        }
    }

    // Not used to filter — recorded so a reader can see workspace membership is NOT the test. A standalone
    // package is just as real a target, provided the step addresses it by directory rather than by
    // `--workspace=`, which npm can only resolve for members.
    void globs;

    return { names, dirs };
}

/** A `--workspace=`/`--filter=` target, with turbo's selector decoration stripped. */
interface Target {
    readonly workflow: string;
    readonly flag: string;
    readonly value: string;
}

function targets(): readonly Target[] {
    const found: Target[] = [];

    for (const workflow of trackedFiles(['.github/workflows/*.yml'])) {
        const text = readFileSync(path.join(repoRoot, workflow), 'utf8');

        for (const line of text.split('\n')) {
            // A comment is prose, not an invocation — `#` anywhere before the flag disqualifies the line.
            if (/^\s*#/u.test(line)) {
                continue;
            }

            for (const match of line.matchAll(/--(workspace|filter)=(['"]?)([^\s'"]+)\2/gu)) {
                const flag = `--${match[1] ?? ''}`;
                let value = match[3] ?? '';

                // Strip turbo's dependency selectors and negation; what remains should be a name or a path.
                value = value
                    .replace(/^!/u, '')
                    .replace(/\^?\.\.\.$/u, '')
                    .replace(/^\.\.\.\^?/u, '');

                if (value === '' || value.includes('*') || value.includes('$')) {
                    continue;
                }

                found.push({ workflow, flag, value });
            }
        }
    }

    return found;
}

describe('workflow package targets', () => {
    it('finds targets at all — a guard over an empty set proves nothing', () => {
        const all = targets();

        expect(all.length).toBeGreaterThan(10);
        expect(all.some((target) => target.flag === '--workspace')).toBe(true);
        expect(all.some((target) => target.flag === '--filter')).toBe(true);
    });

    it('names only packages that exist', () => {
        const { names, dirs } = knownPackages();

        // Non-vacuity: the oracle must actually know this repository's packages.
        expect(names.has('@kitchensink/infra-global')).toBe(true);
        expect(dirs.has('packages/infra/global')).toBe(true);

        const dangling = targets()
            .filter((target) => !names.has(target.value) && !dirs.has(target.value.replace(/^\.\//u, '')))
            .map((target) => `${target.workflow}: ${target.flag}=${target.value}`);

        expect(
            dangling,
            'These workflow steps address a package that does not exist. `--workspace=` fails outright; ' +
                '`--filter=` is worse — it selects nothing, exits 0, and the missing build surfaces later in ' +
                'a different job. Point them at a real package, or at the directory with `working-directory:` ' +
                'when the package is outside the npm workspace.',
        ).toEqual([]);
    });

    it('npm `--workspace=` targets are workspace MEMBERS, since npm cannot resolve anything else', () => {
        const globs =
            (
                JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as {
                    readonly workspaces?: readonly string[];
                }
            ).workspaces ?? [];
        const { names, dirs } = knownPackages();
        const memberDirs = new Set([...dirs].filter((dir) => globs.some((glob) => minimatch(dir, glob))));
        const memberNames = new Set<string>();

        for (const dir of memberDirs) {
            const manifest = JSON.parse(readFileSync(path.join(repoRoot, dir, 'package.json'), 'utf8')) as {
                readonly name?: string;
            };

            if (manifest.name !== undefined) {
                memberNames.add(manifest.name);
            }
        }

        void names;

        const notMembers = targets()
            .filter((target) => target.flag === '--workspace')
            .filter((target) => {
                const asDir = target.value.replace(/^\.\//u, '');

                return !memberNames.has(target.value) && !memberDirs.has(asDir);
            })
            .map((target) => `${target.workflow}: --workspace=${target.value}`);

        expect(
            notMembers,
            'npm resolves `--workspace=` against the root `workspaces` globs only. These targets are outside ' +
                'them — a standalone package cannot be addressed this way, and the step fails with "No ' +
                'workspaces found". Use `working-directory:` and a bare script instead.',
        ).toEqual([]);
    });
});
