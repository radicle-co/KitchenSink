// @vitest-environment node
/**
 * ADR-0004's NAT consumer list is a PREMISE other decisions are made on, so it is asserted rather than
 * described.
 *
 * ## Why this gate exists
 *
 * ADR-0004 minimised NAT membership to "the irreducible set" and then wrote that set down in prose: the
 * three DB-bound identity webhook Lambdas plus the schema-migration runner. That was true the day it was
 * written. It stopped being true the moment `recipe-workers` shipped seven VPC-attached Lambdas of its own,
 * ADR-0022 gave every DB-touching stack a migration runner, and `DataStack` grew two bootstrap Lambdas —
 * and nothing failed, because a prose list cannot go red.
 *
 * The cost of that drift is not tidiness. A stale premise gets REUSED. Feature 004's verification gate was
 * designed around a `bedrock-runtime` VPC interface endpoint whose entire justification was "so the call
 * does not widen ADR-0004's four-consumer list" — an endpoint priced at $0.01 per AZ-hour, which at
 * `maxAzs: 2` is $14.60/month/stage to carry $0.27/month of inference, against a NAT instance the calling
 * Lambda was ALREADY attached to. The decision was sound reasoning applied to a fact that had expired.
 *
 * ## What is asserted, and why it is bidirectional
 *
 * The set of VPC-attached Lambdas is DISCOVERED from the infra tree and compared for exact equality against
 * the list ADR-0004 publishes between its `nat-consumers` markers. Both directions matter: an addition the
 * ADR does not know about is the drift above, and a name the ADR still claims after the function is deleted
 * is the same defect pointing the other way. Neither side is allowed to be the authority alone.
 *
 * VPC attachment is the right proxy for NAT membership because of ADR-0004's own finding: a VPC Lambda's
 * only outbound paths are a NAT or a VPC endpoint, and `assignPublicIp` does nothing for Lambda. The second
 * half of that disjunction is why {@link interfaceEndpointsIn} is gated too — with no interface endpoint
 * anywhere in the tree, VPC-attached and NAT-consuming are the same set. Gateway endpoints are deliberately
 * NOT gated: they are free, and S3/DynamoDB traffic leaving the NAT is a cost this ADR would rather avoid.
 *
 * ## Why the PARSER and not grep
 *
 * The strings this gate looks for all appear in prose in the same files — `InterfaceVpcEndpoint` is named in
 * the comment explaining why one is not created, and every `vpc` mention in a docstring would count as an
 * attachment. Same reasoning as `serviceSources.ts`: parsing means comments are comments.
 *
 * ⚠️ Shorthand properties are read here, unlike {@link objectProperties}. `recipe-workers` writes `vpc,` and
 * `vpcSubnets,` rather than `vpc: vpc` — a gate that skipped shorthand would find zero consumers in the
 * stack that owns seven of them and pass vacuously, which is the exact failure mode this file exists to
 * prevent.
 *
 * DESIGN PATTERN: Specification module over one parser — {@link natConsumersIn} and
 * {@link interfaceEndpointsIn} are pure verdicts over a source file, so each is fired at a deliberately
 * violating fake below rather than only at the working tree.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { parse, referenceText, repoRoot, trackedFiles, visit, type SourceFile } from './serviceSources.js';

/** The ADR whose consumer list this gate keeps honest. */
const ADR = 'docs/architecture/decisions/0004-minimize-nat-egress.md';

/** Delimits the machine-checked list inside {@link ADR}. Prose outside them is free to say anything. */
const LIST_START = '<!-- nat-consumers:start -->';
const LIST_END = '<!-- nat-consumers:end -->';

/** One Lambda whose only egress is the shared NAT instance. */
interface NatConsumer {
    /** Repo-relative path of the stack that declares it. */
    readonly file: string;
    /** The CDK construct id, which is what the ADR lists. */
    readonly construct: string;
}

/**
 * Every property NAME on an object literal, shorthand included.
 *
 * @param node - The object literal.
 * @returns The names present, whatever their initializer.
 */
function propertyNames(node: ts.ObjectLiteralExpression): ReadonlySet<string> {
    const names = new Set<string>();

    for (const property of node.properties) {
        if (
            (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) &&
            ts.isIdentifier(property.name)
        ) {
            names.add(property.name.text);
        }
    }

    return names;
}

/**
 * The VPC-attached Lambdas declared in one infra source.
 *
 * Any constructor whose name ends in `Function` counts — `lambda.Function`, `NodejsFunction` and
 * `triggers.TriggerFunction` are all Lambdas, and a gate that enumerated the three would miss the fourth.
 *
 * @param source - One infra source file.
 * @returns The consumers it declares, in source order. Pure.
 */
