// @vitest-environment node
/**
 * A called workflow may only DOWNGRADE its caller's permissions — and violating that kills the whole run.
 *
 * ## The failure this was written after
 *
 * Giving the CDK packages their own registry config meant several jobs needed `packages: read`. Three of them
 * live in reusable workflows (`_ci.yml`, `_sandbox-preview.yml`), and a reusable workflow cannot ask for a
 * permission its caller did not grant. GitHub does not warn, ignore it, or fail that job: it rejects the
 * entire run with `startup_failure`, before a single step executes and with no log to read.
 *
 * ⛔ Two whole pipelines died that way — "CI — PR (sandbox)" and "Sandbox Deploy" — because
 * `_sandbox-preview.yml`'s `deploy-food` asked for `packages: read` while both of its callers
 * (`_ci.yml::deploy-preview` and `sandbox-deploy.yml::deploy-dispatch`) granted nothing. The YAML was valid,
 * every local gate was green, and the only symptom was a status word.
 *
 * ⚠️ A job-level `permissions:` block REPLACES the workflow-level default rather than merging with it, so the
 * effective grant for a calling job is its own block when it has one and the workflow default otherwise. That
 * distinction is the whole rule: adding `packages` to a job that previously inherited `contents: read` also
 * silently drops `contents` unless it is restated.
 *
 * DESIGN PATTERN: Specification module — a verdict over the workflow call graph.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

/** Permission strength, so `read` under a `write` grant is recognised as the downgrade it is. */
const RANK: Readonly<Record<string, number>> = { none: 0, read: 1, write: 2 };

type Permissions = Readonly<Record<string, string>> | string | undefined;

interface Job {
    readonly uses?: string;
    readonly permissions?: Permissions;
}

interface Workflow {
    readonly permissions?: Permissions;
    readonly jobs?: Readonly<Record<string, Job>>;
}

function workflows(): ReadonlyMap<string, Workflow> {
    const files = execFileSync('git', ['ls-files', '.github/workflows/*.yml'], { cwd: repoRoot, encoding: 'utf8' })
        .split('\n')
        .filter(Boolean);

    return new Map(
        files.map((file) => [
            path.posix.basename(file),
            parse(readFileSync(path.join(repoRoot, file), 'utf8')) as Workflow,
        ]),
    );
}

/** The scopes a permissions block grants, as name -> rank. `write-all`/`read-all` are blanket grants. */
function granted(permissions: Permissions): Readonly<Record<string, number>> | 'all' {
    if (permissions === undefined) {
        // No block at all: the token takes the repository default, which is configured outside these files.
        // Treated as unknown-but-permissive so this guard reports only what it can prove.
        return 'all';
    }

    if (typeof permissions === 'string') {
        return permissions === 'write-all' || permissions === 'read-all' ? 'all' : {};
    }

    return Object.fromEntries(Object.entries(permissions).map(([name, level]) => [name, RANK[level] ?? 0]));
}

describe('a reusable workflow never asks for more than its caller grants', () => {
    const all = workflows();

    it('is not vacuous: local reusable workflows are actually called', () => {
        const calls = [...all.values()].flatMap((wf) =>
            Object.values(wf.jobs ?? {}).filter((job) => (job.uses ?? '').startsWith('./.github/workflows/')),
        );

        expect(calls.length).toBeGreaterThan(2);
    });

    it('every call site grants what the called workflow requests', () => {
        const violations: string[] = [];

        for (const [file, wf] of all) {
            for (const [jobId, job] of Object.entries(wf.jobs ?? {})) {
                const target = job.uses ?? '';

                if (!target.startsWith('./.github/workflows/')) {
                    continue;
                }

                const callee = all.get(path.posix.basename(target));

                if (callee === undefined) {
                    violations.push(`${file}::${jobId} calls ${target}, which does not exist`);
                    continue;
                }

                // A job-level block REPLACES the workflow default; otherwise the default applies.
                const grant = granted(job.permissions ?? wf.permissions);

                if (grant === 'all') {
                    continue;
                }

                for (const [calleeJobId, calleeJob] of Object.entries(callee.jobs ?? {})) {
                    const asked = granted(calleeJob.permissions);

                    if (asked === 'all') {
                        continue;
                    }

                    for (const [scope, level] of Object.entries(asked)) {
                        if (level > (grant[scope] ?? 0)) {
                            violations.push(
                                `${file}::${jobId} grants ${scope}=${
                                    Object.entries(RANK).find(([, r]) => r === (grant[scope] ?? 0))?.[0] ?? 'none'
                                } but ${path.posix.basename(target)}::${calleeJobId} asks for ${scope}=${
                                    Object.entries(RANK).find(([, r]) => r === level)?.[0] ?? level
                                }`,
                            );
                        }
                    }
                }
            }
        }

        expect(
            violations,
            'GitHub rejects the ENTIRE run with `startup_failure` for this — no logs, no failed job, just a ' +
                'status word. Grant the permission on the CALLING job (restating `contents: read`, since a ' +
                'job-level block replaces the workflow default), or drop it from the callee.',
        ).toEqual([]);
    });
});
