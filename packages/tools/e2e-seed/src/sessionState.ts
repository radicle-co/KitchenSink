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

import { withoutTrailingSlashes } from './env.js';

/** The sessions one run holds. Keyed by role so a caller asks for the identity, not an index. */
export interface SessionState {
    readonly runKey: string;
    /**
     * The 1-based Maestro shard these sessions belong to.
     *
     * ⛔ Carried in the FILE rather than re-read from the environment by each of the ~35 `reset` processes.
     * The shard decides which signer's library a reset reconciles, and the file is what `provision` actually
     * leased — so a reset can never disagree with the session it is holding, whatever the environment says.
     */
    readonly shard: number;
    readonly signer: SessionHandle;
    readonly coAuthor: SessionHandle;
}

/** Where the state file lives. `$RUNNER_TEMP` on CI; the system temp dir locally. */
export function sessionStatePath(env: Readonly<Record<string, string | undefined>>): string {
    const root = env['E2E_SEED_STATE_DIR'] ?? env['RUNNER_TEMP'] ?? env['TMPDIR'] ?? '/tmp';

    // ⛔ THE SHARED LOOP, NOT `/\/+$/` — quadratic when it does not match, over a value read from the
    // environment (`js/polynomial-redos`). This is the FOURTH call site of one rule, three of them in
    // `env.ts`, which is past the point where a local copy is the cheaper answer.
    return `${withoutTrailingSlashes(root)}/e2e-seed/session.json`;
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
    let parsed: unknown;

    // ⛔ THE FILE READ AND ITS JSON PARSE ARE INSIDE THE `try`, AND NOTHING ELSE. The catch below rewrites
    // everything it sees into "run `provision` first", which is right for a MISSING file and wrong for a file
    // that exists and whose SHAPE OR SHARD is wrong. The first version validated inside the try, so a
    // `shard: "2"` was reported as an absent state file and the operator was sent to re-run provision over a
    // state file that was sitting right there. Validation therefore happens AFTER, where its own message
    // survives.
    //
    // ⚠️ RESIDUAL, STATED RATHER THAN CLOSED: malformed JSON still reports as "no state file", because
    // `writeSessionState` is a bare `writeFileSync` and a truncated file is physically possible. Not split
    // into two `try`s today because `provision` completes before any `reset` starts, so no reader races the
    // write.
    try {
        parsed = JSON.parse(readFileSync(path, 'utf8'));
    } catch (error) {
        throw new Error(`no e2e-seed session state at ${path} — \`provision\` must run once before any \`reset\``, {
            cause: error,
        });
    }

    if (typeof parsed !== 'object' || parsed === null) {
        throw new Error(`e2e-seed session state at ${path} is not an object`);
    }

    // ⛔ THE SHARD DECIDES WHOSE ROWS A RESET DELETES, so this module owns the invariant rather than leaning
    // on `maestroSlotForShard` to throw one module later. `SessionState.shard` is declared REQUIRED, so an
    // ABSENT shard is exactly as invalid as `"2"` — an earlier guard read `shard !== undefined && …`, which
    // let absence through while the comment above it claimed otherwise.
    const shard: unknown = (parsed as { readonly shard?: unknown }).shard;

    // ⚠️ ONLY `shard` IS PARSED, and the `as SessionState` below is that NARROW claim, not a total one. The
    // asymmetry is the reason: a well-typed WRONG shard is silently destructive — it purges another pool
    // slot's world — whereas a malformed `signer`/`coAuthor` cannot be silently wrong, because
    // `remintFromSession` throws loudly at mint time (`e2e-fixtures/src/clerkSession.ts`), which is
    // `reset.ts`'s "EVERY FAILURE IS LOUD AND NON-ZERO" contract already doing this job. Validating the
    // handles here would buy a loud failure that already exists.
    if (typeof shard !== 'number' || !Number.isInteger(shard) || shard < 1) {
        throw new Error(
            `e2e-seed session state at ${path} carries an invalid shard: ${JSON.stringify(shard)} (expected a positive integer)`,
        );
    }

    return parsed as SessionState;
}
