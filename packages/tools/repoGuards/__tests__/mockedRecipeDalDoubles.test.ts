// @vitest-environment node
/**
 * Repo-wide guard: recipe-service's tests never hand-write what the real `RecipesDal` returns for the locked facts, and
 * the integration tier provides `RECIPES_DAL` only through the typed `recipesDalDouble` helper.
 *
 * ⛔ WHY THIS IS A GUARD. The recipe-service integration tier boots the real `AppModule` with a double for each DAL.
 * Each suite once wrote its own `lockSlotFacts` answer, a copy of the 11-column projection of
 * `RecipesDal.lockSlotFacts`. When a migration added a locked fact, every copy kept compiling and answered `undefined`
 * for it, so a policy ran on an input the real DAL never returns, and every suite stayed green. The projection is now
 * written once (`lockedFactsOf`) and the hand-over is typed (`recipesDalDouble`); this guard keeps both true. A type
 * cannot see a literal that bypasses the projection, and a literal is the drift.
 *
 * Two rules, both read from the TypeScript parser (a comment is not a node):
 *  1. No integration test names `RECIPES_DAL`. A suite that provided the token itself would skip `recipesDalDouble`,
 *     and with it the check that a member answers the DAL's own type.
 *  2. In every recipe-service test file, an answer for `lockSlotFacts` holds no object literal unless it is inside a
 *     `lockedFactsOf(...)` call. The arguments of a call to a function whose name ends in `fakeRecipesDal` are trusted
 *     too, because the fake's own `lockSlotFacts` member is where the default lives (`recipesDal.fixture.ts`); the
 *     suffix match is for the alias `sharedFakeRecipesDal`. A member given to such a call is still read, so a literal
 *     there is reported.
 *
 * Known limits, none present in recipe-service today: the guard reads the answer's own text, so it does not see an
 * object held in a `const` and returned by reference, an assignment `dal.lockSlotFacts = ...`, a class field, a spy held
 * in a variable, or a computed key `['lockSlotFacts']`.
 *
 * ✅ THE FIX FOR A FAILURE: `lockSlotFacts: () => Promise.resolve(lockedFactsOf(makeRecipeRow({ ... })))`, and
 * `recipesDalDouble({ ... })` in place of `{ provide: RECIPES_DAL, useValue: { ... } }`.
 *
 * @pattern Fitness Function over the source of recipe-service's test files
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { inlineLockedFacts, recipeServiceTestFiles, recipesDalTokenUses } from './mockedRecipeDalDoubles.js';
import { repoRoot } from './serviceSources.js';

const SERVICE = 'packages/services/recipe-service';

/** Files the scan must hold, named by path and not derived from the scan's own filter, so a wrong glob fails loudly. */
const ANCHORS = [
    `${SERVICE}/__tests__/integration/recipes/heldPublicSave.integration.test.ts`,
    `${SERVICE}/__tests__/integration/recipes/privateSlots.integration.test.ts`,
    `${SERVICE}/src/recipes/__tests__/recipes.service.test.ts`,
    `${SERVICE}/src/recipes/__tests__/recipes.service.privateSlots.test.ts`,
];

describe('rule 1: the integration tier does not name RECIPES_DAL', () => {
    it.each([
        ['an import', `import { RECIPES_DAL } from '../recipes.tokens.js';`],
        ['an aliased import', `import { RECIPES_DAL as DAL } from '../recipes.tokens.js';`],
        ['a member of an imported namespace', `import * as t from 'x'; const a = { provide: t.RECIPES_DAL };`],
        ['the token spelled as a string', `const a = { provide: 'RECIPES_DAL', useValue: {} };`],
    ])('reports %s', (_name, source) => {
        expect(recipesDalTokenUses(source, 'a.integration.test.ts')).not.toHaveLength(0);
    });

    it('reports nothing for a comment or a longer name', () => {
        const source = `// RECIPES_DAL\n/** the RECIPES_DAL double */\nconst RECIPES_DAL_NAME = 1;\n`;

        expect(recipesDalTokenUses(source, 'a.integration.test.ts')).toEqual([]);
    });
});

