/**
 * Coverage for the React Hooks, type-aware promise and stringification rules the shared config ships.
 *
 * WHY THESE RULES EXIST HERE. Before they were added, the resolved config for every React package carried ZERO
 * `react-hooks` rules and the TypeScript block spread `recommended`, not a type-checked preset — so a ref used as
 * render state, a component created during render, an async handler whose rejection vanishes, and a floating
 * promise were all caught by human attention alone. Three of those shapes were found in this tree by review and
 * fixed by hand (`ed273e20`'s render-mutated refs among them) with nothing to stop the next one.
 *
 * Each invalid fixture is the mutation test for one rule: it reds if that rule is removed from the shared config
 * or scoped away from the file type it must cover. `clean.tsx` reds if the rules are widened into noise — it is
 * the correct form of the same code, and it must lint clean.
 *
 * The fixtures are real files linted through `createConfig()` exactly as a package receives it, with a real
 * tsconfig, because the promise rules need type information and a copy of the config could agree with itself
 * while the shipped one drifted.
 *
 * ⛔ WHY THE FIXTURES ARE WRITTEN AT RUN TIME, NOT COMMITTED. They are deliberately defective TypeScript. Committed as
 * `.ts`/`.tsx` they made this JavaScript-only package "own TypeScript", and `staticAnalysisCoverage.test.ts` then
 * (correctly) demanded that every one of them be typechecked and linted — which a fixture that exists to FAIL lint
 * cannot be. A fixture-shaped exemption in that guard would be a hole in it. So the sources live here as strings and
 * are materialised under this package's `.cache/`, which the root `.gitignore` ignores: no repository tool sees them
 * as source, and TypeScript still resolves `react`'s types by walking up to the workspace's `node_modules`.
 *
 * ⚠️ NOT under `node_modules/.cache`, the conventional spot: eslint-plugin-react-hooks' compiler rules skip every file
 * whose path contains `node_modules` (`filename.indexOf('node_modules') === -1` in the 7.1.1 build), so `refs` went
 * silent there while `exhaustive-deps` still fired. The "every fixture was linted" case below cannot catch that —
 * the file WAS linted — which is why each rule's own case asserts a non-empty report.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { ESLint } from 'eslint';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createConfig } from '../index.js';

/** The gitignored parent. Each run takes its OWN directory under it, so two runs from one checkout cannot collide. */
const CACHE = join(import.meta.dirname, '..', '.cache');

/** This run's fixture directory, created in `beforeAll`. */
let FIXTURES = '';

/** Each fixture's source, by file name. The name's extension decides which rule blocks apply. */
const SOURCES = {
    'tsconfig.json': JSON.stringify(
        {
            compilerOptions: {
                target: 'ES2022',
                module: 'ESNext',
                moduleResolution: 'bundler',
                jsx: 'react-jsx',
                strict: true,
                lib: ['ES2022', 'DOM'],
                noEmit: true,
                skipLibCheck: true,
            },
            include: ['*.ts', '*.tsx'],
        },
        null,
        4,
    ),

    // A promise-returning call whose rejection nobody observes.
    'floatingPromise.ts': `
async function save(): Promise<void> {
    await Promise.resolve();
}

export function run(): void {
    save();
}
`,

    // An async function handed to a prop that expects a void return, so its rejection is lost.
    'asyncHandler.tsx': `
export function SaveButton() {
    const onClick = async (): Promise<void> => {
        await Promise.resolve();
    };

    return <button onClick={onClick}>Save</button>;
}
`,

    // A ref used as render state — mutated and read during render, invisible to React.
    'refReadInRender.tsx': `
import { useRef } from 'react';

export function RenderCounter() {
    const renders = useRef(0);

    renders.current += 1;

    return <p>{renders.current}</p>;
}
`,

    // An effect that reads \`label\` without listing it, so it keeps showing the first label forever.
    'missingDependency.tsx': `
import { useEffect, useState } from 'react';

export function Title({ label }: { readonly label: string }) {
    const [shown, setShown] = useState('');

    useEffect(() => {
        const timer = setTimeout(() => setShown(label), 0);

        return () => clearTimeout(timer);
    }, []);

    return <h1>{shown}</h1>;
}
`,

    // A value of unknown shape interpolated, whose string form may be `[object Object]`.
    'unknownInTemplate.ts': `
export function probeFailure(detail: unknown): string {
    return \`master login probe failed: \${detail}\`;
}
`,

    // An object stringified through `Object.prototype.toString`, which says `[object Object]`.
    'objectToString.ts': `
export function describeRequest(request: { url: string; method: string }): string {
    return String(request);
}
`,

    // The correct stringification shapes — the field that carries the meaning, and a number as itself.
    'stringifiedClean.ts': `
export function describeFailure(error: Error, attempt: number): string {
    return \`attempt \${attempt} failed: \${error.message} (\${String(attempt)})\`;
}
`,

    // The correct shapes — state for render data, an explicitly voided promise with a catch.
    'clean.tsx': `
import { useState } from 'react';

async function save(): Promise<void> {
    await Promise.resolve();
}

export function SaveButton() {
    const [saved, setSaved] = useState(false);

    const onClick = (): void => {
        void save()
            .then(() => setSaved(true))
            .catch(() => setSaved(false));
    };

    return (
        <button type="button" onClick={onClick}>
            {saved ? 'Saved' : 'Save'}
        </button>
    );
}
`,
};

