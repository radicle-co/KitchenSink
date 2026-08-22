// @vitest-environment node
/**
 * The two BUILD-TIME controls on LLM spend (ADR-0024 layers 2 and 4b), asserted over the whole infra tree.
 *
 * ## Why these two, and why they are guards rather than comments
 *
 * ADR-0024 stacks six layers against a $100/month ceiling. Four of them are runtime behaviour and are tested
 * where they run. Two are not testable at runtime AT ALL, because their whole content is the ABSENCE of
 * something:
 *
 *  - **Layer 4b — `bedrock:InvokeModel` is granted to EXACTLY ONE execution role.** ⛔ The ADR is explicit
 *    that layer 4's EMF dollar metric CANNOT detect a bypass, and that an earlier draft claiming it could was
 *    wrong: the metric is emitted BY the gated path, so a caller that skips the gate emits **nothing**. "A
 *    permission nobody else holds cannot be bypassed; a metric nobody else emits cannot notice." The control
 *    is therefore authorization, and the only place to assert it is the tree that grants it.
 *  - **Layer 2 — `reservedConcurrentExecutions: 1` on the verifier, in EVERY stage.** ⚠️ This is not
 *    decoration. The ceiling is PROD-ONLY by owner ruling, so in sandbox and in every open `pr-{N}` that
 *    single constant is the only thing bounding spend: at ~1s per call it caps the burn at ~86,400 calls/day
 *    ≈ $88/month/stage on Nova Micro. ADR-0024 names raising it as "the one change that makes this ruling
 *    unsafe" — and then supplies no control for it. This is that control.
 *
 * ## Why exact SET EQUALITY, and why it is bidirectional
 *
 * Same shape as `natEgressConsumers.test.ts`, for the same reason: the drift that matters is an ADDITION
 * nobody noticed. A second `bedrock:InvokeModel` grantee — for an embedding model, for a tier-4 rewrite in
 * another service, for a one-off backfill script — puts that spend entirely OUTSIDE the counter, which counts
 * verification `Converse` calls and nothing else. Migration `0021`'s own header records the moment this
 * nearly happened: it declines to build an embeddings table partly because "calling Bedrock from
 * recipe-service (Fargate) would add a SECOND `bedrock:InvokeModel` grantee".
 *
 * The reverse direction matters too: a grant this file still expects after the function is deleted is the
 * same defect pointing the other way, and would leave the next reader believing a control exists.
 *
 * ## Why the PARSER and not grep
 *
 * `bedrock:InvokeModel` and `reservedConcurrentExecutions` both appear in PROSE in these same files — this
 * gate's own reasoning is quoted in `RecipeWorkersStack.ts`'s comments, and `0021_resolution_mappings.sql`
 * discusses the grant at length. A text search cannot tell a policy statement from a paragraph explaining why
 * there is only one. Same reasoning as `serviceSources.ts`: parsing means comments are comments.
 *
 * DESIGN PATTERN: Specification module over one parser — {@link bedrockGrantsIn} and
 * {@link reservedConcurrencyIn} are pure verdicts over a source file, so each is fired at deliberately
 * violating fakes below as well as at the working tree.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import {
    literalText,
    objectProperties,
    parse,
    referenceText,
    repoRoot,
    trackedFiles,
    visit,
} from './serviceSources.js';
import type { SourceFile } from './serviceSources.js';

/** The construct id of the one role ADR-0024 layer 4b permits to invoke a model. */
const SOLE_BEDROCK_GRANTEE = 'IngredientVerificationRole';

/** The construct id of the one function that may call Bedrock. */
const VERIFIER_FUNCTION = 'IngredientVerificationFunction';

/** ADR-0024 layer 2's value. Raising it raises non-prod spend proportionally. */
const REQUIRED_RESERVED_CONCURRENCY = 1;

/** One `bedrock:*` grant found in the tree. */
interface BedrockGrant {
    /** Repo-relative path of the file that declares it. */
    readonly file: string;
    /** The variable the statement was added to, e.g. `verificationRole`. */
    readonly grantee: string;
    /** The actions granted. */
    readonly actions: readonly string[];
}

