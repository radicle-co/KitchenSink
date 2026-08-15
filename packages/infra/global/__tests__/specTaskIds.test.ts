/**
 * Guard: no `specs/<feature>/tasks.md` defines a task identifier twice.
 *
 * ## The defect this exists to prevent
 *
 * Feature 007 defined **eight** task IDs twice — T-004, T-025, T-027, T-028, T-041, T-043, T-044, T-046 — giving 60
 * checkbox lines for 52 identifiers. That is not cosmetic. A `tasks.md` identifier is the key a traceability matrix,
 * a dependency graph and a "done" checkbox all join on, so a duplicate means:
 *
 *   - a matrix row can be closed by the **wrong** task (both boxes read `T-025`, only one did the work);
 *   - `Depends on: T-043` no longer names one thing, so the graph has no single referent;
 *   - the task count is wrong, which is what made 007 claim 52 tasks while carrying 60 lines.
 *
 * Seven of 007's eight were the same task cross-listed under a second user story, and one (T-046) was two genuinely
 * different deliverables — a mobile UI and its E2E test — sharing an identifier. A human found all of this by
 * accident. It is mechanically detectable, so it should never need a human again.
 *
 * ## Discovery, not enumeration
 *
 * The suite globs `specs/<feature>/tasks.md` through `git ls-files`. A hardcoded list of features is the defect: 015
 * would be added without its guard, which is precisely how the portfolio accumulated the drift GR-017 §17-b now
 * forbids. `git ls-files` also excludes untracked scratch files, so a local experiment cannot fail somebody's CI.
 *
 * ## Why the parser is not a regex over lines
 *
 * See the docblock of `./specDeclarations.ts`. The short version, both measured on this repository:
 *
 *   - Feature 007's dependency graph is a fenced code block containing `[T-001]`, `[T-004]`, … A line-wise regex
 *     counts those as definitions and reports ~30 phantom duplicates.
 *   - Feature 001 uses suffixed identifiers — `T001`, `T001a`, `T001-alb`, `T005-core` are four different tasks. A
 *     naive `T\d+` match truncates them all to `T001`/`T005` and manufactures ~50 more phantoms.
 *
 * A gate that cries wolf 80 times gets deleted. So `findTaskIdDefinitions` strips fenced blocks and keeps the whole
 * identifier, and only a **checkbox** or a **heading** counts as a definition — a `Depends on:` continuation, a
 * matrix row and a prose mention are references, and repeating a reference is normal.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { findDuplicateTaskIds, findTaskIdDefinitions } from './specDeclarations.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

/**
 * Every tracked `specs/<feature>/tasks.md`, discovered rather than listed.
 *
 * @returns Repo-relative paths, sorted.
 * @sideEffect Shells out to `git ls-files` and reads the index.
 */
function discoverTaskFiles(): readonly string[] {
    const output = execFileSync('git', ['ls-files', 'specs/*/tasks.md'], {
        cwd: repoRoot,
        encoding: 'utf8',
    });

    return output
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line !== '')
        .sort();
}

const taskFiles = discoverTaskFiles();

describe('spec task identifiers', () => {
    it('discovers a task file for most features, so the suite cannot silently cover nothing', () => {
        // A floor, not an exact count: features are added, and this assertion exists only to catch the case where
        // the glob breaks and every `it.each` below silently iterates an empty list — a green suite that checked
        // nothing, which is the failure mode this repository has been burned by.
        expect(taskFiles.length).toBeGreaterThanOrEqual(13);
        expect(taskFiles.every((file) => file.startsWith('specs/') && file.endsWith('/tasks.md'))).toBe(true);
    });

    it.each(taskFiles)('%s defines every task identifier exactly once', (file) => {
        const definitions = findTaskIdDefinitions(readFileSync(path.join(repoRoot, file), 'utf8'));
        const duplicates = findDuplicateTaskIds(definitions);

        expect(
            duplicates.map((duplicate) => `${duplicate.id} defined at lines ${duplicate.lines.join(', ')}`),
            `${file} defines ${duplicates.length} task identifier(s) more than once. A duplicated ID makes "done" ` +
                'ambiguous: a traceability row can be closed by the wrong task, and a `Depends on:` reference has no ' +
                'single referent. If the two sites are the SAME work cross-listed under a second story, define it ' +
                'once (tagging every story it serves) and make the second site a non-checkbox pointer. If they are ' +
                'DIFFERENT deliverables, give the second one its own identifier.',
        ).toStrictEqual([]);
    });

    it('finds a plausible number of definitions in every task file', () => {
        // Guards the other direction: a parser change that stops matching a whole feature's format would make the
        // duplicate check vacuously pass for that file. Feature 004 defines its tasks as `### T-001` headings and
        // every other feature uses checkboxes, so both forms have to keep working.
        const empty = taskFiles.filter(
            (file) => findTaskIdDefinitions(readFileSync(path.join(repoRoot, file), 'utf8')).length === 0,
        );

        expect(
            empty,
            'These task files parsed to ZERO task definitions, so the duplicate check above passed without ' +
                'examining anything. Either the file genuinely defines no tasks (fix the file) or the parser no ' +
                'longer recognises its format (fix the parser).',
        ).toStrictEqual([]);
    });
});

