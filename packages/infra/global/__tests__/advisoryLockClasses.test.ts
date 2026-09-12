// @vitest-environment node
/**
 * Repo-wide guard: **every advisory lock is NAMESPACED by a registered class.**
 *
 * ## Why this is a repo-wide question, though each database has its own key space
 *
 * An advisory lock's key is scoped to the CURRENT DATABASE: PostgreSQL builds the lock tag from `MyDatabaseId` and
 * the key (`src/backend/utils/adt/lockfuncs.c`), so food's locks never meet recipe's, even on ADR-0006's one shared
 * instance. Inside one database, though, every concern shares one key space, and one registry keeps a class number
 * meaning one thing in every service, so a reader never has to ask which database a number was chosen for. The two
 * argument forms are disjoint spaces: the single-argument `bigint` form, and the two-argument `(classid, objid)`
 * form where a distinct `classid` makes collision impossible whatever `objid` hashes to.
 *
 * ⛔ THE DEFECT THIS CLOSES. Two call sites took the BARE single-argument form over `hashtext(...)` — food's
 * per-food enqueue serializer and recipe-service's per-owner collections lock. Each shared the single-argument
 * space with every other such key its own database might take, with nothing but hash luck keeping them apart:
 * `hashtext` returns `int4`, so two unrelated keys hashing to the same value made two unrelated transactions block
 * each other. Contention between concerns that share no code is close to undiagnosable from either side.
 *
 * ⚠️ And the classes themselves were LOCAL CONSTANTS (`WORKER_LOCK_CLASS = 1`, `LOCK_CLASS_DEDUP = 2`,
 * `LOCK_CLASS_LIMITER = 3`, all inside `food-service`). Nothing stopped another service picking `1`. That is
 * exactly how ALB listener priorities collided here before allocation moved to one allocator, which is why
 * the cure is a shared registry rather than a rule about being careful.
 *
 * ⚠️ The reserved keys (`RESERVED_ADVISORY_LOCK_KEYS`) are the DELIBERATE exception, asserted as one below: fixed
 * session keys far outside `hashtext`'s range, taken only through `withSessionAdvisoryLock`
 * (`sessionAdvisoryLockSites.test.ts`).
 */
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
    ADVISORY_LOCK_CLASSES,
    RESERVED_ADVISORY_LOCK_KEYS,
    RETIRED_ADVISORY_LOCK_CLASSES,
} from '@kitchensink/db-schema-guard';

/**
 * The one module allowed the single-argument form. `withSessionAdvisoryLock` takes it only for a member of
 * `RESERVED_ADVISORY_LOCK_KEYS`, whose numbers are asserted out of `int4` range below.
 */
const SESSION_LOCK_HELPER = 'packages/shared/db-schema-guard/src/sessionLock.ts';

/** The repo root — this file sits at `packages/infra/global/__tests__/`. */
const REPO_ROOT = join(import.meta.dirname, '../../../..');

/**
 * Every production TypeScript file the repo tracks.
 *
 * DISCOVERED from git, so a service added later is in scope without an edit here.
 *
 * @returns Repo-relative paths.
 * @sideEffect Runs `git ls-files`.
 */
function productionSources(): readonly string[] {
    return execFileSync('git', ['ls-files', '*.ts'], { cwd: REPO_ROOT, encoding: 'utf8' })
        .split('\n')
        .filter(
            (path) =>
                path.length > 0 &&
                !path.includes('/dist/') &&
                !path.includes('/__tests__/') &&
                !path.includes('/tests/') &&
                !/\.(?:test|spec)\.ts$/u.test(path),
        )
        .filter((path) => existsSync(join(REPO_ROOT, path)));
}

/**
 * Every advisory-lock call in a file, as the BALANCED argument text between its parentheses.
 *
 * Balanced rather than "up to the next `)`", because the real calls nest — `hashtext(${x})` — and a
 * truncating reader would miscount the arguments it exists to count.
 *
 * @param text - The file's source.
 * @returns One argument list per call, in source order. Pure.
 */