/** Every string literal inside an array literal expression. */
function arrayLiteralStrings(node: ts.Expression | undefined): readonly string[] {
    return node !== undefined && ts.isArrayLiteralExpression(node)
        ? node.elements.map((element) => literalText(element) ?? '').filter((value) => value !== '')
        : [];
}

/**
 * Every `bedrock:*` IAM grant declared in one infra source.
 *
 * Reads `X.addToPolicy(new iam.PolicyStatement({ actions: [...] }))` and any `new iam.PolicyStatement`
 * carrying a bedrock action, so a grant attached some other way is still seen through the statement.
 *
 * @param source - One infra source file.
 * @returns The grants it declares, in source order. Pure.
 */
export function bedrockGrantsIn(source: SourceFile): readonly BedrockGrant[] {
    const grants: BedrockGrant[] = [];

    visit(parse(source), (node) => {
        if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) {
            return;
        }

        // `role.addToPolicy(...)`, `role.addToPrincipalPolicy(...)`, `fn.addToRolePolicy(...)`.
        if (!/^addTo(Policy|PrincipalPolicy|RolePolicy)$/u.test(node.expression.name.text)) {
            return;
        }

        const [argument] = node.arguments;

        if (argument === undefined || !ts.isNewExpression(argument)) {
            return;
        }

        const [props] = argument.arguments ?? [];

        if (props === undefined || !ts.isObjectLiteralExpression(props)) {
            return;
        }

        const actions = arrayLiteralStrings(objectProperties(props).get('actions'));

        if (!actions.some((action) => action.startsWith('bedrock:'))) {
            return;
        }

        grants.push({
            file: source.file,
            grantee: referenceText(node.expression.expression) ?? '?',
            actions,
        });
    });

    return grants;
}

/**
 * The `reservedConcurrentExecutions` declared for each `*Function` construct in one source.
 *
 * @param source - One infra source file.
 * @returns Construct id to declared value. A function that declares none is absent. Pure.
 */
export function reservedConcurrencyIn(source: SourceFile): ReadonlyMap<string, number> {
    const found = new Map<string, number>();

    visit(parse(source), (node) => {
        if (!ts.isNewExpression(node) || referenceText(node.expression)?.endsWith('Function') !== true) {
            return;
        }

        const [, id, props] = node.arguments ?? [];

        if (
            id === undefined ||
            !ts.isStringLiteral(id) ||
            props === undefined ||
            !ts.isObjectLiteralExpression(props)
        ) {
            return;
        }

        const declared = objectProperties(props).get('reservedConcurrentExecutions');

        // ⚠️ `literalText` is deliberately STRING-only, so it cannot read this. A first version of this gate
        // used it and quietly discovered nothing — passing its own violating fake and, worse, reporting the
        // real function as undeclared. Numeric literals are read directly, and a COMPUTED value (a constant,
        // a per-stage ternary) is left absent on purpose: this gate's claim is that the bound is a literal
        // nobody can vary by stage, so "I could not read it" must fail rather than be interpreted.
        if (declared !== undefined && ts.isNumericLiteral(declared)) {
            found.set(id.text, Number(declared.text));
        }
    });

    return found;
}

/**
 * Every CDK stack source in the repo.
 *
 * Discovered from `git ls-files` rather than enumerated, so a service that lands tomorrow is covered the day
 * its stack does and cannot opt out by not being mentioned here.
 *
 * @returns The infra sources, read. Impure.
 * @sideEffect Shells out to git and reads the working tree.
 */