/** @type {Map<string, import('eslint').Linter.LintMessage[]>} */
const messagesByFile = new Map();

/**
 * The rule ids reported for one fixture.
 *
 * @param {string} fileName - The fixture's base name.
 * @returns {string[]} The reported rule ids, in report order.
 */
function rulesReported(fileName) {
    const messages = messagesByFile.get(fileName);

    if (messages === undefined) {
        throw new Error(`fixture ${fileName} was not linted`);
    }

    return messages.map((message) => message.ruleId ?? `fatal: ${message.message}`);
}

beforeAll(async () => {
    mkdirSync(CACHE, { recursive: true });
    FIXTURES = mkdtempSync(join(CACHE, 'reactAndPromiseRules-'));

    for (const [fileName, source] of Object.entries(SOURCES)) {
        writeFileSync(join(FIXTURES, fileName), source.trimStart());
    }

    const eslint = new ESLint({
        cwd: FIXTURES,
        overrideConfigFile: true,
        baseConfig: createConfig('./tsconfig.json', FIXTURES),
    });

    for (const result of await eslint.lintFiles(['*.ts', '*.tsx'])) {
        messagesByFile.set(result.filePath.slice(FIXTURES.length + 1), result.messages);
    }
}, 60_000);

afterAll(() => {
    // Empty when `beforeAll` failed before creating the directory; there is then nothing of this run's to remove.
    if (FIXTURES !== '') {
        rmSync(FIXTURES, { recursive: true, force: true });
    }
});

describe('the shared ESLint config — every fixture was actually linted', () => {
    it('produced a result for each fixture, so an empty glob cannot pass the suite', () => {
        expect([...messagesByFile.keys()].sort()).toEqual(
            Object.keys(SOURCES)
                .filter((fileName) => fileName !== 'tsconfig.json')
                .sort(),
        );
    });
});

describe('the shared ESLint config — promise rules (type-aware)', () => {
    it('reports a floating promise', () => {
        expect(rulesReported('floatingPromise.ts')).toEqual(['@typescript-eslint/no-floating-promises']);
    });

    it('reports an async function handed to a void-returning prop', () => {
        expect(rulesReported('asyncHandler.tsx')).toEqual(['@typescript-eslint/no-misused-promises']);
    });
});

describe('the shared ESLint config — stringification rules (type-aware)', () => {
    // The `[object Object]` class: a pg error object reached a deploy log as `master login probe failed: [object
    // Object]`. Each fixture trips exactly one of the two rules, so removing either rule reds its own case.
    it('reports a value of unknown shape interpolated into a template literal', () => {
        expect(rulesReported('unknownInTemplate.ts')).toEqual(['@typescript-eslint/restrict-template-expressions']);
    });

    it('reports an object stringified through the base Object toString', () => {
        expect(rulesReported('objectToString.ts')).toEqual(['@typescript-eslint/no-base-to-string']);
    });
});

describe('the shared ESLint config — React Hooks rules', () => {
    it('reports a ref mutated and read during render', () => {
        const reported = rulesReported('refReadInRender.tsx');

        expect(reported.length).toBeGreaterThan(0);
        expect(new Set(reported)).toEqual(new Set(['react-hooks/refs']));
    });
});

describe("the shared ESLint config — the preset's warn-level rules are raised to error", () => {
    it("reports a missing effect dependency at ERROR, not the preset's warn", () => {
        // Every package lints with a bare `eslint .`, so a warning fails nothing. This reds if the preset is spread
        // unchanged (`exhaustive-deps` ships at `warn`) or if the rule is scoped away from `.tsx`.
        expect(rulesReported('missingDependency.tsx')).toEqual(['react-hooks/exhaustive-deps']);
        expect(messagesByFile.get('missingDependency.tsx')?.map((message) => message.severity)).toEqual([2]);
    });
});

describe('the shared ESLint config — the correct forms stay clean', () => {
    it('reports nothing for state-driven render and an explicitly handled promise', () => {
        expect(rulesReported('clean.tsx')).toEqual([]);
    });

    it('reports nothing for an interpolated error message and a number', () => {
        expect(rulesReported('stringifiedClean.ts')).toEqual([]);
    });
});
