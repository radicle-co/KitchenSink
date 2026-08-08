// ⚠️ DELIBERATE — see docs/architecture/decisions/0013-cdk-nag-advisory-iac-security-linting.md
// (AwsSolutions-L1) and `__tests__/lambda-runtime.test.ts`, which keeps this pin from falling behind.
//
// THE Node runtime every Lambda in this repository runs on. One value, one place.
//
// ## Why this is a security concern, and therefore lives in @kitchensink/infra-security
//
// `AwsSolutions-L1` ("the non-container Lambda function is not configured to use the latest runtime
// version") is a supply-chain/patching control: a runtime past its support window stops receiving security
// patches for Node itself and for the OS image beneath it. The pin IS that control, so it belongs with the
// package that owns the repo's IaC security posture — which is also, conveniently, the one package every CDK
// app already depends on (each `bin/app.ts` calls `attachSecurityChecks`), so centralising here needs no new
// dependency edge.
//
// ## Why one constant rather than a literal per stack
//
// The Node runtime is ONE piece of knowledge with ONE reason to change (the repo moves Node major), and it
// was spelled out at seven separate declaration sites across five CDK apps. That duplication is exactly how
// the state this fixes arose: the root `package.json` pins `engines.node: 24.x` — so every test, lint and
// local command runs on Node 24 — while all nineteen deployed Lambdas ran `nodejs22.x`. The code was
// verified on one Node major and executed on another, and cdk-nag was reporting it nineteen times.
//
// ## Why an explicit literal and NOT `Runtime.NODEJS_LATEST`
//
// `Runtime.NODEJS_LATEST` and `determineLatestNodeRuntime()` are MOVING aliases. Using one would make a
// routine `aws-cdk-lib` bump silently re-target every deployed Lambda to a new Node major — and a major is
// precisely where native-module and removed-API breakage lives. Same reasoning as ADR-0002's explicit prod
// VPC CIDR: pin the value, and let a test assert it has not drifted. The next CDK bump that ships a newer
// Node runtime therefore fails `lambda-runtime.test.ts` instead of silently changing production, which turns
// ADR-0013's "recurring, low-value 19-finding block of noise" into one actionable decision point.
//
// ⚠️ NOT every Lambda in the synthesized output is ours. `custom_resources.Provider` builds its own
// framework function with `lambda.determineLatestNodeRuntime(this)` and exposes no runtime prop, so the two
// `framework-onEvent` functions in `DataStack` keep reporting L1 until `aws-cdk-lib` moves its own alias.
// Those findings are left REPORTING on purpose: they are accurate, they are not ours to fix, they clear
// themselves on a CDK bump, and suppressing them would write template metadata onto the prod data stack in
// exchange for hiding a genuinely stale runtime later.
import { Runtime } from 'aws-cdk-lib/aws-lambda';

/**
 * The Node.js Lambda runtime for every function this repository defines.
 *
 * Kept equal to the newest Node runtime the installed `aws-cdk-lib` knows about (which is exactly what
 * `AwsSolutions-L1` measures) AND to the repo-wide `engines.node` major, both asserted by
 * `__tests__/lambda-runtime.test.ts`.
 */
export const NODE_LAMBDA_RUNTIME: Runtime = Runtime.NODEJS_24_X;

/**
 * The newest `nodejs*` runtime present in the installed `aws-cdk-lib`, selected the way `AwsSolutions-L1`
 * selects it.
 *
 * This deliberately mirrors cdk-nag's `LambdaLatestVersion` rule: filter `Runtime.ALL` to the `nodejs`
 * family, sort by the version substring with numeric collation, and take the last. Reimplementing the
 * selection is what lets a test assert the pin is current; the test then ALSO asserts the answer through the
 * real cdk-nag pack, so this copy cannot silently disagree with the rule it models.
 *
 * @returns The runtime name, e.g. `nodejs24.x`. Pure.
 */
export function latestNodeRuntimeKnownToCdk(): string {
    const versionOf = /^nodejs(?<version>\d+(\.\d+|\.x)?)?$/u;
    const candidates = Runtime.ALL.map((runtime) => runtime.name)
        .flatMap((name) => {
            const version = versionOf.exec(name)?.groups?.['version'];

            return version === undefined ? [] : [{ name, version }];
        })
        .sort((left, right) => left.version.localeCompare(right.version, undefined, { numeric: true }));
    const latest = candidates.at(-1);

    if (!latest) {
        throw new Error('lambda-runtime: aws-cdk-lib exposes no versioned nodejs runtime, which cannot happen');
    }

    return latest.name;
}
