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
 * ## Why exact SET EQUALITY over GRANTEES, and why it is bidirectional
 *
 * Same shape as `natEgressConsumers.test.ts`, for the same reason: the drift that matters is an ADDITION
 * nobody noticed. A second `bedrock:InvokeModel` grantee — for an embedding model, for a tier-4 rewrite in
 * another service, for a one-off backfill script — puts that spend entirely OUTSIDE the counter, which counts
 * verification `Converse` calls and nothing else. Migration `0021`'s own header records the moment this
 * nearly happened: it declines to build an embeddings table partly because "calling Bedrock from
 * recipe-service (Fargate) would add a SECOND `bedrock:InvokeModel` grantee".
 *
 * The reverse direction matters too: a grant this file still expects after the function is deleted is the
 * same defect pointing the other way, and would leave the next reader believing a control exists. That is the
 * VACUITY floor, and it is a separate verdict from the grantee count rather than the same one.
 *
 * ⚠️ The set is over GRANTEES and their ACTIONS — never over the number of policy STATEMENTS. An earlier
 * version asserted `grants.length === 1` and then read `grants[0]`, which is three defects in one line:
 *
 *  1. It failed a SECOND statement on the SAME role — one grantee, no bypass, nothing outside the counter —
 *     under a message announcing that the gate had stopped discovering. That names the opposite of the cause,
 *     and sends the reader looking for a broken parser instead of at their own diff.
 *  2. It left every grant after the first entirely unread: its grantee and its actions were never judged. So
 *     the moment the statement count was allowed to move, a widened second statement produced NO breach at
 *     all — measured, not reasoned: the streaming fake below returned `[]` against that shape.
 *  3. It therefore constrained the IAM SHAPE rather than the security invariant, which is backwards, and is
 *     what blocked adopting AWS's documented least-privilege shape for inference profiles (a model ARN and a
 *     profile ARN want two statements, one role).
 *
 * Grantee identity is the invariant. Statement count is a stylistic accident of how the policy is written.
 *
 * ## Why the PARSER and not grep
 *
 * `bedrock:InvokeModel` and `reservedConcurrentExecutions` both appear in PROSE in these same files — this
 * gate's own reasoning is quoted in `RecipeWorkersStack.ts`'s comments, and `0021_resolution_mappings.sql`
 * discusses the grant at length. A text search cannot tell a policy statement from a paragraph explaining why
 * there is only one. Same reasoning as `serviceSources.ts`: parsing means comments are comments.
 *
 * DESIGN PATTERN: Specification module over one parser — {@link bedrockGrantsIn} and
 * {@link reservedConcurrencyIn} are pure readings of a source file, and {@link bedrockGrantBreaches} is the
 * pure VERDICT over what they read. Splitting the verdict out of the `expect` calls is what lets layer 4b's
 * judgement be fired at deliberately violating fakes below, and not only at the working tree — the reading
 * was already testable that way; the judgement was not, which is how it stayed wrong.
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

/**
 * How that role is REFERRED TO where its policy statements are added.
 *
 * A rename lands here as a one-line edit and a red run, which is the point of pinning it: the grantee set is
 * read from source text, so the gate must say which text it expects rather than accept whatever it finds.
 */
const SOLE_BEDROCK_GRANTEE_REFERENCE = 'verificationRole';

/**
 * The one action that role may hold.
 *
 * `InvokeModelWithResponseStream` is deliberately absent: the gate never streams, and a streamed response
 * would defeat its single-response settlement. `bedrock:*` would additionally authorize model management and
 * provisioned throughput on the role that already holds the spend counter.
 */
const SOLE_BEDROCK_ACTION = 'bedrock:InvokeModel';

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

/** One way a set of discovered grants breaches ADR-0024 layer 4b. */
export interface BedrockGrantBreach {
    /**
     * Which of the three things layer 4b forbids.
     *
     * `no-grant-discovered` is the VACUITY floor and is deliberately its own kind rather than a special case
     * of the grantee count: "the parser stopped finding grants" and "a second role holds the permission" are
     * opposite failures with opposite repairs, and reporting one under the other's message is the defect this
     * verdict replaced.
     */
    readonly kind: 'no-grant-discovered' | 'second-grantee' | 'action-wider-than-invoke-model';
    /** The evidence, so the failure names what was actually found. */
    readonly detail: string;
}

/**
 * ADR-0024 layer 4b's verdict over EVERY bedrock grant discovered across the tree.
 *
 * The invariant is over GRANTEES and ACTIONS — never over the number of policy STATEMENTS. Two statements on
 * one role are one grantee and therefore no bypass; one statement on each of two roles is the bypass, whatever
 * the total happens to be. Every discovered grant is judged, because the addition this gate exists to catch
 * arrives just as easily as a second statement as it does as a second file.
 *
 * ⚠️ Grantee identity is the reference text exactly as written (`verificationRole`, `this.verificationRole`),
 * NOT a normalised last segment. Normalising would merge `workers.role` with `service.role` — two roles read
 * as one, a false GREEN on precisely the bypass. Writing the same role two ways instead costs a false RED,
 * which a human reads and corrects.
 *
 * @param grants - Every bedrock grant found in the tree (or in a fake standing in for it).
 * @returns The breaches, empty when layer 4b holds. Pure.
 */
