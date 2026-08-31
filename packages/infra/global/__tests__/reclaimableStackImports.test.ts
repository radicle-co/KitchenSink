// @vitest-environment node
/**
 * Repo-wide guard: no PERSISTENT stack may import from a RECLAIMABLE one.
 *
 * ## The defect this exists to make impossible
 *
 * ADR-0028's 2026-08-30 amendment made `kitchensink-identity-service-{stage}` reclaimable — deleted with the
 * sandbox tier and rebuilt by the button — in order to release the ALB it pins. The design was reviewed by
 * measuring what imports the ALB's exports, found exactly one importer, and concluded the chain was one
 * stack deep.
 *
 * The first real run disproved it:
 *
 *     Delete canceled. Cannot delete export
 *       kitchensink-identity-service-sandbox:IdentityServiceLogGroupName
 *     as it is in use by kitchensink-identity-webhooks-sandbox.
 *
 * The identity service stack has nine exports of its own, and `WebhooksStack` imported one of them to hang a
 * log-drain `SubscriptionFilter` on the ECS log group. So a stack that must SURVIVE imported from a stack
 * that must be DELETABLE, and CloudFormation enforces that as a hard refusal.
 *
 * The lesson is not "check both directions once". It is that reclaimability is a property of a stack that
 * every other stack's imports must respect, and prose cannot hold that — the ADR said one stack deep and was
 * wrong, in a document written specifically to get this right. So the direction is asserted from the CDK
 * SOURCE, in the same spirit as `natEgressConsumers.test.ts`: a claim about the shape of the system, checked
 * rather than described.
 *
 * ## What is asserted
 *
 * For every stack in {@link RECLAIMABLE_EXPORT_PREFIXES} — the stacks `sandbox-shared-tier.sh` deletes — no
 * persistent stack may pass its export name to `Fn.importValue`. Source, not a synthesized template,
 * because the failure is authored in source and a reviewer reads source; a template check would also miss
 * the per-PR stages that never synthesize here.
 *
 * ⛔ PARSED, not grepped — and the first draft of this file WAS grepped, which is why the rule is repeated
 * here. `WebhooksStack`'s comment explaining what it no longer imports quotes the old export name verbatim,
 * so a text scan flagged the very comment documenting the fix. `natEgressConsumers.test.ts` records exactly
 * this trap ("parsing means comments are comments"); its parser is reused rather than re-derived.
 *
 * ⚠️ Deliberately one-directional. A RECLAIMABLE stack importing from a PERSISTENT one is correct and
 * common — the identity service imports the ALB listener ARN and the shared log group name, and must keep
 * doing so. Only the reverse is the defect.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { parse, referenceText, repoRoot, trackedFiles, visit } from './serviceSources.js';

/**
 * Export-name prefixes belonging to stacks the sandbox reclaim DELETES.
 *
 * Kept in step with `.github/scripts/sandbox-shared-tier.sh`'s allowlist by the last assertion below, so
 * the two cannot drift.
 */
const RECLAIMABLE_EXPORT_PREFIXES = ['kitchensink-identity-service-', 'kitchensink-alb-'];

/** Infra directories whose stacks are never deleted by the sandbox reclaim. */
const PERSISTENT_INFRA_DIRS = ['packages/services/identity-webhooks/infra/lib', 'packages/infra/global/lib'];

/**
 * Every export name passed to `Fn.importValue(...)` in a file, as authored.
 *
 * A template literal is returned with its substitutions intact
 * (`kitchensink-identity-service-${stage}:Foo`) — that is the form the real offender used, and the prefix
 * check only needs the leading literal chunk.
 *
 * @param file - Repo-relative path.
 * @returns The imported export names. Pure.
 */
function importedExportsIn(file: string): string[] {
    const contents = readFileSync(path.join(repoRoot, file), 'utf8');
    const source = parse({ file, contents });
    const names: string[] = [];

    visit(source, (node) => {
        if (!ts.isCallExpression(node) || referenceText(node.expression) !== 'Fn.importValue') {
            return;
        }

        const [argument] = node.arguments;

        if (argument === undefined) {
            return;
        }

        if (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument)) {
            names.push(argument.text);
        } else if (ts.isTemplateExpression(argument)) {
            // Reconstruct with substitutions as written, so a prefix check sees the literal head.
            names.push(argument.getText(source).replace(/^`|`$/gu, ''));
        }
    });

    return names;
}

/** Every tracked `.ts` file under the persistent infra directories, excluding built output. */
const persistentSources = (): readonly string[] =>
    PERSISTENT_INFRA_DIRS.flatMap((dir) => trackedFiles(dir)).filter(
        (file) => file.endsWith('.ts') && !file.includes('/dist/'),
    );

describe('no persistent stack imports from a reclaimable one (ADR-0028)', () => {
    const offenders = persistentSources().flatMap((file) =>
        importedExportsIn(file)
            .filter((exportName) => RECLAIMABLE_EXPORT_PREFIXES.some((prefix) => exportName.startsWith(prefix)))
            .map((exportName) => `${file} imports ${exportName}`),
    );

    it('finds no persistent stack importing a reclaimable stack export', () => {
        expect(offenders).toEqual([]);
    });

    it('is not vacuous — the scan reaches real Fn.importValue calls in the persistent stacks', () => {
        const allImports = persistentSources().flatMap((file) => importedExportsIn(file));

        expect(allImports.length).toBeGreaterThan(0);
    });

    it('ignores a comment that merely QUOTES a reclaimable export name', () => {
        // WebhooksStack's comment documenting the fix quotes the old import verbatim. A grep-based draft
        // of this guard flagged it; the parser must not.
        const webhooks = 'packages/services/identity-webhooks/infra/lib/WebhooksStack.ts';
        const contents = readFileSync(path.join(repoRoot, webhooks), 'utf8');

        expect(contents).toContain('kitchensink-identity-service-');
        expect(importedExportsIn(webhooks).filter((name) => name.startsWith('kitchensink-identity-service-'))).toEqual(
            [],
        );
    });

    it('would catch the exact import that blocked the first reclaim', () => {
        const reintroduced = 'kitchensink-identity-service-${deployStage}:IdentityServiceLogGroupName';

        expect(RECLAIMABLE_EXPORT_PREFIXES.some((prefix) => reintroduced.startsWith(prefix))).toBe(true);
    });

    it('covers exactly the stacks the teardown script deletes, so the two cannot drift', () => {
        const allowlist = readFileSync(path.join(repoRoot, '.github/scripts/sandbox-shared-tier.sh'), 'utf8');
        const deleted = [...allowlist.matchAll(/^\s+'(kitchensink-[a-z-]+)'$/gmu)].map((match) => match[1] ?? '');

        expect(deleted.length).toBeGreaterThan(0);

        for (const stack of deleted) {
            expect(RECLAIMABLE_EXPORT_PREFIXES.some((prefix) => stack.startsWith(prefix))).toBe(true);
        }
    });
});
