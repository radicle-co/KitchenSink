// @vitest-environment node
/**
 * Repo-wide guard: the function the parse leg INVOKES is a function some CDK app in this repo CREATES, and
 * the engine version it declares is the one pip installs.
 *
 * ## The gap this closes, which is the one the deploy fix left open
 *
 * `cdkAppDeployCoverage.test.ts` asks whether every CDK app has a deployer. It was written because
 * `packages/services/ingredient-parser` had none, so `RecipeWorkersStack` shipped `RecipeParseLineFunction`
 * into every stage pointing `CRF_FUNCTION_NAME` at a function that existed in no account — and `crfInvoke.ts`
 * mapped the failed invoke to absence, which ADR-0026 §3 reads as `single-engine llm`. Silent, green, and
 * shipped everywhere.
 *
 * That guard cannot see the SECOND way into the same state. Rename the parser's function in its own app and:
 *
 *  - nothing fails to compile — the two apps are joined by a hand-formatted ARN, not by a construct
 *    reference, and they must be, because the callee lives in another CDK app (ADR-0025);
 *  - `cdkAppDeployCoverage` still passes — the app still has a deployer;
 *  - the recipe ensure-exists gate still passes — the stack it probes still exists;
 *  - and every parse line starts coming back `ResourceNotFoundException`.
 *
 * The same is true of the engine PIN. `RecipeWorkersStack` declares `CRF_ENGINE_VERSION` and the adapter
 * refuses any response reporting a different one — deliberately, since a cache row written under the wrong
 * version is permanent within its generation. Bump `requirements.txt` without the stack (or the reverse) and
 * every answer is refused as a contract breach. ADR-0022's residual risk is that "nothing orders two CDK
 * apps", so the skew is reachable in a single deploy.
 *
 * ## Why it is asserted this way
 *
 * ⛔ The subject is NOT enumerated. Nothing here contains the string `kitchensink-ingredient-parser`: the
 * guard reads the name out of the CALLER (whatever `CRF_FUNCTION_NAME` is set to) and then requires some
 * app's `functionName` to declare it. A hand-written "the parser is called X" constant would be a third copy
 * of the very fact whose copies are the problem — and "a copy of a list cannot detect that the list is
 * incomplete" (ADR-0025 §3, on the `handle-sync-worker` outage).
 *
 * DESIGN PATTERN: Specification module over two independent readings — the invoked name and the declared
 * names are derived separately from source and compared. Neither side is the authority alone.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { presentFiles, repoRoot } from './serviceSources.js';

/** The env var the parse leg's Lambda carries, whose value names the function it invokes. */
const INVOKED_NAME_ENV = 'CRF_FUNCTION_NAME';

/** The env var declaring which engine build the caller will accept a response from. */
const ENGINE_VERSION_ENV = 'CRF_ENGINE_VERSION';

/** Where the Python engine's pin actually lives — the file pip reads. */
const REQUIREMENTS = 'packages/services/ingredient-parser/requirements.txt';

/**
 * A template or string literal, with every interpolation collapsed.
 *
 * `` `a-${props.stage}` `` and `` `a-${stage}` `` are the SAME name — the two apps reach the stage through
 * differently-named locals, and comparing the expression text would report agreement as drift.
 *
 * @param node - The expression to read.
 * @returns The normalized text, or `undefined` when the node is not a string-ish literal.
 */
function normalizedName(node: ts.Node): string | undefined {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
        return node.text;
    }

    if (!ts.isTemplateExpression(node)) {
        return undefined;
    }

    return node.templateSpans.reduce((text, span) => `${text}\${}${span.literal.text}`, node.head.text);
}

/**
 * Every CDK infra source present in the working tree.
 *
 * ⚠️ `presentFiles`, never `trackedFiles`: a stack still being written is exactly when a rename is made, and
 * the INDEX cannot see it. `serviceSources.ts` records a guard that passed while its subject was untracked
 * and failed on the run right after the first commit.
 */