describe('rule 2: a lockSlotFacts answer holds no hand-written facts', () => {
    it.each([
        ['an object as the member', `const a = { lockSlotFacts: { visibility: 'public' } };`],
        ['an arrow returning an object', `const a = { lockSlotFacts: () => ({ visibility: 'public' }) };`],
        [
            'an async arrow returning an object',
            `const a = { lockSlotFacts: async () => ({ visibility: stored.visibility }) };`,
        ],
        [
            'a function body returning an object',
            `const a = { lockSlotFacts: async () => { const row = stored; return { visibility: row.visibility }; } };`,
        ],
        [
            'vi.fn().mockResolvedValue(...) as the member',
            `const a = { lockSlotFacts: vi.fn().mockResolvedValue({ visibility: 'public', status: 'published' }) };`,
        ],
        [
            'a typed vi.fn variable',
            `const lockSlotFacts = vi.fn(async (): Promise<LockedRecipeFacts | undefined> => ({ visibility: 'public' }));`,
        ],
        ['mockResolvedValue on the variable', `lockSlotFacts.mockResolvedValue({ visibility: 'private' });`],
        ['mockReturnValue on the variable', `lockSlotFacts.mockReturnValue({ visibility: 'private' });`],
        ['mockImplementation on the variable', `lockSlotFacts.mockImplementation(() => ({ visibility: 'private' }));`],
        ['mockResolvedValueOnce on the variable', `lockSlotFacts.mockResolvedValueOnce({ visibility: 'private' });`],
        ['mockResolvedValue on a member', `dal.lockSlotFacts.mockResolvedValue({ visibility: 'private' });`],
        ['mockResolvedValue through vi.mocked', `vi.mocked(dal.lockSlotFacts).mockResolvedValue({ visibility: 'x' });`],
        [
            'a vi.fn member returning an object',
            `const a = { lockSlotFacts: vi.fn(async () => ({ visibility: 'private' })) };`,
        ],
        ['method shorthand', `const a = { async lockSlotFacts() { return { visibility: 'public' }; } };`],
        ['a getter', `const a = { get lockSlotFacts() { return { visibility: 'public' }; } };`],
        ['a quoted key', `const a = { 'lockSlotFacts': () => ({ visibility: 'public' }) };`],
        ['vi.spyOn on the member', `vi.spyOn(dal, 'lockSlotFacts').mockResolvedValue({ visibility: 'x' });`],
        ['a satisfies wrapper', `(lockSlotFacts satisfies unknown).mockResolvedValue({ visibility: 'x' });`],
        ['a type assertion wrapper', `(<Mock>lockSlotFacts).mockResolvedValue({ visibility: 'x' });`],
        [
            'a member given to fakeRecipesDal',
            `const dal = fakeRecipesDal({ lockSlotFacts: () => Promise.resolve({ visibility: 'public' }) });`,
        ],
        [
            'an offence after a generic arrow (a .ts file, not JSX)',
            `const t = async <T>(fn: (x: number) => Promise<T>) => fn(1);\nconst a = { lockSlotFacts: () => ({ visibility: 'public' }) };`,
        ],
        [
            'an object beside a lockedFactsOf call',
            `const a = { lockSlotFacts: () => Promise.resolve({ ...lockedFactsOf(row), status: 'draft' }) };`,
        ],
    ])('reports %s', (_name, source) => {
        expect(inlineLockedFacts(source, 'a.test.ts')).not.toHaveLength(0);
    });

    it.each([
        [
            'lockedFactsOf as the member',
            `const a = { lockSlotFacts: () => Promise.resolve(lockedFactsOf(makeRecipeRow({ visibility: 'public', status: 'draft' }))) };`,
        ],
        [
            'lockedFactsOf in an async arrow',
            `const a = { lockSlotFacts: async () => { const row = underLock ?? stored; return lockedFactsOf(row); } };`,
        ],
        [
            'lockedFactsOf in a typed vi.fn variable',
            `const lockSlotFacts = vi.fn<RecipesDal['lockSlotFacts']>(async () => lockedFactsOf(makeRecipeRow({ status })));`,
        ],
        [
            'lockedFactsOf given to mockResolvedValue',
            `lockSlotFacts.mockResolvedValue(lockedFactsOf(makeRecipeRow({ visibility: 'private' })));`,
        ],
        ['an undefined answer', `vi.mocked(dal.lockSlotFacts).mockResolvedValue(undefined);`],
        ['an undefined answer on a variable', `lockSlotFacts.mockResolvedValue(undefined);`],
        [
            'a member reused from fakeRecipesDal',
            `const a = { lockSlotFacts: sharedFakeRecipesDal({ findById: vi.fn() }).lockSlotFacts };`,
        ],
        ['a shorthand member', `const lockSlotFacts = vi.fn(); const a = { lockSlotFacts };`],
        [
            'an object that is not an answer for lockSlotFacts',
            `const a = { visibility: 'public' }; mock.mockResolvedValue({ a: 1 });`,
        ],
    ])('reports nothing for %s', (_name, source) => {
        expect(inlineLockedFacts(source, 'a.test.ts')).toEqual([]);
    });

    it('reports an offence after a generic arrow, with its line', () => {
        const source = `const t = async <T>(fn: (x: number) => Promise<T>) => fn(1);\nconst a = { lockSlotFacts: () => ({ v: 1 }) };\n`;

        expect(inlineLockedFacts(source, 'a.test.ts')).toEqual(['line 2']);
    });

    it('names the line of each offence', () => {
        const source = `const ok = 1;\nconst a = {\n    lockSlotFacts: () => ({ visibility: 'public' }),\n};\n`;

        expect(inlineLockedFacts(source, 'a.test.ts')).toEqual(['line 3']);
    });
});

