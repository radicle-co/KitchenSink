/**
 * @module appProps — the ONE seam that puts a stage CDK app on KitchenSink's bootstrap qualifier and under its
 * permissions boundary.
 *
 * Every stage app is `new App(kitchenSinkAppProps(stage))`. The qualifier decides which bootstrap roles and asset
 * bucket the app deploys through; the boundary caps every IAM role its stacks create. Both are derived from the
 * stage here, so no app carries a qualifier literal and a stage cannot be deployed through the wrong tier.
 *
 * ## Why plain context and not `DefaultStackSynthesizer` / `PermissionsBoundary` objects
 *
 * This package is CDK-free on purpose. CDK apps live outside the npm workspace and each resolves its own single
 * `aws-cdk-lib` (two instances break `instanceof` and token resolution), so a workspace package cannot import the
 * library without either dragging 149 MB into the root tree or handing the app objects from a second copy. The CDK
 * reads exactly these two context keys itself: `DefaultStackSynthesizer` takes its qualifier from
 * `@aws-cdk/core:bootstrapQualifier`, and `PermissionsBoundary.fromName(name)` is a setter for
 * `@aws-cdk/core:permissionsBoundary`. Passing the data is the same wiring without the second library instance.
 *
 * ## Why `postCliContext`
 *
 * Plain `context` loses to `cdk deploy -c ...` and to `cdk.json`. `postCliContext` is applied after both, so
 * neither can redirect a stage to another qualifier: that would be a prod stage deployed through the nonprod
 * execution role, or the reverse.
 *
 * @pattern Factory — one function builds the app props every entrypoint shares
 * @pattern Strategy by stage — the qualifier and boundary follow `qualifierForStage`
 */
import { isRecord } from './json.js';
import { QUALIFIERS, boundaryPolicyName, qualifierForStage } from './qualifiers.js';

/** The CDK context key the default synthesizer reads its qualifier from (`BOOTSTRAP_QUALIFIER_CONTEXT`). */
const BOOTSTRAP_QUALIFIER_CONTEXT = '@aws-cdk/core:bootstrapQualifier';

/** The CDK context key `PermissionsBoundary` sets (`PERMISSIONS_BOUNDARY_CONTEXT_KEY`). */
const PERMISSIONS_BOUNDARY_CONTEXT = '@aws-cdk/core:permissionsBoundary';

/** The environment variable through which the CDK CLI hands its `-c` and `cdk.json` context to the app. */
const CDK_CONTEXT_ENV = 'CDK_CONTEXT_JSON';

/** The shape `new App(...)` accepts for the part this module owns. */
export interface KitchenSinkAppProps {
    readonly postCliContext: Readonly<Record<string, unknown>>;
}

/**
 * The `App` props for one stage.
 *
 * @param stage - The CDK stage (`prod`, `sandbox`, `pr-{N}`, ...).
 * @returns Props to pass to `new App(...)`. Pure.
 * @throws When the stage is empty.
 */
export function kitchenSinkAppProps(stage: string): KitchenSinkAppProps {
    const qualifier = qualifierForStage(stage);

    return {
        postCliContext: {
            [BOOTSTRAP_QUALIFIER_CONTEXT]: qualifier,
            [PERMISSIONS_BOUNDARY_CONTEXT]: { name: boundaryPolicyName(qualifier) },
        },
    };
}

/**
 * The `App` props of the stage-less ACCOUNT app (`bin/account.ts`): the `ksaccount` qualifier and its boundary.
 *
 * It takes no argument on purpose. The account app has no stage, so nothing can pick another tier for it; a bare
 * `new App()` would instead deploy it through the account's DEFAULT bootstrap, whose execution role is another
 * application's `AdministratorAccess`, which is the path ADR-0065 closes.
 *
 * @returns Props to pass to `new App(...)`. Pure.
 */
export function accountAppProps(): KitchenSinkAppProps {
    return {
        postCliContext: {
            [BOOTSTRAP_QUALIFIER_CONTEXT]: QUALIFIERS.account,
            [PERMISSIONS_BOUNDARY_CONTEXT]: { name: boundaryPolicyName(QUALIFIERS.account) },
        },
    };
}

/**
 * The stage an app was asked to synthesize, read BEFORE the `App` exists.
 *
 * An app used to read `app.node.tryGetContext('stage') ?? process.env.STAGE`. The qualifier must be known to build
 * the `App`, so the same two sources are read here in the same order: the CLI's context (`-c stage=...`, delivered
 * in `CDK_CONTEXT_JSON`), then `STAGE`.
 *
 * @param environment - The process environment.
 * @returns The stage, or undefined when neither source names one (each app keeps its own default). Pure.
 * @throws When `CDK_CONTEXT_JSON` is not valid JSON: the CDK would fail on it too, and guessing a stage is worse.
 */
export function resolveStage(environment: Readonly<Record<string, string | undefined>>): string | undefined {
    const raw = environment[CDK_CONTEXT_ENV];

    if (raw !== undefined && raw !== '') {
        const context: unknown = JSON.parse(raw);
        const fromContext = isRecord(context) ? context['stage'] : undefined;

        if (typeof fromContext === 'string') {
            return fromContext;
        }
    }

    return environment['STAGE'];
}