export function bedrockGrantBreaches(grants: readonly BedrockGrant[]): readonly BedrockGrantBreach[] {
    const breaches: BedrockGrantBreach[] = [];

    if (grants.length === 0) {
        breaches.push({
            kind: 'no-grant-discovered',
            detail: 'no bedrock grant found anywhere — the gate has stopped discovering, so it proves nothing',
        });
    }

    const grantees = [...new Set(grants.map(({ grantee }) => grantee))].sort();

    if (grantees.length > 1) {
        breaches.push({
            kind: 'second-grantee',
            detail: `bedrock actions are granted to ${grantees.length} roles: ${grantees.join(', ')}`,
        });
    }

    for (const { file, grantee, actions } of grants) {
        const wider = actions.filter((action) => action !== SOLE_BEDROCK_ACTION);

        if (wider.length > 0) {
            breaches.push({
                kind: 'action-wider-than-invoke-model',
                detail: `${file} grants ${grantee} more than ${SOLE_BEDROCK_ACTION}: ${wider.join(', ')}`,
            });
        }
    }

    return breaches;
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

/**
 * The whole pipeline — parser then verdict — over deliberately violating fake sources.
 *
 * @param fakes - Fake infra sources, standing in for the tree.
 * @returns The breach kinds, in verdict order. Pure.
 */
function breachKindsOf(...fakes: readonly SourceFile[]): readonly BedrockGrantBreach['kind'][] {
    return bedrockGrantBreaches(fakes.flatMap((fake) => bedrockGrantsIn(fake))).map(({ kind }) => kind);
}

describe('ADR-0024 layer 4b — who may invoke a model', () => {
    it('grants bedrock actions to EXACTLY ONE role, and only InvokeModel, across the whole tree', () => {
        const grants = infraSources().flatMap((source) => bedrockGrantsIn(source));

        // Every breach is reported at once rather than one assertion at a time, so a diff that both moves the
        // grant and widens it says so in one run instead of hiding the second defect behind the first.
        expect(bedrockGrantBreaches(grants), 'ADR-0024 layer 4b is breached in the working tree').toEqual([]);
    });

    it('pins WHICH role holds it and WHERE — so a wholesale move is still a failure', () => {
        const grants = infraSources().flatMap((source) => bedrockGrantsIn(source));

        // The verdict above says "one grantee"; this says WHICH — so moving the grant wholesale to another
        // role stays a failure rather than a silently still-compliant set of one.
        expect([...new Set(grants.map(({ grantee }) => grantee))]).toEqual([SOLE_BEDROCK_GRANTEE_REFERENCE]);
        expect(grants.filter(({ file }) => !file.includes('recipe-workers'))).toEqual([]);
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

    it('accepts TWO statements on the SAME role — one grantee, so no bypass', () => {
        expect(
            breachKindsOf({
                file: 'fake/SameRole.ts',
                contents: `
                    verificationRole.addToPolicy(new iam.PolicyStatement({
                        actions: ['bedrock:InvokeModel'],
                        resources: [foundationModelArn],
                    }));
                    verificationRole.addToPolicy(new iam.PolicyStatement({
                        actions: ['bedrock:InvokeModel'],
                        resources: [inferenceProfileArn],
                    }));
                `,
            }),
        ).toEqual([]);
    });

    it('rejects a second statement on a DIFFERENT role, which is the real bypass', () => {
        expect(
            breachKindsOf(
                {
                    file: 'fake/recipe-workers/Verifier.ts',
                    contents: `
                        verificationRole.addToPolicy(new iam.PolicyStatement({
                            actions: ['bedrock:InvokeModel'],
                            resources: [foundationModelArn],
                        }));
                    `,
                },
                {
                    file: 'fake/recipe/Embeddings.ts',
                    contents: `
                        embeddingRole.addToPolicy(new iam.PolicyStatement({
                            actions: ['bedrock:InvokeModel'],
                            resources: ['*'],
                        }));
                    `,
                },
            ),
        ).toEqual(['second-grantee']);
    });

    it('rejects a WIDER action on the SECOND statement, which reading only the first would miss', () => {
        expect(
            breachKindsOf({
                file: 'fake/Streaming.ts',
                contents: `
                    verificationRole.addToPolicy(new iam.PolicyStatement({
                        actions: ['bedrock:InvokeModel'],
                        resources: [foundationModelArn],
                    }));
                    verificationRole.addToPolicy(new iam.PolicyStatement({
                        actions: ['bedrock:InvokeModelWithResponseStream'],
                        resources: [foundationModelArn],
                    }));
                `,
            }),
        ).toEqual(['action-wider-than-invoke-model']);
    });

    it('rejects a wildcard action wherever it sits', () => {
        expect(
            breachKindsOf({
                file: 'fake/Wildcard.ts',
                contents: `
                    verificationRole.addToPolicy(new iam.PolicyStatement({
                        actions: ['bedrock:*'],
                        resources: ['*'],
                    }));
                `,
            }),
        ).toEqual(['action-wider-than-invoke-model']);
    });

    it('rejects a tree with NO grant at all — the gate has stopped discovering', () => {
        expect(
            breachKindsOf({
                file: 'fake/NoBedrock.ts',
                contents: `
                    verificationRole.addToPolicy(new iam.PolicyStatement({
                        actions: ['ssm:GetParameters'],
                        resources: [ceilingParameterArn],
                    }));
                `,
            }),
        ).toEqual(['no-grant-discovered']);
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