describe('findTaskIdDefinitions — mutation proof', () => {
    // Each case below is a fixture that WOULD have slipped past a text-matching gate. If any of these starts
    // passing, the parser has regressed into grep.

    it('FAILS a file that defines one identifier twice (the 007 defect, reduced)', () => {
        const broken = [
            '# Tasks',
            '',
            '## US-001',
            '',
            '- [ ] **T-004** [P1] [US-001] Implement the aggregator — `src/aggregate.ts`',
            '    - Depends on: T-003',
            '',
            '## US-002',
            '',
            '- [ ] **T-004** [P1] [US-002] _(shared with US-001)_ Aggregator dedup — `src/aggregate.ts`',
            '    - Depends on: T-003',
            '',
        ].join('\n');

        const duplicates = findDuplicateTaskIds(findTaskIdDefinitions(broken));

        expect(duplicates).toStrictEqual([{ id: 'T-004', lines: [5, 10] }]);
    });

    it('FAILS a duplicate defined in the heading form (feature 004 style)', () => {
        const broken = ['# Tasks', '', '### T-001 · Author the contract', '', '### T-001 · Author it again', ''].join(
            '\n',
        );

        expect(findDuplicateTaskIds(findTaskIdDefinitions(broken))).toStrictEqual([{ id: 'T-001', lines: [3, 5] }]);
    });

    it('PASSES an evidence HEADING for a task the file defines by checkbox (the 003 false positive)', () => {
        // Feature 003 really looks like this. Before the per-file regime rule, `### T-202 — measured evidence`
        // was counted as a second definition of a task defined by a checkbox 100 lines earlier, and the guard
        // reported two duplicates in a file that is correct.
        const fine = [
            '- [x] **T-202** [M] [Test-first: true] SC-007 headroom — DONE 2026-08-11 — `0004_food_name_trgm_gist.sql`',
            '- [x] **T-198** [S] [Test-first: true] SC-007 short-query index bypass — `foodSearch.dao.ts`',
            '',
            '### T-202 — measured evidence (2026-08-11)',
            '',
            'EXPLAIN ANALYZE output follows.',
            '',
            '### T-198 — measured evidence (2026-08-09)',
            '',
        ].join('\n');

        const definitions = findTaskIdDefinitions(fine);

        expect(definitions.map((definition) => `${definition.id}:${definition.form}`)).toStrictEqual([
            'T-202:checkbox',
            'T-198:checkbox',
        ]);
        expect(findDuplicateTaskIds(definitions)).toStrictEqual([]);
    });

    it('falls back to headings ONLY when the file defines no checkbox tasks (feature 004)', () => {
        const headingOnly = [
            '# Tasks',
            '',
            '## Phase 1',
            '',
            '### T-001 · Author the import wire contract',
            '',
            '- [ ] every endpoint authored as zod',
            '- [ ] request/response schemas defined',
            '',
            '### T-002 · Database schema and migrations',
            '',
            '- [ ] migration written',
            '',
        ].join('\n');

        const definitions = findTaskIdDefinitions(headingOnly);

        // The sub-checkboxes are acceptance items with no identifier, so they are not definitions and must not
        // suppress the heading regime.
        expect(definitions).toStrictEqual([
            { id: 'T-001', line: 5, form: 'heading' },
            { id: 'T-002', line: 10, form: 'heading' },
        ]);
    });

    it('FAILS a duplicate in the heading regime', () => {
        const broken = ['### T-007 · Extractors', '', '### T-007 · Extractors, again', ''].join('\n');

        expect(findDuplicateTaskIds(findTaskIdDefinitions(broken))).toStrictEqual([{ id: 'T-007', lines: [1, 3] }]);
    });

    it('PASSES a fenced dependency graph that repeats every identifier', () => {
        // The single most important negative case: 007's real graph looks exactly like this, and a line-wise regex
        // reports every node as a duplicate definition.
        const fine = [
            '# Tasks',
            '',
            '```',
            '[T-001] DB Migration',
            '    ↓',
            '[T-002] Drizzle Schema',
            '    ↓',
            '[T-001] (shown again for the join)',
            '```',
            '',
            '- [ ] **T-001** Create the migration',
            '- [ ] **T-002** Define the schema',
            '',
        ].join('\n');

        const definitions = findTaskIdDefinitions(fine);

        expect(definitions.map((definition) => definition.id)).toStrictEqual(['T-001', 'T-002']);
        expect(findDuplicateTaskIds(definitions)).toStrictEqual([]);
    });

    it('PASSES references: `Depends on:` continuations, matrix rows, and prose', () => {
        const fine = [
            '- [ ] **T-001** Create the migration',
            '    - Depends on: T-002',
            '    - Mirrors: T-001',
            '',
            '| Task  | Depends On |',
            '| ----- | ---------- |',
            '| T-001 | T-002      |',
            '',
            'T-001 is also discussed here, and T-001 again, in prose.',
            '',
            '- **T-001** — serves this story; defined once above. Not a second checkbox.',
            '',
        ].join('\n');

        const definitions = findTaskIdDefinitions(fine);

        expect(definitions.map((definition) => definition.id)).toStrictEqual(['T-001']);
        expect(findDuplicateTaskIds(definitions)).toStrictEqual([]);
    });

    it('treats a suffixed identifier as its own task (feature 001: T001, T001a, T001-alb)', () => {
        const fine = [
            '- [x] T001 Scaffold the service',
            '- [x] T001-alb Attach it to the shared ALB',
            '- [x] T001a Configure the web app',
            '- [x] T005-core Scaffold the home-surface contract',
            '',
        ].join('\n');

        const definitions = findTaskIdDefinitions(fine);

        expect(definitions.map((definition) => definition.id)).toStrictEqual([
            'T001',
            'T001-alb',
            'T001a',
            'T005-core',
        ]);
        expect(findDuplicateTaskIds(definitions)).toStrictEqual([]);
    });

    it('recognises the escaped-bold form feature 011 uses (`**T-001\\*\\***`)', () => {
        const fine = ['- [ ] **T-001\\*\\*** Add the workspace globs', '- [ ] **T-002\\*\\*** [P] Scaffold', ''].join(
            '\n',
        );

        expect(findTaskIdDefinitions(fine).map((definition) => definition.id)).toStrictEqual(['T-001', 'T-002']);
    });

    it('is not fooled by a checkbox-shaped line inside a fence, nor by a nested fence', () => {
        const fine = [
            '````markdown',
            '- [ ] **T-009** This is documentation ABOUT the format, not a task',
            '```',
            '- [ ] **T-009** and neither is this',
            '```',
            '- [ ] **T-009** still inside the outer fence',
            '````',
            '',
            '- [ ] **T-009** the one real definition',
            '',
        ].join('\n');

        const definitions = findTaskIdDefinitions(fine);

        expect(definitions).toStrictEqual([{ id: 'T-009', line: 9, form: 'checkbox' }]);
        expect(findDuplicateTaskIds(definitions)).toStrictEqual([]);
    });

    it('counts a checked, unchecked, cancelled or in-progress box alike', () => {
        // A done-state is a done-state whatever marker it carries; `- [x]` and `- [~]` both claim the identifier.
        const broken = ['- [x] **T-010** Done', '- [~] **T-010** In progress', ''].join('\n');

        expect(findDuplicateTaskIds(findTaskIdDefinitions(broken))).toStrictEqual([{ id: 'T-010', lines: [1, 2] }]);
    });
});