describe('scanning a tree', () => {
    const scratch: string[] = [];

    /**
     * A throwaway git repository holding the given files, all staged.
     *
     * @param files - Each file's text, by repo-relative path.
     * @returns The repository's root, removed after the test.
     * @sideEffect Creates a directory under the system temp folder and runs `git init` and `git add` there.
     */
    function scratchRepo(files: Readonly<Record<string, string>>): string {
        const root = mkdtempSync(path.join(tmpdir(), 'recipeDalDoublesGuard-'));

        scratch.push(root);
        execFileSync('/usr/bin/git', ['init', '--quiet'], { cwd: root });

        for (const [file, text] of Object.entries(files)) {
            mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
            writeFileSync(path.join(root, file), text);
            execFileSync('/usr/bin/git', ['add', '--', file], { cwd: root });
        }

        return root;
    }

    afterEach(() => {
        for (const root of scratch.splice(0)) {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('holds every test file under recipe-service, with no name filter', () => {
        const root = scratchRepo({
            [`${SERVICE}/__tests__/integration/recipes/a.integration.test.ts`]: 'export {};\n',
            [`${SERVICE}/src/recipes/__tests__/b.test.ts`]: 'export {};\n',
            [`${SERVICE}/src/recipes/c.ts`]: 'export {};\n',
            'packages/services/other/__tests__/d.test.ts': 'export {};\n',
        });

        expect(recipeServiceTestFiles(root)).toEqual([
            `${SERVICE}/__tests__/integration/recipes/a.integration.test.ts`,
            `${SERVICE}/src/recipes/__tests__/b.test.ts`,
        ]);
    });

    it('holds the anchor files of the real tree, named by path', () => {
        expect(recipeServiceTestFiles(repoRoot)).toEqual(expect.arrayContaining(ANCHORS));
    });
});

/** A file of the real tree, read as text. */
const readText = (file: string): string => readFileSync(path.join(repoRoot, file), 'utf8');

describe('the real tree', () => {
    it('provides RECIPES_DAL in no integration test', () => {
        const offenders = recipeServiceTestFiles(repoRoot)
            .filter((file) => file.startsWith(`${SERVICE}/__tests__/integration/`))
            .flatMap((file) => recipesDalTokenUses(readText(file), file).map((use) => `${file}: ${use}`));

        expect(offenders).toEqual([]);
    });

    it('hand-writes the locked facts in no recipe-service test', () => {
        const offenders = recipeServiceTestFiles(repoRoot).flatMap((file) =>
            inlineLockedFacts(readText(file), file).map((use) => `${file}: ${use}`),
        );

        expect(offenders).toEqual([]);
    });
});