function natConsumersIn(source: SourceFile): readonly NatConsumer[] {
    const consumers: NatConsumer[] = [];

    visit(parse(source), (node) => {
        if (!ts.isNewExpression(node)) {
            return;
        }

        const callee = referenceText(node.expression);
        const [scope, id, props] = node.arguments ?? [];

        if (
            callee?.endsWith('Function') !== true ||
            scope?.kind !== ts.SyntaxKind.ThisKeyword ||
            id === undefined ||
            !ts.isStringLiteral(id) ||
            props === undefined ||
            !ts.isObjectLiteralExpression(props) ||
            !propertyNames(props).has('vpc')
        ) {
            return;
        }

        consumers.push({ file: source.file, construct: id.text });
    });

    return consumers;
}

/**
 * The interface VPC endpoints declared in one infra source.
 *
 * Both spellings CDK offers: the construct, and the `Vpc` convenience method.
 *
 * @param source - One infra source file.
 * @returns A description per endpoint found, in source order. Pure.
 */
function interfaceEndpointsIn(source: SourceFile): readonly string[] {
    const endpoints: string[] = [];

    visit(parse(source), (node) => {
        if (ts.isNewExpression(node) && referenceText(node.expression)?.endsWith('InterfaceVpcEndpoint') === true) {
            endpoints.push(`${source.file}: new ${referenceText(node.expression) ?? '?'}`);
        }

        if (ts.isCallExpression(node) && referenceText(node.expression)?.endsWith('.addInterfaceEndpoint') === true) {
            endpoints.push(`${source.file}: ${referenceText(node.expression) ?? '?'}()`);
        }
    });

    return endpoints;
}

/**
 * Every CDK stack source in the repo.
 *
 * Discovered from `git ls-files`, never enumerated, so a service that lands tomorrow is covered the day its
 * stack does and cannot opt out by not being mentioned here.
 *
 * @returns The infra sources, read. Impure.
 * @sideEffect Shells out to git and reads the working tree.
 */
function infraSources(): readonly SourceFile[] {
    return [...trackedFiles('packages/services'), ...trackedFiles('packages/infra')]
        .filter((file) => /(?:^|\/)infra\/lib\//.test(file) || /^packages\/infra\/[^/]+\/lib\//.test(file))
        .filter((file) => file.endsWith('.ts') && !file.endsWith('.d.ts'))
        .map((file) => ({ file, contents: readFileSync(path.join(repoRoot, file), 'utf8') }));
}

/**
 * The construct ids ADR-0004 publishes as its consumer list.
 *
 * Read from the backticked identifiers between the markers, so the surrounding table can be reformatted
 * without touching this gate.
 *
 * @returns The names the ADR claims. Impure.
 * @sideEffect Reads the ADR.
 */
function documentedConsumers(): ReadonlySet<string> {
    const text = readFileSync(path.join(repoRoot, ADR), 'utf8');
    const start = text.indexOf(LIST_START);
    const end = text.indexOf(LIST_END);

    expect(
        start >= 0 && end > start,
        `${ADR} must publish its consumer list between ${LIST_START} and ${LIST_END}`,
    ).toBe(true);

    return new Set([...text.slice(start, end).matchAll(/`([A-Za-z][A-Za-z0-9]*)`/g)].map(([, name]) => name ?? ''));
}

describe('NAT egress consumers', () => {
    it('are exactly the set ADR-0004 publishes', () => {
        const discovered = infraSources().flatMap((source) => natConsumersIn(source));

        expect(discovered.length, 'no VPC-attached Lambda found — the gate has stopped discovering').toBeGreaterThan(0);

        // Sorted names on both sides, so the diff a failure prints names the function that moved.
        expect([...new Set(discovered.map(({ construct }) => construct))].sort()).toEqual(
            [...documentedConsumers()].sort(),
        );
    });

    it('have no VPC interface endpoint to route around the NAT', () => {
        // ⛔ An interface endpoint costs $0.01 per AZ-hour — $14.60/month/stage at `maxAzs: 2` — which is
        // several times the whole `t4g.nano` NAT instance it would be avoiding. Adding one is a cost
        // decision that belongs in ADR-0004, not in a service stack. Update the ADR, then this gate.
        expect(infraSources().flatMap((source) => interfaceEndpointsIn(source))).toEqual([]);
    });

    it('detects an attachment written with shorthand properties', () => {
        const found = natConsumersIn({
            file: 'fake/Shorthand.ts',
            contents: `
                const vpc = 1;
                const vpcSubnets = 2;
                new lambda.Function(this, 'ShorthandFunction', { vpc, vpcSubnets });
                new lambda.Function(this, 'NonVpcFunction', { runtime });
            `,
        });

        expect(found.map(({ construct }) => construct)).toEqual(['ShorthandFunction']);
    });

    it('reads an endpoint from code but not from the prose explaining its absence', () => {
        expect(
            interfaceEndpointsIn({
                file: 'fake/Prose.ts',
                contents: `
                    /** We deliberately create no InterfaceVpcEndpoint here; see ADR-0004. */
                    const note = 'vpc.addInterfaceEndpoint is not called';
                `,
            }),
        ).toEqual([]);

        expect(
            interfaceEndpointsIn({
                file: 'fake/Real.ts',
                contents: `vpc.addInterfaceEndpoint('Bedrock', { service: svc });`,
            }),
        ).toHaveLength(1);
    });
});