function infraSources(): readonly SourceFile[] {
    return [...trackedFiles('packages/services'), ...trackedFiles('packages/infra')]
        .filter((file) => /(?:^|\/)infra\/lib\//u.test(file) || /^packages\/infra\/[^/]+\/lib\//u.test(file))
        .filter((file) => file.endsWith('.ts') && !file.endsWith('.d.ts'))
        .map((file) => ({ file, contents: readFileSync(path.join(repoRoot, file), 'utf8') }));
}

describe('ADR-0024 layer 4b — who may invoke a model', () => {
    it('grants bedrock:InvokeModel to EXACTLY ONE role, across the whole tree', () => {
        const grants = infraSources().flatMap((source) => bedrockGrantsIn(source));

        // ⛔ The gate has stopped discovering if this is empty — which would make the assertion below pass
        // vacuously, i.e. report "exactly the right grantees" over nothing at all.
        expect(grants.length, 'no bedrock grant found anywhere — the gate has stopped discovering').toBe(1);

        const [grant] = grants;

        expect(grant?.grantee).toContain('verificationRole');
        expect(grant?.file).toContain('recipe-workers');
    });

    it('grants only InvokeModel — never a streaming or wildcard action', () => {
        // `InvokeModelWithResponseStream` is deliberately absent: the gate never streams, and a streamed
        // response would defeat its single-response settlement. `bedrock:*` would additionally authorize
        // model management and provisioned throughput on the role that already holds the spend counter.
        const [grant] = infraSources().flatMap((source) => bedrockGrantsIn(source));

        expect(grant?.actions).toEqual(['bedrock:InvokeModel']);
    });

    it('names that role in the stack that owns the verifier', () => {
        const stack = infraSources().find((source) => source.file.includes('RecipeWorkersStack'));

        expect(stack?.contents).toContain(SOLE_BEDROCK_GRANTEE);
    });

    it('detects a SECOND grantee added elsewhere', () => {
        const found = bedrockGrantsIn({
            file: 'fake/Second.ts',
            contents: `
                embeddingRole.addToPolicy(new iam.PolicyStatement({
                    actions: ['bedrock:InvokeModel'],
                    resources: ['*'],
                }));
            `,
        });

        expect(found.map(({ grantee }) => grantee)).toEqual(['embeddingRole']);
    });

    it('reads a grant from code but not from the prose explaining why there is only one', () => {
        expect(
            bedrockGrantsIn({
                file: 'fake/Prose.ts',
                contents: `
                    /** Only one role holds bedrock:InvokeModel; see ADR-0024 layer 4b. */
                    const note = "addToPolicy with actions: ['bedrock:InvokeModel'] lives in recipe-workers";
                `,
            }),
        ).toEqual([]);
    });
});

describe('ADR-0024 layer 2 — the burn-rate bound', () => {
    it('pins the verifier at reservedConcurrentExecutions = 1', () => {
        const declared = infraSources()
            .flatMap((source) => [...reservedConcurrencyIn(source)])
            .filter(([id]) => id === VERIFIER_FUNCTION);

        // ⚠️ It is stage-independent BY CONSTRUCTION: the stack sets one literal, so there is no branch a
        // per-stage override could hide in. That is the property being asserted — not "prod is capped", but
        // "no stage is uncapped", which matters precisely because the CEILING is prod-only.
        expect(declared, `${VERIFIER_FUNCTION} must declare reservedConcurrentExecutions`).toHaveLength(1);
        expect(declared[0]?.[1]).toBe(REQUIRED_RESERVED_CONCURRENCY);
    });

    it('detects a raised value', () => {
        const found = reservedConcurrencyIn({
            file: 'fake/Raised.ts',
            contents: `new lambda.Function(this, '${VERIFIER_FUNCTION}', { reservedConcurrentExecutions: 10 });`,
        });

        expect(found.get(VERIFIER_FUNCTION)).toBe(10);
    });

    it('detects the setting being DROPPED, which is the likelier regression', () => {
        // Deleting the line reads as tidying and removes the only bound on non-prod spend. An absent entry
        // fails the length assertion above rather than passing quietly.
        const found = reservedConcurrencyIn({
            file: 'fake/Dropped.ts',
            contents: `new lambda.Function(this, '${VERIFIER_FUNCTION}', { memorySize: 512 });`,
        });

        expect(found.has(VERIFIER_FUNCTION)).toBe(false);
    });
});
