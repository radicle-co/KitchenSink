/**
 * P1 #4, the other half of the boundary: the non-prod CI role may touch a Lambda function only when the
 * `aws:cloudformation:stack-name` tag CloudFormation stamps on it matches `NONPROD_STACK_NAME_PATTERNS`. The policy
 * test proves the grant is conditioned on that tag; this proves the CONDITION is right against the stack names the
 * repository really synthesizes — so a production stack renamed to look like a sandbox one, or a new stage-less
 * stack, fails here before a role can read its secrets.
 *
 * The stack names are DISCOVERED from every `stackName:` the CDK sources assign, never listed: a stack added
 * tomorrow is judged the day it is committed. Each template is evaluated at the three stages that exist.
 */
import ts from 'typescript';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { NONPROD_STACK_NAME_PATTERNS } from '../lib/platform/GithubActionsAccessStack.js';
import { iamResourceMatches } from './iamGlob.js';
import { isTestFile, parse, repoRoot, trackedFiles, visit } from './serviceSources.js';

interface StackNameTemplate {
    readonly file: string;
    /** The name with `${stage}` left in place. */
    readonly template: string;
}

/** Every `stackName: \`…${stage}\`` assignment in the CDK sources, read from the AST so prose cannot count. */
function discoverStackNameTemplates(): readonly StackNameTemplate[] {
    const found: StackNameTemplate[] = [];

    for (const file of trackedFiles('packages')) {
        if (!/\.ts$/u.test(file) || isTestFile(file) || !/\/(bin|lib)\//u.test(file)) {
            continue;
        }

        const contents = readFileSync(path.join(repoRoot, file), 'utf8');

        if (!contents.includes('stackName')) {
            continue;
        }

        visit(parse({ file, contents }), (node) => {
            if (
                !ts.isPropertyAssignment(node) ||
                !ts.isIdentifier(node.name) ||
                node.name.text !== 'stackName' ||
                !ts.isTemplateExpression(node.initializer)
            ) {
                return;
            }

            const { head, templateSpans } = node.initializer;
            const template = templateSpans.reduce(
                (text, span) =>
                    `${text}\${${ts.isIdentifier(span.expression) ? span.expression.text : '?'}}${span.literal.text}`,
                head.text,
            );

            found.push({ file, template });
        });
    }

    return found;
}

const templates = discoverStackNameTemplates();
const at = (template: StackNameTemplate, stage: string): string => template.template.replaceAll('${stage}', stage);
const matchesNonprod = (name: string): boolean =>
    NONPROD_STACK_NAME_PATTERNS.some((pattern) => iamResourceMatches(pattern, name));

describe('the non-prod Lambda scope against the stack names the repository synthesizes', () => {
    it('discovers the stage-named stacks (a vacuous pass here would hide every rule below)', () => {
        expect(templates.length).toBeGreaterThanOrEqual(20);
        expect(templates.map((t) => t.template)).toEqual(
            expect.arrayContaining([
                'kitchensink-identity-webhooks-${stage}',
                'kitchensink-food-service-${stage}',
                'kitchensink-data-${stage}',
                'kitchensink-sandbox-scheduler-${stage}',
                'kitchensink-sandbox-router-${stage}',
            ]),
        );
    });

    it('every discovered name ends in its stage, which is what the patterns key on', () => {
        for (const t of templates) {
            expect(t.template, t.file).toMatch(/-\$\{stage\}$/u);
        }
    });

    it.each(['sandbox', 'pr-91'])('every stack at stage %s is inside the non-prod scope', (stage) => {
        for (const t of templates) {
            expect(matchesNonprod(at(t, stage)), `${t.file}: ${at(t, stage)}`).toBe(true);
        }
    });

    it('no stack at stage prod is inside the non-prod scope', () => {
        for (const t of templates) {
            expect(matchesNonprod(at(t, 'prod')), `${t.file}: ${at(t, 'prod')}`).toBe(false);
        }
    });

    it.each([
        ['the account-scoped access stack', 'kitchensink-github-actions-access', false],
        ['the account-scoped cost stack', 'kitchensink-cost-guardrails', false],
        ['another application`s stack', 'armoury-production-api', false],
        ['another application`s sandbox lookalike', 'armoury-api-sandbox', false],
        ['a prod stack with a sandbox word inside', 'kitchensink-sandbox-router-prod', false],
        ['a sandbox stack', 'kitchensink-data-sandbox', true],
    ])('%s (%s) -> %s', (_label, name, expected) => {
        expect(matchesNonprod(name)).toBe(expected);
    });
});
