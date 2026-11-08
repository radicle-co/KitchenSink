// @vitest-environment node
/**
 * Repo guard: **the deferred calorie lookup never suspends** (ADR-0079).
 *
 * ## Why
 *
 * ADR-0021 put each card's calorie figure behind its own `<Suspense>` boundary, reading the page's batch with
 * `use(promise)`. React 19 then ran a committed calorie skeleton's RETRY lane ahead of every pinged deferred update on
 * the same screen (`getNextLanes` takes unsuspended pending lanes before pinged ones), so "See all", a library sort and
 * a collection switch each waited on the calorie lookup — up to its 12 s deadline. It was met twice and patched at the
 * symptom twice (`failedBatch`, then a test fake that answered at once) before the cause was named.
 *
 * ADR-0079 reads the lookup as a VALUE: `useRecipeNutritionBatches` subscribes with `useQueries` and hands each card a
 * `pending` / `failed` / `settled` reading, and `RecipeNutritionSlot` switches over it. This guard keeps it that way:
 * no `use(`, no `Suspense`, and no `useSuspense*` read anywhere in the calorie lookup's code.
 *
 * Files come from `git ls-files` over the nutrition folder plus the hook, so a new module there is covered the day it
 * is created. Comments are blanked by the shared TypeScript stripper first, so prose ABOUT Suspense is not a violation.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { appSourceModules } from './appSources.js';
import { repoRoot } from './serviceSources.js';
import { withoutTsComments } from './sourceComments.js';

/** The calorie lookup's code: every module under the nutrition folder, and the one hook that reads the batch. */
const NUTRITION_LOOKUP_PATHSPECS: readonly string[] = [
    'packages/apps/commise/features/recipes/src/nutrition',
    'packages/apps/commise/features/recipes/src/hooks/useRecipeNutritionBatches.ts',
];

/**
 * The suspending reads, each named. `use(` as a whole word (so `useMemo(` and `useQueries(` do not match, and
 * `React.use(` does); an aliased `use` imported from React; any `Suspense` identifier (the component, a JSX tag, an
 * import); and TanStack's `useSuspenseQuery` / `useSuspenseQueries` / `useSuspenseInfiniteQuery`.
 */
const SUSPENDING_READS: readonly { readonly name: string; readonly pattern: RegExp }[] = [
    { name: 'use(', pattern: /(?<![\w$])use\s*\(/u },
    {
        name: 'use imported under another name',
        pattern: /\{[^}]*(?<![\w$])use\s+as\s+[\w$]+[^}]*\}\s*from\s*['"]react['"]/u,
    },
    { name: 'Suspense', pattern: /(?<![\w$])Suspense(?![\w$])/u },
    { name: 'useSuspense*', pattern: /(?<![\w$])useSuspense[\w$]*/u },
];

/**
 * The suspending reads a module's code contains.
 *
 * @param fileName - The module's path; it picks the parser mode (`.tsx` turns JSX on).
 * @param source - The module's text.
 * @returns The names of the reads found in its code (comments excluded), in {@link SUSPENDING_READS} order. Pure.
 */
function suspendingReadsIn(fileName: string, source: string): readonly string[] {
    const code = withoutTsComments(source, fileName);

    return SUSPENDING_READS.filter(({ pattern }) => pattern.test(code)).map(({ name }) => name);
}

describe('suspendingReadsIn — the matcher, proved on fixtures', () => {
    it('finds the ADR-0021 slot: `use(promise)` inside a `<Suspense>` boundary', () => {
        const slot = [
            "import { Suspense, use, type FC } from 'react';",
            'const Content: FC<Props> = ({ batch, id }) => <Chip nutrition={select(use(batch), id)} />;',
            'export const Slot: FC<Props> = (props) => (',
            '    <Suspense fallback={<Skeleton />}>',
            '        <Content {...props} />',
            '    </Suspense>',
            ');',
        ].join('\n');

        expect(suspendingReadsIn('Slot.tsx', slot)).toEqual(['use(', 'Suspense']);
    });

    it('finds `React.use(`, an aliased `use`, and every `useSuspense*` read', () => {
        expect(suspendingReadsIn('a.ts', 'const response = React.use(batch);')).toEqual(['use(']);
        expect(suspendingReadsIn('b.ts', "import { use as read } from 'react';\nread(batch);")).toEqual([
            'use imported under another name',
        ]);
        expect(suspendingReadsIn('c.ts', 'const results = useSuspenseQueries({ queries });')).toEqual(['useSuspense*']);
        expect(suspendingReadsIn('d.ts', 'const { data } = useSuspenseQuery(options);')).toEqual(['useSuspense*']);
    });

    it('does not mistake the hooks this code does use, or prose about Suspense, for a suspending read', () => {
        const hook = [
            '/** Never `use(promise)` here, and no <Suspense> boundary — ADR-0079. */',
            "import { useQueries } from '@tanstack/react-query';",
            "import { useCallback, useMemo } from 'react';",
            '// A Suspense fallback is exactly what this replaced.',
            'const pages = useMemo(() => split(signature), [signature]);',
            'const combine = useCallback(fold, [pages]);',
            'return useQueries({ queries, combine });',
        ].join('\n');

        expect(suspendingReadsIn('useRecipeNutritionBatches.ts', hook)).toEqual([]);
    });
});

describe('the calorie lookup never suspends (ADR-0079)', () => {
    const modules = appSourceModules(NUTRITION_LOOKUP_PATHSPECS);

    it('discovers the lookup’s code (a vacuous pass here would hide the rule below)', () => {
        expect(modules).toContain('packages/apps/commise/features/recipes/src/nutrition/RecipeNutritionSlot.tsx');
        expect(modules).toContain('packages/apps/commise/features/recipes/src/hooks/useRecipeNutritionBatches.ts');
    });

    it('has no `use(`, `Suspense` or `useSuspense*` read in any of it', () => {
        const offenders = modules.flatMap((file) =>
            suspendingReadsIn(file, readFileSync(path.join(repoRoot, file), 'utf8')).map((read) => `${file}: ${read}`),
        );

        expect(
            offenders,
            'A calorie slot that suspends holds every deferred update on its screen behind the lookup. Read the batch ' +
                'as a value through `useRecipeNutritionBatches` (ADR-0079 §6).',
        ).toEqual([]);
    });
});
