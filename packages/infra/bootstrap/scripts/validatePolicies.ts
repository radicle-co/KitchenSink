/**
 * @module validatePolicies — runs IAM Access Analyzer's `ValidatePolicy` over every managed policy the owner-only
 * policy stack deploys, BEFORE the deploy.
 *
 * CloudFormation's CreatePolicy rejects a document at the very end of a deploy; Access Analyzer says the same
 * things (and more) up front, on the exact rendered documents. The offline guards cover the classes we know
 * (`policyGrammar.test.ts`, `actionCatalogue.test.ts`); this is the authority for the ones we do not.
 *
 * Read-only: `ValidatePolicy` takes a document and returns findings, it creates nothing. Fails on any ERROR or
 * SECURITY_WARNING. Usage: `npx tsx scripts/validatePolicies.ts [account] [region]` with credentials in the
 * environment (the account defaults to the caller's, the region to us-east-1).
 *
 * @sideEffect Spawns the `aws` CLI and writes to stdout.
 */
import { spawnSync } from 'node:child_process';

import { renderedPolicies } from '../src/policySet.js';

interface Finding {
    readonly findingType: string;
    readonly issueCode: string;
    readonly findingDetails: string;
    readonly locations?: readonly unknown[];
}

const FAILING = new Set(['ERROR', 'SECURITY_WARNING']);

function aws(args: readonly string[]): string {
    const result = spawnSync('aws', args, { encoding: 'utf8' });

    if (result.status !== 0) {
        throw new Error(`aws ${args.slice(0, 2).join(' ')} failed: ${result.stderr}`);
    }

    return result.stdout;
}

const account =
    process.argv[2] ??
    (JSON.parse(aws(['sts', 'get-caller-identity', '--output', 'json'])) as { Account: string }).Account;
const region = process.argv[3] ?? 'us-east-1';

let failed = 0;

for (const { name, document } of renderedPolicies({ account, region })) {
    const output = aws([
        'accessanalyzer',
        'validate-policy',
        '--policy-type',
        'IDENTITY_POLICY',
        '--policy-document',
        JSON.stringify(document),
        '--region',
        region,
        '--output',
        'json',
    ]);
    const findings = (JSON.parse(output) as { findings: Finding[] }).findings;
    const bad = findings.filter((finding) => FAILING.has(finding.findingType));

    failed += bad.length;
    console.log(`${bad.length === 0 ? 'ok  ' : 'FAIL'} ${name} (${findings.length} findings, ${bad.length} failing)`);

    for (const finding of bad) {
        console.log(`       ${finding.findingType} ${finding.issueCode}: ${finding.findingDetails}`);
        console.log(`       at ${JSON.stringify(finding.locations ?? [])}`);
    }
}

if (failed > 0) {
    console.error(`\n${failed} failing finding(s). Fix the policy tables; do not deploy the policy stack.`);
    process.exit(1);
}

console.log('\nAll policies validate.');
