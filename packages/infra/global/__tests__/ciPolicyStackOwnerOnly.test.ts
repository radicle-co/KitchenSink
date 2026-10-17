/**
 * ADR-0064: the boundary and execution policies are changed by the OWNER, from an admin session, and by nothing a
 * CI role can run. A workflow that could deploy them could widen the policy that bounds it.
 *
 * Three independent facts hold that: no tracked CI file names the stack or its context flag, `bin/account.ts`
 * constructs it only behind that flag, and the account workflow's `cdk deploy` passes no context.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { CI_POLICIES_CONTEXT_FLAG, CI_POLICIES_STACK_NAME } from '../lib/platform/CiExecutionPolicyStack.js';
import { repoRoot, trackedFiles } from '@kitchensink/repo-guards/serviceSources';

const read = (relative: string): string => readFileSync(path.join(repoRoot, relative), 'utf8');

const ciFiles = (): readonly string[] => trackedFiles('.github');

const FORBIDDEN_IN_CI = [
    CI_POLICIES_STACK_NAME,
    CI_POLICIES_CONTEXT_FLAG,
    'CiExecutionPolicyStack',
    'CiExecutionPolicy',
    'kitchensink-ci-exec-',
    'kitchensink-ci-boundary-',
];

const stripComments = (text: string): string =>
    text
        .split('\n')
        .filter((line) => !line.trimStart().startsWith('#'))
        .join('\n');

describe('the CI policy stack is owner-only', () => {
    it('finds CI files to judge (a vacuous pass here would hide every rule below)', () => {
        const files = ciFiles();

        expect(files.some((file) => file.endsWith('accountDeploy.yml'))).toBe(true);
        expect(files.length).toBeGreaterThan(20);
    });

    it.each(FORBIDDEN_IN_CI)('no workflow, action or script names %s', (needle) => {
        const offenders = ciFiles().filter((file) => stripComments(read(file)).includes(needle));

        expect(offenders).toEqual([]);
    });

    it("the account workflow's cdk deploy passes no context", () => {
        const workflow = stripComments(read('.github/workflows/accountDeploy.yml'));
        const deploys = workflow.split('\n').filter((line) => line.includes('cdk deploy'));

        expect(deploys.length).toBeGreaterThan(0);

        for (const line of deploys) {
            expect(line).not.toMatch(/(^|\s)(-c|--context)(\s|=)/u);
        }
    });

    it('bin/account.ts constructs the stack only inside the owner-only context gate', () => {
        const code = read('packages/infra/global/bin/account.ts')
            .replace(/\/\*[\s\S]*?\*\//gu, '')
            .replace(/\/\/[^\n]*/gu, '');
        const construction = code.indexOf('new CiExecutionPolicyStack(');

        expect(construction).toBeGreaterThan(-1);
        expect(code.match(/new CiExecutionPolicyStack\(/gu)).toHaveLength(1);

        const gate =
            /if\s*\(\s*String\(app\.node\.tryGetContext\(CI_POLICIES_CONTEXT_FLAG\)\)\s*===\s*'true'\s*\)\s*\{/u.exec(
                code,
            );

        expect(gate).not.toBeNull();

        const open = (gate?.index ?? 0) + (gate?.[0].length ?? 0);
        let depth = 1;
        let close = open;

        while (depth > 0 && close < code.length) {
            depth += code[close] === '{' ? 1 : code[close] === '}' ? -1 : 0;
            close += 1;
        }

        // `accountScopedInfra.test.ts` reads a literal `stackName:`, so the app spells it out; this keeps the two equal.
        expect(code).toContain(`stackName: '${CI_POLICIES_STACK_NAME}'`);
        expect(construction).toBeGreaterThan(open);
        expect(construction).toBeLessThan(close);
    });
});
