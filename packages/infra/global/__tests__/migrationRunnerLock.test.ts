// @vitest-environment node
/**
 * Repo-wide guard: **every migration runner serializes its apply loop on a session advisory lock, and
 * releases it explicitly.**
 *
 * ## What this protects, and why a guard rather than trust
 *
 * The `schema_migrations` ledger makes a re-run a no-op, which is what satisfies the standing rule that
 * migrations run on every deploy without changing an already-migrated database. But the ledger is
 * CHECKED-then-APPLIED — `SELECT 1 FROM schema_migrations WHERE name = $1`, then `BEGIN … COMMIT` — and
 * those two steps are not atomic. Two runners starting together both read "unapplied" and both execute the
 * file; the loser fails on a `CREATE TABLE`/`CREATE EXTENSION` the winner just committed, and because the
 * runner's throw is a Lambda `FunctionError` that ADR-0022's Trigger rethrows, that is a RED DEPLOY of a
 * schema that was already correct.
 *
 * ADR-0022 recorded this as an accepted residual risk — *"nothing in the pipelines runs two concurrently …
 * It has not been observed. The fix, if it is ever wanted, is one `pg_advisory_lock` around the runner's
 * apply loop."* Two things moved since: the owner's rule that migrations run on EVERY deploy makes
 * concurrent invocations likelier, and recipe's SQL already has two deployed runners plus a pipeline
 * safety-net invoke. The race reproduces on the first attempt — see recipe-service's
 * `__tests__/integration/database/migrationRunner.integration.test.ts`, which fails with
 * `Key (extname)=(pgcrypto) already exists` without the lock.
 *
 * ## Why a repo-wide gate, now that there is only ONE apply loop
 *
 * There used to be THREE — identity, food-service, recipe-service — deliberately kept as parallel copies
 * (ADR-0022 rejected a shared migrations package on cost). That was the shape in which one copy quietly
 * loses a property the other two keep, and its own suite stays green because nothing in it runs two runners
 * at once. The three are now one engine, `@kitchensink/db-schema-guard`'s `applyMigrations`, so the risk
 * moved rather than vanished, and this guard moved with it. It asserts BOTH halves:
 *
 *  1. **The engine still serializes** — it acquires, bounds and releases the lock. One implementation is
 *     easier to keep right, not automatically right, and the property is invisible to any unit test that
 *     does not run two runners at once.
 *  2. **Every runner still routes through it** — a fourth service that hand-rolls its own apply loop
 *     reintroduces the whole failure class, and would otherwise be invisible here precisely BECAUSE the
 *     engine it declined to use is correct.
 *
 * ⛔ The RELEASE half is not decoration. A session advisory lock outlives the statement that took it, and
 * `client.release()` hands the session back to the pool still holding it — so a runner that acquires and
 * never unlocks deadlocks the next call on any pool that outlives one invocation. That is every test, and
 * the handler's own pool if it is ever reused.
 *
 * ## Nothing is enumerated
 *
 * Runners are DISCOVERED by the handler path every one of them is bundled at, so a fourth service's runner
 * is covered the day it lands and cannot opt out by not being mentioned.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { presentFiles, repoRoot } from './serviceSources.js';

/** Taking the lock. */
const ACQUIRES = /pg_advisory_lock\s*\(/u;

/** Giving it back — explicitly, rather than relying on the session dying. */
const RELEASES = /pg_advisory_unlock\s*\(/u;

/**
 * Bounding the wait.
 *
 * Without it a runner blocked behind a stuck peer is killed by the Lambda timeout with no diagnostic; with
 * it the deploy fails saying it could not take the migration lock, which names the actual problem.
 */
const BOUNDS_THE_WAIT = /lock_timeout/u;

/** The one apply engine every runner delegates to. */
const ENGINE = 'packages/shared/db-schema-guard/src/applyMigrations.ts';

/** How a runner reaches that engine. */
const DELEGATES = /from '@kitchensink\/db-schema-guard'/u;

/** One discovered migration runner. */
interface Runner {
    readonly file: string;
    readonly contents: string;
}

/**
 * Every migration runner handler in the repo.
 *
 * @returns One entry per `src/lambdas/migrate/handler.ts`, sorted.
 * @sideEffect Shells out to git and reads the working tree.
 */
function runners(): readonly Runner[] {
    return [...presentFiles(['packages/services/*/src/lambdas/migrate/handler.ts'])]
        .sort()
        .map((file) => ({ file, contents: readFileSync(path.join(repoRoot, file), 'utf8') }));
}

/**
 * ⛔ Runners whose apply loop is not serialized.
 *
 * @param found - The runners to inspect.
 * @returns One message per missing property.
 */
export function unlockedRunners(found: readonly Runner[]): readonly string[] {
    return found.flatMap(({ file, contents }) => {
        const missing: string[] = [];

        if (!ACQUIRES.test(contents)) {
            missing.push(
                'takes no pg_advisory_lock — its ledger check-then-apply can interleave with another ' +
                    "runner's and red a deploy whose schema was already correct (ADR-0022, residual risk)",
            );
        } else if (!RELEASES.test(contents)) {
            missing.push(
                'acquires the lock and never calls pg_advisory_unlock — a session lock survives ' +
                    'client.release(), so the pooled session hands the next caller a deadlock',
            );
        }

        if (ACQUIRES.test(contents) && !BOUNDS_THE_WAIT.test(contents)) {
            missing.push(
                'waits for the lock unbounded — a runner stuck behind a peer is killed by the Lambda ' +
                    'timeout with no diagnostic instead of failing with a lock error that names the cause',
            );
        }

        return missing.map((reason) => `${file}: ${reason}`);
    });
}

describe('the migration apply loop serializes (ADR-0022, residual risk closed)', () => {
    it('discovers all three runners', () => {
        // ⛔ The ANCHOR. The assertion below is a flatMap over this list; a path that stopped matching would
        // make it an assertion over nothing, which is how a guard like this goes green having read no code.
        expect(runners().map(({ file }) => file)).toStrictEqual([
            'packages/services/food-service/src/lambdas/migrate/handler.ts',
            'packages/services/identity/src/lambdas/migrate/handler.ts',
            'packages/services/recipe-service/src/lambdas/migrate/handler.ts',
        ]);
    });

    it('⛔ the ONE engine acquires, bounds and releases the lock', () => {
        const engine = [{ file: ENGINE, contents: readFileSync(path.join(repoRoot, ENGINE), 'utf8') }];

        expect(
            unlockedRunners(engine),
            'one implementation is easier to keep right than three, not automatically right — and no unit ' +
                'test of it runs two runners at once, so nothing else would notice the property going',
        ).toStrictEqual([]);
    });

    it('⛔ every runner ROUTES THROUGH that engine rather than hand-rolling a loop', () => {
        // A fourth service that writes its own apply loop reintroduces the entire failure class, and is
        // invisible to the assertion above precisely BECAUSE the engine it declined to use is correct.
        const detached = runners()
            .filter(({ contents }) => !DELEGATES.test(contents))
            .map(({ file }) => file);

        expect(
            detached,
            'these runners do not delegate to @kitchensink/db-schema-guard, so whatever apply loop they ' +
                'carry is unguarded by the assertion above',
        ).toStrictEqual([]);
    });

    it('⛔ no runner carries a SECOND copy of the lock, which would mean a second apply loop', () => {
        // Delegating and ALSO taking the lock locally is the shape of a half-finished extraction: the engine
        // is imported, an older loop is still there, and which one runs depends on a call site nobody reads.
        const doubled = runners()
            .filter(({ contents }) => ACQUIRES.test(contents))
            .map(({ file }) => file);

        expect(doubled, 'these runners still take an advisory lock of their own').toStrictEqual([]);
    });
});

describe('the gate fires — at runners built to break it', () => {
    it('catches a runner that takes no lock at all', () => {
        expect(unlockedRunners([{ file: 'r.ts', contents: 'await client.query("BEGIN");' }])).toStrictEqual([
            expect.stringContaining('takes no pg_advisory_lock') as unknown as string,
        ]);
    });

    it('catches a runner that acquires and never releases', () => {
        expect(
            unlockedRunners([{ file: 'r.ts', contents: 'SET lock_timeout = 1; pg_advisory_lock($1)' }]),
        ).toStrictEqual([expect.stringContaining('never calls pg_advisory_unlock') as unknown as string]);
    });

    it('catches a runner that waits unbounded', () => {
        expect(
            unlockedRunners([{ file: 'r.ts', contents: 'pg_advisory_lock($1) pg_advisory_unlock($1)' }]),
        ).toStrictEqual([expect.stringContaining('waits for the lock unbounded') as unknown as string]);
    });

    it('passes a runner carrying all three', () => {
        expect(
            unlockedRunners([
                { file: 'r.ts', contents: 'SET lock_timeout = 1; pg_advisory_lock($1); pg_advisory_unlock($1)' },
            ]),
        ).toStrictEqual([]);
    });
});
