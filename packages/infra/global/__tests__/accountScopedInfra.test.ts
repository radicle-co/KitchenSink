/**
 * `bin/account.ts` is the ACCOUNT-scoped app (its docstring cites this file as the guard of its claims):
 * it has no stage, no stack it builds carries a stage suffix, and it tags `Environment=global`. Every stack
 * it constructs is judged, so a new account-scoped stack cannot bring a stage in with it.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import { withoutTsComments } from '@kitchensink/repo-guards/sourceComments';

const source = (relative: string): string => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

const appSource = source('../bin/account.ts');
const code = withoutTsComments(appSource, 'account.ts');

const constructed = [...code.matchAll(/new (\w+Stack)\(\s*app,\s*'[^']+',\s*\{([\s\S]*?)\}\s*\);/gu)].map((match) => ({
    name: match[1] ?? '',
    options: match[2] ?? '',
}));

describe('bin/account.ts: the account-scoped app', () => {
    it('constructs the stacks it is supposed to (a vacuous pass here would hide every rule below)', () => {
        expect(constructed.map((stack) => stack.name).sort()).toEqual([
            'CiExecutionPolicyStack',
            'CostGuardrailsStack',
            'GithubActionsAccessStack',
        ]);
    });

    it('has no stage: nothing in its code reads or names one', () => {
        expect(code).not.toMatch(/\bstage\b/iu);
        expect(code).not.toMatch(/STAGE/u);
    });

    it('tags the whole app Environment=global, once, as a literal', () => {
        expect(code.match(/Tags\.of\(app\)\.add\('Environment', 'global'\)/gu) ?? []).toHaveLength(1);
    });

    it.each(constructed)('$name: fixed kitchensink- stack name with no stage or PR suffix', ({ options }) => {
        const match = /stackName:\s*'([^']+)'/u.exec(options);

        expect(match?.[1]).toMatch(/^kitchensink-[a-z]+(-[a-z]+)*$/u);
        expect(match?.[1]).not.toMatch(/-(sandbox|prod|pr|dev|test|local)(-|$)/u);
        expect(options).not.toContain('${');
    });

    it('does not appear in the per-stage app', () => {
        const stageApp = source('../bin/app.ts');

        expect(stageApp).not.toMatch(/GithubActionsAccessStack/u);
    });

    it('the access stack sets no per-stack Environment tag that could override the app-level one', () => {
        const stack = source('../lib/platform/GithubActionsAccessStack.ts');

        expect(stack).not.toMatch(/Tags\.of\(/u);
    });
});