function infraSources(): readonly { readonly file: string; readonly source: ts.SourceFile }[] {
    return presentFiles(['packages/**/infra/**/*.ts'])
        .filter((file) => /(^|\/)infra\/(lib|bin)\/.*\.ts$/u.test(file) && !file.endsWith('.d.ts'))
        .map((file) => ({
            file,
            source: ts.createSourceFile(
                file,
                readFileSync(path.join(repoRoot, file), 'utf8'),
                ts.ScriptTarget.Latest,
                true,
            ),
        }));
}

/**
 * Every value assigned to a property named `key`, anywhere in the infra sources, normalized.
 *
 * @param key - The property name to collect.
 * @returns The normalized values, with the file each came from.
 */
function assignedValues(key: string): readonly { readonly file: string; readonly value: string }[] {
    const found: { file: string; value: string }[] = [];

    for (const { file, source } of infraSources()) {
        const visit = (node: ts.Node): void => {
            if (
                ts.isPropertyAssignment(node) &&
                (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) &&
                node.name.text === key
            ) {
                const value = normalizedName(node.initializer);

                if (value !== undefined) {
                    found.push({ file, value });
                }
            }

            ts.forEachChild(node, visit);
        };

        visit(source);
    }

    return found;
}

describe('the parse leg invokes a function this repo declares', () => {
    it('⛔ every CRF_FUNCTION_NAME is declared as some CDK app’s functionName', () => {
        const invoked = assignedValues(INVOKED_NAME_ENV);
        const declared = new Set(assignedValues('functionName').map(({ value }) => value));

        // Non-vacuity, in both directions: an empty `invoked` would make the assertion trivially true, and
        // that is exactly what a rename of the ENV KEY would produce.
        expect(invoked.length, `no infra source sets ${INVOKED_NAME_ENV}`).toBeGreaterThan(0);
        expect(declared.size, 'no infra source declares a Lambda functionName').toBeGreaterThan(0);

        expect(
            invoked.filter(({ value }) => !declared.has(value)),
            'a stack invokes a function name no CDK app in this repository creates — the parse leg would ' +
                'answer ResourceNotFoundException for every line, which reads as single-engine, not as an error',
        ).toEqual([]);
    });

    it('⛔ the declaring app is a DIFFERENT package — otherwise this guard proves nothing', () => {
        // The whole hazard is that the two live in separate CDK apps with no construct reference between
        // them. If they ever ended up in one package, this guard would still pass while guarding nothing —
        // so the cross-package split is asserted rather than assumed.
        const invoked = assignedValues(INVOKED_NAME_ENV);
        const declared = assignedValues('functionName');
        const packageOf = (file: string): string => file.split('/').slice(0, 4).join('/');

        for (const caller of invoked) {
            const declarers = declared.filter(({ value }) => value === caller.value).map(({ file }) => packageOf(file));

            expect(declarers, `${caller.file} invokes '${caller.value}'`).not.toEqual([]);
            expect(declarers.some((declarer) => declarer !== packageOf(caller.file))).toBe(true);
        }
    });
});

describe('the parse leg accepts the engine version pip installs', () => {
    it('⛔ CRF_ENGINE_VERSION equals the pin in requirements.txt', () => {
        const declared = assignedValues(ENGINE_VERSION_ENV);

        expect(declared.length, `no infra source sets ${ENGINE_VERSION_ENV}`).toBeGreaterThan(0);

        // The engine's own manifest, read rather than restated. A guard comparing the stack's literal to a
        // constant in this file would agree with itself forever.
        const pinned = readFileSync(path.join(repoRoot, REQUIREMENTS), 'utf8')
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line.length > 0 && !line.startsWith('#'));

        expect(
            declared.filter(({ value }) => !pinned.includes(value)),
            'the caller declares an engine version requirements.txt does not install. The adapter refuses ' +
                'every response reporting a different version, so this is a total parse outage that looks ' +
                'like a contract bug — and a cache row written under the wrong pin is permanent',
        ).toEqual([]);
    });
});
