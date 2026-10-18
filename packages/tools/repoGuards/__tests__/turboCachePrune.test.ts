// @vitest-environment node
/**
 * Repo-wide guard: a job's saved turbo cache holds only the tasks THAT RUN used, and every job that saves one prunes it.
 *
 * ## The failure this pins
 *
 * The CI turbo cache entries were 0.7 to 1.3 GB each (about 6.6 GB of a 10 GB cap in all) although every task's declared
 * output is small: a full `build` of the workspace archives about 40 MB. The cause is accumulation, not size. Each job
 * restores the newest entry for its family (`restore-keys`), turbo adds the archives for the hashes that changed, and the
 * job saves the lot under a new key. Nothing ever removes the archive of a hash no later run asks for, so an entry carries
 * every task output of every earlier commit, and grows by a few tens of megabytes per push for as long as the family lives.
 *
 * ## What is asserted
 *
 * 1. `pruneTurboCache.sh` deletes the archives whose hash no run of this job used and keeps the ones it did; it never
 *    deletes when it cannot tell what was used (no summary, an unreadable one), since "nothing was used" would wipe the cache
 *    the next run needs; and it touches nothing that is not a turbo archive.
 * 2. Every job that stores `.turbo/cache` asks turbo for a run summary (`TURBO_RUN_SUMMARY`) and runs the prune AFTER its
 *    turbo commands, so it sees the hashes they used and the post-job save sees the pruned directory.
 *
 * DESIGN PATTERN: Specification module over a shell script and the parsed workflow.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

import { repoRoot } from './serviceSources.js';

const SCRIPT = path.join(repoRoot, '.github', 'scripts', 'pruneTurboCache.sh');

const USED = ['aaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbb'];
const STALE = ['cccccccccccccccc', 'dddddddddddddddd'];

interface Fixture {
    readonly cache: string;
    readonly runs: string;
}

/** A cache holding an archive and its metadata per hash, and a run directory with one summary naming `used`. */
function fixture(used: readonly string[] | 'no-summary' | 'garbage'): Fixture {
    const dir = mkdtempSync(path.join(tmpdir(), 'pruneTurbo-'));
    const cache = path.join(dir, 'cache');
    const runs = path.join(dir, 'runs');

    mkdirSync(cache);
    mkdirSync(runs);

    for (const hash of [...USED, ...STALE]) {
        writeFileSync(path.join(cache, `${hash}.tar.zst`), 'x');
        writeFileSync(path.join(cache, `${hash}-meta.json`), '{}');
    }

    writeFileSync(path.join(cache, 'README.txt'), 'not a turbo archive');

    if (used === 'garbage') {
        writeFileSync(path.join(runs, 'bad.json'), '{ not json');
    } else if (used !== 'no-summary') {
        writeFileSync(path.join(runs, 'one.json'), JSON.stringify({ tasks: used.map((hash) => ({ hash })) }));
    }

    return { cache, runs };
}

const prune = (f: Fixture) => spawnSync('bash', [SCRIPT, f.cache, f.runs], { encoding: 'utf8' });
const has = (f: Fixture, name: string): boolean => existsSync(path.join(f.cache, name));

describe('pruneTurboCache.sh', () => {
    it('deletes the archive and metadata of every hash no run used, and keeps the ones it did', () => {
        const f = fixture(USED);
        const result = prune(f);

        expect(result.status, result.stderr).toBe(0);

        for (const hash of USED) {
            expect(has(f, `${hash}.tar.zst`), hash).toBe(true);
            expect(has(f, `${hash}-meta.json`), hash).toBe(true);
        }

        for (const hash of STALE) {
            expect(has(f, `${hash}.tar.zst`), hash).toBe(false);
            expect(has(f, `${hash}-meta.json`), hash).toBe(false);
        }
    });

    it('unions every summary in the directory, so a job that ran turbo twice keeps both runs', () => {
        const f = fixture([USED[0] as string]);

        writeFileSync(path.join(f.runs, 'two.json'), JSON.stringify({ tasks: [{ hash: USED[1] }] }));
        prune(f);

        expect(has(f, `${USED[1]}.tar.zst`)).toBe(true);
        expect(has(f, `${STALE[0]}.tar.zst`)).toBe(false);
    });

    it('touches nothing that is not a turbo archive', () => {
        const f = fixture(USED);

        prune(f);

        expect(has(f, 'README.txt')).toBe(true);
    });

    it.each(['no-summary', 'garbage'] as const)(
        'deletes NOTHING when it cannot tell what was used (%s): an unknown is not "nothing used"',
        (kind) => {
            const f = fixture(kind);
            const result = prune(f);

            expect(result.status).toBe(0);

            for (const hash of [...USED, ...STALE]) {
                expect(has(f, `${hash}.tar.zst`), hash).toBe(true);
            }
        },
    );

    it('deletes nothing when the summaries name no task at all', () => {
        const f = fixture([]);

        prune(f);

        expect(has(f, `${STALE[0]}.tar.zst`)).toBe(true);
    });

    it('is a no-op on a cache directory that does not exist yet', () => {
        const f = fixture(USED);
        const result = spawnSync('bash', [SCRIPT, path.join(f.cache, 'absent'), f.runs], { encoding: 'utf8' });

        expect(result.status).toBe(0);
    });
});

interface Step {
    readonly uses?: string;
    readonly run?: string;
    readonly with?: Record<string, unknown>;
}

interface Job {
    readonly env?: Record<string, unknown>;
    readonly steps?: readonly Step[];
}

describe('every job that stores the turbo cache prunes it', () => {
    const jobs = Object.entries(
        (parse(readFileSync(path.join(repoRoot, '.github/workflows/_ci.yml'), 'utf8')) as { jobs: Record<string, Job> })
            .jobs,
    ).filter(([, job]) => (job.steps ?? []).some((step) => step.with?.['path'] === '.turbo/cache'));

    it('finds the turbo-caching jobs, so nothing below is vacuous', () => {
        expect(jobs.length).toBeGreaterThanOrEqual(7);
    });

    it.each(jobs.map(([name, job]) => [name, job] as const))('%s asks for a run summary', (_name, job) => {
        expect(String(job.env?.['TURBO_RUN_SUMMARY'])).toBe('true');
    });

    it.each(jobs.map(([name, job]) => [name, job] as const))('%s prunes after its last turbo command', (name, job) => {
        const steps = job.steps ?? [];
        const lastTurbo = steps
            .map((step) => /\b(turbo run|npm run|npm test)\b/u.test(step.run ?? ''))
            .lastIndexOf(true);
        const prune = steps.findIndex((step) => /pruneTurboCache\.sh/u.test(step.run ?? ''));

        expect(lastTurbo, `${name} runs no turbo command`).toBeGreaterThan(-1);
        expect(prune, `${name} never prunes`).toBeGreaterThan(lastTurbo);
    });
});
