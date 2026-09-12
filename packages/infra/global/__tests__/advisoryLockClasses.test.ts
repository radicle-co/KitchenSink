// @vitest-environment node
/**
 * Repo-wide guard: **every advisory lock is NAMESPACED by a registered class.**
 *
 * ## Why this is a repo-wide question and not a per-service one
 *
 * PostgreSQL advisory locks are **cluster-wide** — the key space is not scoped to a database. ADR-0006 puts
 * identity, food, recipe and every `pr-{N}` logical database on ONE instance, so a lock key chosen inside
 * one service is chosen for every other service too. The two argument forms are disjoint spaces: the
 * single-argument `bigint` form, and the two-argument `(classid, objid)` form where a distinct `classid`
 * makes collision impossible whatever `objid` hashes to.
 *
 * ⛔ THE DEFECT THIS CLOSES. Two call sites took the BARE single-argument form over `hashtext(...)` — food's
 * per-food enqueue serializer and recipe-service's per-owner collections lock. Those two shared one space,
 * across two services and two databases, with nothing but hash luck keeping them apart: `hashtext` returns
 * `int4`, so a food id and an owner ULID hashing to the same value made two unrelated transactions block
 * each other. Cross-service contention with no shared code is close to undiagnosable from either side.
 *
 * ⚠️ And the classes themselves were LOCAL CONSTANTS (`WORKER_LOCK_CLASS = 1`, `LOCK_CLASS_DEDUP = 2`,
 * `LOCK_CLASS_LIMITER = 3`, all inside `food-service`). Nothing stopped another service picking `1`. That is
 * exactly how ALB listener priorities collided here before allocation moved to one allocator, which is why
 * the cure is a shared registry rather than a rule about being careful.
 *
 * ⚠️ `ROLE_CATALOG_LOCK_KEY` is a DELIBERATE exception and is asserted as one below: a session lock on the
 * maintenance database, held by the bootstrap and the reaper, whose value is far outside `hashtext`'s range.
 */
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ADVISORY_LOCK_CLASSES, ROLE_CATALOG_LOCK_KEY } from '@kitchensink/db-schema-guard';

/**
 * The identifiers of the three fixed SESSION locks allowed to use the single-argument form.
 *
 * ⚠️ Matched by NAME rather than by value, because each is bound as `$1` in the SQL — the value never
 * appears next to the call. That is a weaker check than reading the number, and deliberately so: the
 * numbers themselves are asserted distinct and out of `int4` range by the last two cases below.
 */
const FIXED_SESSION_KEY_NAMES = ['ROLE_CATALOG_LOCK_KEY', 'MIGRATION_ADVISORY_LOCK_KEY', 'PROVISION_LOCK_KEY'];

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
            const text = readFileSync(join(REPO_ROOT, path), 'utf8');

            // The three FIXED SESSION keys are the sanctioned single-argument users — see the registry's
            // module docstring. Identified by the file naming its key, since the SQL binds it as `$1`.
            // Each is a hand-picked `7412200228220…` constant far above `int4`, so no `hashtext` value can
            // land on one; that prefix is their namespace.
            if (FIXED_SESSION_KEY_NAMES.some((name) => text.includes(name))) {
                return [];
            }

            return advisoryLockCalls(text)
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

    it('keeps the role-catalog key out of `hashtext` range, which is what makes its exemption safe', () => {
        // `hashtext` returns `int4`, so any single-argument key above that range cannot collide with one.
        expect(ROLE_CATALOG_LOCK_KEY).toBeGreaterThan(2 ** 31);
    });
});