export function advisoryLockCalls(text: string): readonly string[] {
    const calls: string[] = [];

    for (const match of text.matchAll(/pg_(?:try_)?advisory_(?:xact_)?lock\(/gu)) {
        let depth = 1;
        let index = (match.index ?? 0) + match[0].length;
        const from = index;

        while (index < text.length && depth > 0) {
            if (text[index] === '(') {
                depth += 1;
            } else if (text[index] === ')') {
                depth -= 1;
            }

            index += 1;
        }

        calls.push(text.slice(from, index - 1));
    }

    return calls;
}

/**
 * How many arguments an advisory-lock call passes — commas at depth ZERO only.
 *
 * @param args - The balanced argument text.
 * @returns The argument count. Pure.
 */
export function argumentCount(args: string): number {
    if (args.trim() === '') {
        return 0;
    }

    let depth = 0;
    let count = 1;

    for (const character of args) {
        if (character === '(') {
            depth += 1;
        } else if (character === ')') {
            depth -= 1;
        } else if (character === ',' && depth === 0) {
            count += 1;
        }
    }

    return count;
}

/**
 * Every way a live class reuses a retired one: its number, which old code may still hold during a rolling deploy, or
 * its name, which would read as the concern that owned it.
 *
 * @param live - The live classes.
 * @param retired - The retired classes.
 * @returns One line per reuse. Pure.
 */
export function retiredClassReuse(
    live: Readonly<Record<string, number>>,
    retired: Readonly<Record<string, number>>,
): readonly string[] {
    const retiredNumbers = new Map(Object.entries(retired).map(([name, value]) => [value, name]));

    return Object.entries(live).flatMap(([name, value]) => [
        ...(retiredNumbers.has(value)
            ? [`${name} takes ${String(value)}, retired with ${retiredNumbers.get(value) ?? ''}`]
            : []),
        ...(name in retired ? [`${name} reuses a retired class's name`] : []),
    ]);
}

describe('every advisory lock is namespaced by a registered class', () => {
    it('discovers the tree — an empty scan would pass everything below', () => {
        expect(productionSources().length).toBeGreaterThan(500);
    });

    it('finds the advisory locks at all, so the rule below is not passing over an empty set', () => {
        // ⛔ NON-VACUITY FLOOR. A changed SQL spelling would make `advisoryLockCalls` return nothing
        // everywhere and satisfy the rules below perfectly while proving nothing.
        const total = productionSources().reduce(
            (count, path) => count + advisoryLockCalls(readFileSync(join(REPO_ROOT, path), 'utf8')).length,
            0,
        );

        expect(total).toBeGreaterThan(4);
    });

    it('reads nested arguments without truncating them, which is what makes the count meaningful', () => {
        expect(advisoryLockCalls('SELECT pg_advisory_xact_lock(hashtext($1))')).toEqual(['hashtext($1)']);
        expect(argumentCount('hashtext($1)')).toBe(1);
        expect(argumentCount('${ADVISORY_LOCK_CLASSES.foodEnqueue}, hashtext(${id})')).toBe(2);
        expect(argumentCount('$1, $2')).toBe(2);
    });

    it('⛔ every advisory lock takes the TWO-argument form, so the classes keep them apart', () => {
        const offenders = productionSources().flatMap((path) => {
            // The reserved keys are the sanctioned single-argument users — see the registry's module docstring —
            // and only the helper binds one.
            if (path === SESSION_LOCK_HELPER) {
                return [];
            }

            return advisoryLockCalls(readFileSync(join(REPO_ROOT, path), 'utf8'))
                .filter((args) => argumentCount(args) < 2)
                .map((args) => `${path} — pg_advisory_lock(${args})`);
        });

        expect(offenders).toEqual([]);
    });

    it('⛔ no service invents its own lock class — they all come from the shared registry', () => {
        // ⛔ THE HALF THAT MATTERS MOST. Two-argument calls alone are not enough: if `food-service` picks
        // class 1 locally and `recipe-service` also picks 1, they collide across databases exactly as the
        // bare keys did. A local constant is how that happens, so local constants are what is banned.
        const offenders = productionSources()
            .filter((path) => !path.includes('db-schema-guard'))
            .flatMap((path) => {
                const text = readFileSync(join(REPO_ROOT, path), 'utf8');

                return [...text.matchAll(/^const (\w*LOCK_CLASS\w*|\w*_LOCK_OBJECT)\s*=/gmu)].map(
                    (match) => `${path} — declares ${match[1] ?? ''}`,
                );
            });

        expect(offenders).toEqual([]);
    });

    it('registers every class exactly once, so two concerns cannot share a number', () => {
        const values = Object.values(ADVISORY_LOCK_CLASSES);

        expect(new Set(values).size).toBe(values.length);
    });

    it('⛔ keeps every registered number where it was, so a class is never renumbered or reused', () => {
        // The registry's own rule: a reused or renumbered class lets old and new code collide during a rolling deploy.
        // Uniqueness alone admits both, so each number is pinned here and a change to it is an edit a reviewer sees.
        // A new class appends a row; a deleted one moves to the retired classes, which keep its number out of use.
        expect(ADVISORY_LOCK_CLASSES).toEqual({
            foodWorkerSingleton: 1,
            foodNameDedup: 2,
            foodSourceLimiter: 3,
            foodEnqueue: 4,
            recipeCollectionOwner: 5,
            recipeParseCorrection: 6,
            recipeResolutionMapping: 7,
            recipePhoto: 8,
            foodCatalogSeed: 10,
            foodRemoteAdoption: 11,
        });
        expect(RETIRED_ADVISORY_LOCK_CLASSES).toEqual({ foodMirrorSync: 9 });
    });

    it.each<[string, Readonly<Record<string, number>>, readonly string[]]>([
        [
            'a live class on a retired number',
            { foodWorkerSingleton: 1, foodQueueWatch: 9 },
            ['foodQueueWatch takes 9, retired with foodMirrorSync'],
        ],
        ['a live class under a retired name', { foodMirrorSync: 11 }, ["foodMirrorSync reuses a retired class's name"]],
        ['live classes that reuse nothing', { foodWorkerSingleton: 1, foodCatalogSeed: 10 }, []],
    ])('retiredClassReuse reports %s', (_label, live, expected) => {
        expect(retiredClassReuse(live, { foodMirrorSync: 9 })).toEqual(expected);
    });

    it('⛔ never gives a retired class number or name to a live class', () => {
        expect(Object.keys(RETIRED_ADVISORY_LOCK_CLASSES).length).toBeGreaterThan(0);
        expect(retiredClassReuse(ADVISORY_LOCK_CLASSES, RETIRED_ADVISORY_LOCK_CLASSES)).toEqual([]);
    });

    it('keeps every reserved key out of `hashtext` range, which is what makes their exemption safe', () => {
        // `hashtext` returns `int4`, so any single-argument key above that range cannot collide with one.
        for (const key of Object.values(RESERVED_ADVISORY_LOCK_KEYS)) {
            expect(key).toBeGreaterThan(2 ** 31);
        }
    });
});
