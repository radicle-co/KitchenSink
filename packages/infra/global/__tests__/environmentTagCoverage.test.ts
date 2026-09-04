// @vitest-environment node
/**
 * Repo-wide guard: EVERY CDK app tags its tree with `Environment`.
 *
 * ## The failure this pins
 *
 * ADR-0005 makes `Environment` the primary teardown signal — `global` persists, `pr-{N}` is deleted when the
 * PR closes — and `.github/scripts/teardown-sandbox-pr.sh` reclaims by **tag OR name**. On 2026-09-04 an
 * audit found `packages/apps/commise/web/infra/bin/app.ts` was the ONE app of eight that tagged nothing. It
 * had sat that way past seven siblings, because nothing looked.
 *
 * ⛔ The name half of the teardown rule would NOT have covered it. `pr_scope_belongs` is delimiter-anchored
 * on the LEADING token, and this app's stack is `kitchensink-sandbox-router-{stage}` — so a per-PR router
 * would be named `kitchensink-sandbox-router-pr-9`, which does not begin with `pr-9` and is therefore
 * invisible to the name rule. For that stack the TAG is the only reclaim signal there is, which is why the
 * omission mattered rather than being cosmetic.
 *
 * ## Why the app set is DISCOVERED, not listed
 *
 * "A copy of a list cannot detect that the list is incomplete" (ADR-0025 §3, on the handle-sync-worker
 * outage). The apps come from {@link cdkApps}, which finds them by CONTENT — any tracked `bin/app.ts` that
 * constructs a CDK `App`. A ninth app is covered the day it is committed and cannot opt out by not being
 * mentioned here. This is the same derivation `commitProvenanceCoverage.test.ts` uses, and this suite is
 * deliberately its sibling in shape.
 *
 * ## Why the tag must be the ASPECT form, and why that does NOT contradict the commit stamp
 *
 * Each entrypoint carries a comment saying the commit provenance is a STACK tag, "never `Tags.of(app)`",
 * because that value changes every commit and the aspect form would rewrite every taggable resource on every
 * deploy. That reasoning is about VOLATILITY and does not reach `Environment`, which is invariant for a given
 * stack. The aspect form is moreover REQUIRED here: teardown sweeps `resourcegroupstaggingapi get-resources`
 * for `Environment=pr-{N}`, which reads RESOURCE-level tags, and a stack-only tag is invisible to it.
 *
 * ## Why the AST, not `includes`
 *
 * Every entrypoint MENTIONS `Tags.of(app)` in the prose explaining why the commit stamp does not use it. A
 * textual gate would accept that comment as evidence and pass an app whose only mention of the tag is the
 * paragraph explaining a different tag. Parsing means a call is a call — the same reasoning
 * `commitProvenanceCoverage.test.ts` and `serviceSources.ts` already record.
 *
 * DESIGN PATTERN: Specification module over a derived set — asserted in both directions, so neither the app
 * set nor the tagged set can shrink quietly.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { cdkApps } from './cdkApps.js';
import { repoRoot, visit } from './serviceSources.js';

/** The tag key ADR-0005 reclaims by. Named once; every assertion derives from it. */
const ENVIRONMENT_TAG = 'Environment';

/**
 * Whether a source file applies `Tags.of(<the app it built>).add('Environment', …)`.
 *
 * Three things are required together, each ruling out a real way of being wrong:
 *   - the call exists as a CALL, so the prose about `Tags.of(app)` is not evidence;
 *   - the receiver is the identifier bound to `new App(...)`, so tagging some other construct does not count;
 *   - the first argument is the literal `Environment`, so tagging a different key does not count.
 *
 * @param source - The entrypoint's text.
 * @param file - Its path, for the parser's diagnostics.
 * @returns True when the file tags the app it builds with `Environment`. Pure.
 */
export function tagsEnvironmentOnApp(source: string, file: string): boolean {
    const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
    let appBinding: string | undefined;
    const taggedIdentifiers = new Set<string>();

    visit(parsed, (node) => {
        // `const app = new App();` — the identifier this entrypoint binds its app to.
        if (
            ts.isVariableDeclaration(node) &&
            ts.isIdentifier(node.name) &&
            node.initializer !== undefined &&
            ts.isNewExpression(node.initializer) &&
            ts.isIdentifier(node.initializer.expression) &&
            node.initializer.expression.text === 'App'
        ) {
            appBinding = node.name.text;
        }

        // `Tags.of(<receiver>).add('Environment', <value>)` — matched as a shape, never as text.
        if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) {
            return;
        }

        if (node.expression.name.text !== 'add') {
            return;
        }

        const [key] = node.arguments;

        if (key === undefined || !ts.isStringLiteral(key) || key.text !== ENVIRONMENT_TAG) {
            return;
        }

        const receiverCall = node.expression.expression;

        if (!ts.isCallExpression(receiverCall) || !ts.isPropertyAccessExpression(receiverCall.expression)) {
            return;
        }

        if (
            receiverCall.expression.name.text !== 'of' ||
            !ts.isIdentifier(receiverCall.expression.expression) ||
            receiverCall.expression.expression.text !== 'Tags'
        ) {
            return;
        }

        const [tagged] = receiverCall.arguments;

        if (tagged !== undefined && ts.isIdentifier(tagged)) {
            taggedIdentifiers.add(tagged.text);
        }
    });

    return appBinding !== undefined && taggedIdentifiers.has(appBinding);
}

describe('every CDK app tags its tree with Environment (ADR-0005)', () => {
    const apps = cdkApps();

    it('finds the CDK apps by content, so a new one cannot opt out by omission', () => {
        // Non-vacuity: a discovery that silently stopped matching would make every assertion below pass.
        expect(apps.length).toBeGreaterThanOrEqual(8);
    });

    it.each(apps)('%s applies Environment to the app it constructs', (app) => {
        const absolute = path.join(repoRoot, app);

        expect(
            tagsEnvironmentOnApp(readFileSync(absolute, 'utf-8'), absolute),
            `${app} sets no ${ENVIRONMENT_TAG} tag`,
        ).toBe(true);
    });

    it('rejects the prose that explains the OTHER tag — a comment is not a call', () => {
        // ⛔ This is the assertion that makes the AST worth its cost: every entrypoint contains this sentence.
        const proseOnly = [
            'import { App, Tags } from "aws-cdk-lib";',
            'const app = new App();',
            '// A stack tag, never `Tags.of(app)`: the aspect form would rewrite every taggable resource.',
        ].join('\n');

        expect(tagsEnvironmentOnApp(proseOnly, 'prose.ts')).toBe(false);
    });

    it('rejects a tag applied to something other than the app, and a different key', () => {
        const wrongReceiver = [
            'const app = new App();',
            'const other = {};',
            "Tags.of(other).add('Environment', 'global');",
        ].join('\n');
        const wrongKey = ['const app = new App();', "Tags.of(app).add('CommitSha', 'abc123');"].join('\n');

        expect(tagsEnvironmentOnApp(wrongReceiver, 'a.ts')).toBe(false);
        expect(tagsEnvironmentOnApp(wrongKey, 'b.ts')).toBe(false);
    });
});
