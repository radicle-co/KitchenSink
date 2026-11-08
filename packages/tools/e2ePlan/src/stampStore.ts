/**
 * Where the green stamps live: one JSON file per repository, branch and platform, outside the working tree.
 *
 * @pattern Repository — hides the file layout, the atomic write and the corrupt-file rule from the policy in `greenStamp`
 *
 * Two runs can finish together. A write replaces only the stamp its run started from; otherwise it reports a
 * conflict and the stamp stays. There is no lock: every stamp that is written is green evidence for its own tree on its
 * own, so the worst a lost race does is leave an older tree, and an older tree only makes the next run select more.
 */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

import writeFileAtomic from 'write-file-atomic';
import { z } from 'zod';

import type { Env } from './env.js';
import type { GreenStamp, Platform } from './greenStamp.js';

const run = promisify(execFile);

const stampSchema = z.object({
    version: z.literal(1),
    platform: z.enum(['web', 'android', 'ios']),
    branch: z.string(),
    tree: z.string(),
    head: z.string(),
    owed: z.array(z.string()),
    at: z.string(),
});

/**
 * The folder the machine keeps its state in.
 *
 * @param env - The environment (`XDG_STATE_HOME`).
 * @param home - The home directory.
 * @returns The `kitchensink` folder under the state home.
 */
export const stateRoot = (env: Env = process.env, home: string = homedir()): string =>
    join(env['XDG_STATE_HOME'] ?? join(home, '.local', 'state'), 'kitchensink');

/**
 * The file that holds one stamp. The branch name is encoded into one path segment, so a name cannot climb out.
 *
 * @param root - The state root.
 * @param repoKey - From {@link repoKeyOf}.
 * @param branch - The branch.
 * @param platform - The platform.
 * @returns The path.
 */
export const stampFile = (root: string, repoKey: string, branch: string, platform: Platform): string =>
    join(root, 'e2eGreen', repoKey, encodeURIComponent(branch).replace(/^\./u, '%2E'), `${platform}.json`);

/**
 * A short key for the repository: two clones of the same project keep separate stamps.
 *
 * @sideEffect Runs git.
 * @param repo - The repository root.
 * @returns A hex key of the repository's common git directory.
 */
export async function repoKeyOf(repo: string): Promise<string> {
    const { stdout } = await run('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: repo });

    return createHash('sha256').update(stdout.trim()).digest('hex').slice(0, 12);
}

/**
 * The current branch, or undefined on a detached HEAD.
 *
 * @sideEffect Runs git.
 * @param repo - The repository root.
 * @returns The branch name.
 */
export async function currentBranch(repo: string): Promise<string | undefined> {
    const { stdout } = await run('git', ['symbolic-ref', '--quiet', '--short', 'HEAD'], { cwd: repo }).catch(() => ({
        stdout: '',
    }));

    return stdout.trim() === '' ? undefined : stdout.trim();
}

/**
 * Checks a parsed value against the stamp's shape.
 *
 * @param value - Parsed JSON.
 * @returns The stamp, or undefined when the value is not one.
 */
export function readStampValue(value: unknown): GreenStamp | undefined {
    const parsed = stampSchema.safeParse(value);

    return parsed.success ? parsed.data : undefined;
}

/**
 * Reads a stamp. A missing, unreadable, corrupt or wrong-shaped file is no stamp: the run then does the full suite.
 *
 * @sideEffect Reads a file.
 * @param file - From {@link stampFile}.
 * @returns The stamp, or undefined.
 */
export function readStamp(file: string): GreenStamp | undefined {
    try {
        return readStampValue(JSON.parse(readFileSync(file, 'utf8')));
    } catch {
        return undefined;
    }
}

/** Whether two stamps are the same one: a stamp is named by the tree it vouches for and when it was written. */
const isSameStamp = (a: GreenStamp | undefined, b: GreenStamp | undefined): boolean =>
    a === undefined || b === undefined ? a === b : a.tree === b.tree && a.at === b.at;

/**
 * Replaces the stamp this run started from, atomically.
 *
 * @sideEffect Writes the stamp through `write-file-atomic` (a temporary file renamed over it, with the directory made).
 * @param file - From {@link stampFile}.
 * @param next - The new stamp.
 * @param expected - The stamp the run started from, or undefined when it started with none.
 * @returns `written`, or `conflict` when the file no longer holds what the run started from.
 */
export function writeStamp(file: string, next: GreenStamp, expected: GreenStamp | undefined): 'written' | 'conflict' {
    if (!isSameStamp(readStamp(file), expected)) {
        return 'conflict';
    }

    mkdirSync(dirname(file), { recursive: true });
    writeFileAtomic.sync(file, `${JSON.stringify(next, null, 2)}\n`);

    return 'written';
}
