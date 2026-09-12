/**
 * Where a run's established Clerk sessions live between the ~35 separate processes that need them.
 *
 * `provision` signs in twice, once per API identity, and every later `reset` is its OWN node process — so
 * the handles have to survive process exit. A file on the runner is the whole mechanism; `$RUNNER_TEMP`
 * outlives every step of the job and is discarded with the runner.
 *
 * ⚠️ IT HOLDS CREDENTIALS. The dev-browser JWT plus a session id is enough to mint bearers for the run's
 * identities, so the file is created `0600` and nothing here ever logs its contents. They are throwaway
 * accounts on a development instance that own only this run's fixtures — but "low value" is not a reason to
 * write a credential world-readable.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import type { SessionHandle } from '@kitchensink/e2e-fixtures';

/** The sessions one run holds. Keyed by role so a caller asks for the identity, not an index. */
export interface SessionState {
    readonly runKey: string;
    readonly signer: SessionHandle;
    readonly coAuthor: SessionHandle;
}

/** Where the state file lives. `$RUNNER_TEMP` on CI; the system temp dir locally. */
export function sessionStatePath(env: Readonly<Record<string, string | undefined>>): string {
    const root = env['E2E_SEED_STATE_DIR'] ?? env['RUNNER_TEMP'] ?? env['TMPDIR'] ?? '/tmp';

    return `${root.replace(/\/+$/, '')}/e2e-seed/session.json`;
}

/**
 * Persist the run's sessions.
 *
 * @sideEffect Creates the directory and writes a `0600` file.
 */
export function writeSessionState(path: string, state: SessionState): void {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    writeFileSync(path, JSON.stringify(state), { encoding: 'utf8', mode: 0o600 });
}

/**
 * Read the run's sessions back.
 *
 * ⛔ Throws with the path when the file is absent. That happens when `reset` ran without `provision`, which
 * is a broken runner script rather than a state to recover from — and a reset that silently continued would
 * report success over a world it never touched.
 *
 * @sideEffect Reads from disk.
 */
export function readSessionState(path: string): SessionState {
    try {
        return JSON.parse(readFileSync(path, 'utf8')) as SessionState;
    } catch (error) {
        throw new Error(`no e2e-seed session state at ${path} — \`provision\` must run once before any \`reset\``, {
            cause: error,
        });
    }
}
