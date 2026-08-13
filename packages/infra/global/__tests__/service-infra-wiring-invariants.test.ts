// @vitest-environment node
/**
 * Repo-wide guard: the INFRA-TO-RUNTIME WIRING invariants every deployable service must satisfy — enforced
 * against services that DO NOT EXIST YET, not just today's five.
 *
 * ## The class of defect this exists for
 *
 * Every gate here catches the same shape of bug: **the CDK stack and the code it deploys disagree, and nothing
 * fails.** The deploy is green, the template synthesizes, `typecheck` and `lint` pass, and the feature is simply
 * dead — because the permission is missing, the bundle is missing, or the alarm watches a time series nobody
 * writes. Three live examples, all found on one afternoon, all shipped to a real account:
 *
 *  1. `identity-service-stack.ts` injected `DELETION_QUEUE_URL` into the task and granted the task role
 *     `grantConsumeMessages` — while `queue/sqs.service.ts` only ever issues `SendMessageCommand`. Verified
 *     against the DEPLOYED sandbox role: `sqs:ReceiveMessage`, `ChangeMessageVisibility`, `GetQueueUrl`,
 *     `DeleteMessage`, `GetQueueAttributes`, and no `sqs:SendMessage`. Every enqueue was an `AccessDenied`, so
 *     account closure never banned the Clerk user and reactivation never un-banned them — behind a `200`,
 *     because both call sites `await` inside a swallow that logs a warning.
 *  2. `recipe-workers/esbuild.mjs` declared five entry points while the stack deployed six Lambdas. The sixth
 *     shipped as raw `tsc` output (4.6 KB, opening `import { sql } from 'drizzle-orm'`) into an asset with no
 *     `node_modules`, so every cold start was `ERR_MODULE_NOT_FOUND`.
 *  3. `webhooks-stack.ts` alarmed on a DIMENSIONLESS `ErasureIncomplete`, while `emitMetric` publishes every
 *     metric under `Dimensions: [['service', 'metric', …]]`. Confirmed live: both deployed alarms report
 *     `Dimensions: []` and "no datapoints were received". Dead since written.
 *
 * What these have in common is that **the only thing protecting them was a human keeping two files in step.**
 * Two guard tests already existed over (2) and both missed it, because both enumerated the same five handler
 * names the bundler enumerated — a list is not a check when the list is the thing that is wrong.
 *
 * ## Why the subjects are DISCOVERED, never enumerated
 *
 * The service list comes from each service's own `package.json` (see `serviceSources.ts`), so a sixth service
 * is covered the day its manifest lands and cannot opt out by not being mentioned here. Within a service, the
 * subjects of each gate are likewise discovered from the stack — every `*_QUEUE_URL` it injects, every
 * `lambda.Function` it constructs, every `cloudwatch.Alarm` it creates. That is the whole point: the defect in
 * (2) was not the missing entry point, it was the human-maintained list, and replacing it with a second list
 * would reproduce the bug in a new file.
 *
 * ## Why the TypeScript PARSER and not grep
 *
 * ⚠️ A text-matching gate can be defeated by the prose explaining the very thing it checks. That is not
 * hypothetical in this repo: two gates written for `service-security-invariants.test.ts` passed against
 * deliberately-broken code because the comment ABOVE the code contained the words the gate searched for. The
 * risk is acute here — `identity-service-stack.ts` carries a long comment about the deletion queue, and
 * `recipe-workers-stack.ts` names `esbuild.mjs` and its handler strings in prose. Every gate below therefore
 * reads the AST, where comments are trivia and string literals are string literals, and every gate is fired at
 * {@link VIOLATING_SERVICE} — an in-memory fake that breaks all of them at once — so a gate that silently stops
 * matching fails here instead of passing vacuously against a clean tree forever.
 */
import { describe, expect, it } from 'vitest';
import ts from 'typescript';

import {
    type DiscoveredService,
    type SourceFile,
    discoverServices,
    isInfraFile,
    isTestFile,
    literalText,
    moduleSpecifiers,
    objectProperties,
    parse,
    readServiceFile,
    stringLiterals,
    visit,
} from './serviceSources.js';

// ───────────────────────────── shared AST helpers ─────────────────────────────

/**
 * A dotted source-text rendering of a reference expression (`deletionQueue`, `this.archiveQueue`).
 *
 * Hand-written rather than `node.getText()`, which needs `setParentNodes` and the original source: the parse in
 * `serviceSources.ts` deliberately omits parent pointers (they roughly double parse cost across ~1,500 files).
 * Only the reference forms a CDK grant is ever written on are supported; anything else is `undefined`, which
 * every caller treats as "cannot attribute", never as "no grant".
 *
 * @param node - The expression to render.
 * @returns The dotted text, or `undefined` when the expression is not a plain reference chain.
 */
function referenceText(node: ts.Expression): string | undefined {
    if (ts.isIdentifier(node)) {
        return node.text;
    }

    if (node.kind === ts.SyntaxKind.ThisKeyword) {
        return 'this';
    }

    if (ts.isPropertyAccessExpression(node)) {
        const target = referenceText(node.expression);

        return target === undefined ? undefined : `${target}.${node.name.text}`;
    }

    return undefined;
}

/**
 * Every module-level `const NAME = 'literal'` in a file.
 *
 * Infra code routinely hoists the strings an alarm and its emitter must agree on into named constants
 * (`ARCHIVE_METRIC_NAMESPACE`, `OLDEST_PENDING_ARCHIVE_AGE_METRIC_NAME`). A gate that only reads inline literals
 * would silently skip exactly the stacks that were most careful, so identifiers are resolved through this map.
 *
 * @param source - The file to scan.
 * @returns Constant name → literal text.
 */
function stringConstants(source: SourceFile): ReadonlyMap<string, string> {
    const constants = new Map<string, string>();

    visit(parse(source), (node) => {
        if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
            const text = literalText(node.initializer);

            if (text !== undefined) {
                constants.set(node.name.text, text);
            }
        }
    });

    return constants;
}

/**
 * The KEY names of an object-shaped expression, resolving the indirection real stacks use.
 *
 * Handles literals, shorthand (`{ reason }`), spreads (`{ ...base, reason }`), a reference to a `const` object,
 * and a call to a local factory that returns an object literal (`emitterDimensions('X')`).
 *
 * ⚠️ THE FACTORY CASE IS NOT A CONVENIENCE — it is what stops the gate being defeated by good code. The
 * emitter's dimension contract belongs in ONE place in a stack, so the correct fix for the alarm this gate
 * exists for expresses it as a helper; a gate that only understood inline literals would have gone green the
 * moment that helper appeared, while a stack that wrapped a WRONG dimension set in the same helper would also
 * have gone green. Resolving it means the check follows the shape the code actually takes.
 *
 * @param node - The expression to read.
 * @param factories - Local factory/const name → the keys it yields.
 * @returns The key names, or `undefined` when the expression cannot be resolved at all.
 */
function objectKeys(
    node: ts.Expression | undefined,
    factories: ReadonlyMap<string, readonly string[]>,
): readonly string[] | undefined {
    if (node === undefined) {
        return undefined;
    }

    if (ts.isObjectLiteralExpression(node)) {
        const keys: string[] = [];

        for (const property of node.properties) {
            if (ts.isSpreadAssignment(property)) {
                const spread = objectKeys(property.expression, factories);

                if (spread === undefined) {
                    return undefined;
                }

                keys.push(...spread);
                continue;
            }

            const name = property.name;

            if (name !== undefined && (ts.isIdentifier(name) || ts.isStringLiteral(name))) {
                keys.push(name.text);
            }
        }

        return keys;
    }

    if (ts.isCallExpression(node)) {
        const callee = ts.isIdentifier(node.expression) ? node.expression.text : undefined;

        return callee === undefined ? undefined : factories.get(callee);
    }

    return ts.isIdentifier(node) ? factories.get(node.text) : undefined;
}

/**
 * Local bindings that yield an object literal — a `const` object, or an arrow/function returning one.
 *
 * @param source - The file to scan.
 * @returns Binding name → the keys the object carries.
 */
function objectFactories(source: SourceFile): ReadonlyMap<string, readonly string[]> {
    const factories = new Map<string, readonly string[]>();
    const empty = new Map<string, readonly string[]>();

    visit(parse(source), (node) => {
        if (!ts.isVariableDeclaration(node) || !ts.isIdentifier(node.name) || node.initializer === undefined) {
            return;
        }

        const { initializer } = node;

        // `const dims = { … }`
        if (ts.isObjectLiteralExpression(initializer)) {
            const keys = objectKeys(initializer, empty);

            if (keys !== undefined) {
                factories.set(node.name.text, keys);
            }

            return;
        }

        // `const dims = (x) => ({ … })` — the concise-body arrow, which is how a stack writes this.
        if (ts.isArrowFunction(initializer) && !ts.isBlock(initializer.body)) {
            const keys = objectKeys(
                ts.isParenthesizedExpression(initializer.body) ? initializer.body.expression : initializer.body,
                empty,
            );

            if (keys !== undefined) {
                factories.set(node.name.text, keys);
            }

            return;
        }

        // A block body: take the first `return { … }`.
        if ((ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)) && ts.isBlock(initializer.body)) {
            for (const statement of initializer.body.statements) {
                if (ts.isReturnStatement(statement) && statement.expression !== undefined) {
                    const keys = objectKeys(statement.expression, empty);

                    if (keys !== undefined) {
                        factories.set(node.name.text, keys);
                    }

                    return;
                }
            }
        }
    });

    return factories;
}

/**
 * Resolve an expression to a string, following single-file `const` indirection.
 *
 * @param node - The expression to resolve.
 * @param constants - Constants in scope, from {@link stringConstants}.
 * @returns The string value, or `undefined` when it is computed at synth time.
 */
function resolveString(node: ts.Expression | undefined, constants: ReadonlyMap<string, string>): string | undefined {
    if (node === undefined) {
        return undefined;
    }

    const direct = literalText(node);

    if (direct !== undefined) {
        return direct;
    }

    return ts.isIdentifier(node) ? constants.get(node.text) : undefined;
}

/** The infra (CDK) sources of a service — its stacks, never its tests. */
function infraSources(service: DiscoveredService): readonly SourceFile[] {
    return service.sources.filter((source) => isInfraFile(source.file) && !isTestFile(source.file));
}

/** The runtime sources of a service — the code that actually gets deployed, never infra, never tests. */
function runtimeSources(service: DiscoveredService): readonly SourceFile[] {
    return service.sources.filter((source) => !isInfraFile(source.file) && !isTestFile(source.file));
}

// ───────────────────── W1 — a queue URL in an environment implies the matching grant ─────────────────────

/**
 * The two IAM shapes an SQS caller can need. CDK models them as exactly these two grants, and they are not
 * interchangeable: `grantConsumeMessages` confers `ReceiveMessage`/`DeleteMessage`/`ChangeMessageVisibility` and
 * NOT `SendMessage`, which is the whole of defect (1).
 */
type QueueGrant = 'send' | 'consume';

/**
 * Which grant each `@aws-sdk/client-sqs` command requires.
 *
 * Keyed on the command CLASS rather than the IAM action, because the class is what appears in the code and the
 * mapping from class to action is AWS's, not ours.
 */
const COMMAND_GRANTS: ReadonlyMap<string, QueueGrant> = new Map([
    ['SendMessageCommand', 'send'],
    ['SendMessageBatchCommand', 'send'],
    ['ReceiveMessageCommand', 'consume'],
    ['DeleteMessageCommand', 'consume'],
    ['DeleteMessageBatchCommand', 'consume'],
    ['ChangeMessageVisibilityCommand', 'consume'],
    ['ChangeMessageVisibilityBatchCommand', 'consume'],
]);

/** Which grant each raw IAM action implies, for stacks that write a `PolicyStatement` instead of using a grant. */
const ACTION_GRANTS: ReadonlyMap<string, QueueGrant> = new Map([
    ['sqs:sendmessage', 'send'],
    ['sqs:sendmessagebatch', 'send'],
    ['sqs:receivemessage', 'consume'],
    ['sqs:deletemessage', 'consume'],
    ['sqs:deletemessagebatch', 'consume'],
    ['sqs:changemessagevisibility', 'consume'],
]);

/** The CDK grant method names, mapped to what they confer. */
const GRANT_METHODS: ReadonlyMap<string, QueueGrant> = new Map([
    ['grantSendMessages', 'send'],
    ['grantConsumeMessages', 'consume'],
]);

/** One `*_QUEUE_URL` value handed to a deployed execution unit through its environment. */
interface QueueUrlInjection {
    /** The infra file that injects it. */
    readonly file: string;
    /** The environment variable name, e.g. `DELETION_QUEUE_URL`. */
    readonly envName: string;
    /** The queue reference whose `.queueUrl` supplies the value, when the value is a queue at all. */
    readonly queue: string | undefined;
}

/**
 * Every `*_QUEUE_URL` an infra file puts into an environment.
 *
 * Matched as "an object-literal property whose NAME ends in `_QUEUE_URL`", deliberately without checking that
 * the literal sits inside an `addContainer`/`lambda.Function` call. Those calls routinely receive a hoisted
 * `commonEnv` object spread in from 200 lines earlier (identity-webhooks) or an env object assembled before the
 * task definition exists (recipe-service), so a structural check would miss the real cases while looking
 * stricter. In a CDK stack there is no other reason to write the key.
 *
 * @param source - The infra file.
 * @returns One entry per injected queue URL.
 */
function queueUrlInjections(source: SourceFile): readonly QueueUrlInjection[] {
    const injections: QueueUrlInjection[] = [];

    visit(parse(source), (node) => {
        if (!ts.isObjectLiteralExpression(node)) {
            return;
        }

        for (const [name, initializer] of objectProperties(node)) {
            if (!/_QUEUE_URL$/u.test(name)) {
                continue;
            }

            // `deletionQueue.queueUrl` / `this.archiveQueue.queueUrl` — the value identifies its queue. Any
            // other shape (an SSM lookup, an Fn.importValue) is opaque and leaves `queue` undefined.
            const queue =
                ts.isPropertyAccessExpression(initializer) && initializer.name.text === 'queueUrl'
                    ? referenceText(initializer.expression)
                    : undefined;

            injections.push({ file: source.file, envName: name, queue });
        }
    });

    return injections;
}

/**
 * Grants conferred on each queue reference in an infra file, plus the file-wide grants written as raw IAM.
 *
 * @param source - The infra file.
 * @returns Queue reference text → grants, under the `''` key the file-wide raw-IAM grants.
 */
function queueGrants(source: SourceFile): ReadonlyMap<string, ReadonlySet<QueueGrant>> {
    const grants = new Map<string, Set<QueueGrant>>();

    const add = (key: string, grant: QueueGrant): void => {
        const existing = grants.get(key) ?? new Set<QueueGrant>();

        existing.add(grant);
        grants.set(key, existing);
    };

    visit(parse(source), (node) => {
        // `<queue>.grantSendMessages(role)`
        if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
            const grant = GRANT_METHODS.get(node.expression.name.text);
            const queue = referenceText(node.expression.expression);

            if (grant !== undefined && queue !== undefined) {
                add(queue, grant);
            }
        }

        // `new iam.PolicyStatement({ actions: ['sqs:SendMessage'], … })` — recipe-service's shape, which is
        // correct and must not be reported. Attributed file-wide rather than to a queue: the statement's
        // resource is an ARN expression, not a queue object, so there is nothing to key it on.
        if (ts.isObjectLiteralExpression(node)) {
            const actions = objectProperties(node).get('actions');

            if (actions !== undefined && ts.isArrayLiteralExpression(actions)) {
                for (const element of actions.elements) {
                    const action = literalText(element)?.toLowerCase();

                    if (action === undefined) {
                        continue;
                    }

                    if (action === 'sqs:*') {
                        add('', 'send');
                        add('', 'consume');
                        continue;
                    }

                    const grant = ACTION_GRANTS.get(action);

                    if (grant !== undefined) {
                        add('', grant);
                    }
                }
            }
        }
    });

    return grants;
}

/**
 * The SQS grants a service's RUNTIME code actually needs, derived from the commands it constructs.
 *
 * Scoped to files that import `@aws-sdk/client-sqs`, so an identically-named command from another SDK client
 * cannot manufacture a requirement.
 *
 * @param service - The service to analyse.
 * @returns The set of grants the deployed code requires.
 */
function requiredQueueGrants(service: DiscoveredService): ReadonlySet<QueueGrant> {
    const required = new Set<QueueGrant>();

    for (const source of runtimeSources(service)) {
        if (!moduleSpecifiers(source).includes('@aws-sdk/client-sqs')) {
            continue;
        }

        visit(parse(source), (node) => {
            if (ts.isNewExpression(node) && ts.isIdentifier(node.expression)) {
                const grant = COMMAND_GRANTS.get(node.expression.text);

                if (grant !== undefined) {
                    required.add(grant);
                }
            }
        });
    }

    return required;
}

/**
 * W1 — a queue whose URL is injected into a deployed environment is granted the operations that code performs.
 *
 * The derivation, rather than naming the one queue that broke: a service that hands an execution unit a
 * `*_QUEUE_URL` is telling it to talk to that queue, and the commands its runtime code constructs say which
 * operations that means. Naming `DeletionQueue` here would leave the next service free to repeat the defect.
 *
 * ⚠️ RESIDUAL, stated rather than papered over: this checks that the QUEUE is granted the operation somewhere in
 * the stack, not that the SPECIFIC role attached to that execution unit holds it. Pinning the grantee needs the
 * env-object-to-role association, which survives neither the `commonEnv` spread (identity-webhooks injects one
 * env into seven Lambdas with seven roles) nor an env assembled before its task definition (recipe-service).
 * The recorded defect is "nobody granted it at all", which this catches; role-level precision belongs in each
 * service's own synth test, where the role is a concrete template resource — `identity/infra/__tests__`
 * asserts `sqs:SendMessage` on the identity task role's policy for exactly that reason.
 *
 * @param service - The service to check.
 * @returns One finding per under-granted injection.
 */
function queueGrantViolations(service: DiscoveredService): readonly string[] {
    const required = requiredQueueGrants(service);

    if (required.size === 0) {
        return [];
    }

    const findings: string[] = [];

    for (const source of infraSources(service)) {
        const grants = queueGrants(source);
        const rawIamGrants = grants.get('') ?? new Set<QueueGrant>();

        for (const injection of queueUrlInjections(source)) {
            const granted = new Set<QueueGrant>([
                ...rawIamGrants,
                ...(injection.queue === undefined ? [] : (grants.get(injection.queue) ?? [])),
            ]);
            const missing = [...required].filter((grant) => !granted.has(grant));

            if (missing.length > 0) {
                findings.push(
                    `${injection.file}: injects ${injection.envName} but the queue is not granted ` +
                        `[${missing.sort().join(', ')}] — the code issues commands requiring it ` +
                        `(granted: [${[...granted].sort().join(', ') || 'nothing'}])`,
                );
            }
        }
    }

    return findings;
}

// ───────────────────── W2 — every deployed Lambda handler is in the bundle ─────────────────────

/**
 * Every Lambda handler string a service's stacks deploy.
 *
 * Scoped to `new …Function(…)` expressions so a `handler:` key in unrelated config cannot contribute, and so
 * the prose in `recipe-workers-stack.ts` that quotes these exact strings ("Matches esbuild's outbase:src
 * layout — see esbuild.mjs entryPoints") is invisible.
 *
 * @param source - The infra file.
 * @returns The handler strings, e.g. `handlers/handle-sync-worker.handler`.
 */
function deployedHandlers(source: SourceFile): readonly string[] {
    const handlers: string[] = [];

    visit(parse(source), (node) => {
        if (!ts.isNewExpression(node)) {
            return;
        }

        const callee = referenceText(node.expression);

        if (callee === undefined || !/Function$/u.test(callee)) {
            return;
        }

        for (const argument of node.arguments ?? []) {
            if (!ts.isObjectLiteralExpression(argument)) {
                continue;
            }

            const handler = literalText(objectProperties(argument).get('handler'));

            if (handler !== undefined) {
                handlers.push(handler);
            }
        }
    });

    return handlers;
}

/**
 * The entry points a service's `esbuild.mjs` bundles.
 *
 * Read from any `entryPoints` binding — the `const entryPoints = [...]` declaration every service uses, or an
 * inline `entryPoints: [...]` property — so the shape of the config is not part of the contract.
 *
 * @param bundlerConfig - The `esbuild.mjs` text.
 * @returns The entry-point paths, e.g. `src/handlers/handle-sync-worker.ts`.
 */
function bundledEntryPoints(bundlerConfig: SourceFile): readonly string[] {
    const entries: string[] = [];

    const collect = (node: ts.Expression | undefined): void => {
        if (node !== undefined && ts.isArrayLiteralExpression(node)) {
            for (const element of node.elements) {
                const text = literalText(element);

                if (text !== undefined) {
                    entries.push(text);
                }
            }
        }
    };

    visit(parse(bundlerConfig), (node) => {
        if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'entryPoints') {
            collect(node.initializer);
        }

        if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name) && node.name.text === 'entryPoints') {
            collect(node.initializer);
        }
    });

    return entries;
}

/**
 * The source file a Lambda `handler` string resolves to under esbuild's `outbase: src` layout.
 *
 * `handlers/handle-sync-worker.handler` → `src/handlers/handle-sync-worker.ts`. The exported symbol is
 * everything after the LAST dot, so this is generic over layouts — food-service's
 * `lambdas/migrate/handler.handler` resolves to `src/lambdas/migrate/handler.ts`.
 *
 * @param handler - The CDK `handler:` string.
 * @returns The expected entry-point path, or `undefined` when the string carries no export suffix.
 */
function entryPointForHandler(handler: string): string | undefined {
    const lastDot = handler.lastIndexOf('.');

    return lastDot <= 0 ? undefined : `src/${handler.slice(0, lastDot)}.ts`;
}

/**
 * W2 — every Lambda the stack constructs has its handler's entry point in the bundler config.
 *
 * ⚠️ THIS GATE REPLACES TWO THAT FAILED. `recipe-workers-stack.test.ts` asserted the handler strings with
 * `expect.arrayContaining([…five names…])` — which proves the five are PRESENT and says nothing about a sixth —
 * and `build-inputs.test.ts` iterated the same five names again. Both were green while `handle-sync-worker`
 * shipped unbundled. The lists were not a check; they were a copy of the bundler's own list, and a copy cannot
 * detect that the original is incomplete. So the subjects here are DISCOVERED from the stack, and the expected
 * set is DERIVED from each handler string — there is no list for anyone to keep in step.
 *
 * A service with no `esbuild.mjs` is skipped rather than reported: it packages its Lambdas some other way (a
 * container image, a `Code.fromInline`), and inventing a violation for a strategy this gate cannot see is how a
 * guard earns its own suppression.
 *
 * @param service - The service to check.
 * @returns One finding per unbundled handler.
 */
function unbundledHandlerViolations(service: DiscoveredService): readonly string[] {
    const configText = readServiceFile(service.name, 'esbuild.mjs');

    if (configText === undefined) {
        return [];
    }

    const entries = new Set(bundledEntryPoints({ file: `${service.name}/esbuild.mjs`, contents: configText }));

    return infraSources(service).flatMap((source) =>
        deployedHandlers(source)
            .map((handler) => ({ handler, entry: entryPointForHandler(handler) }))
            .filter(({ entry }) => entry !== undefined && !entries.has(entry))
            .map(
                ({ handler, entry }) =>
                    `${source.file}: deploys '${handler}' but esbuild.mjs does not bundle '${entry ?? ''}' — ` +
                    'the asset carries no node_modules, so the handler fails at cold start',
            ),
    );
}

// ───────────────────── W3–W5 — an alarm must watch a metric the code emits, and page ─────────────────────

/** One `cloudwatch.Alarm` a stack creates, with the custom metric it selects. */
interface DiscoveredAlarm {
    /** The infra file that creates it. */
    readonly file: string;
    /** The construct id, for the finding message. */
    readonly id: string;
    /** The variable the alarm is bound to, when it is bound at all — an unbound alarm can never get an action. */
    readonly binding: string | undefined;
    /** Namespace of the selected metric, when resolvable and non-AWS. */
    readonly namespace: string | undefined;
    /** Metric name, when resolvable. */
    readonly metricName: string | undefined;
    /** Dimension keys the alarm selects. */
    readonly dimensionKeys: readonly string[];
}

/**
 * Every `cloudwatch.Alarm` in an infra file, paired with the custom metric it selects.
 *
 * A metric is "custom" when its namespace resolves to something outside `AWS/…`. Alarms on AWS-published
 * metrics (`targetGroup.metrics.*`, `queue.metricApproximate*`, `service.metricCpuUtilization`) are out of scope
 * by construction: they select no `new cloudwatch.Metric` and there is no emitter of ours to agree with.
 *
 * @param source - The infra file.
 * @returns One entry per alarm.
 */
function discoverAlarms(source: SourceFile): readonly DiscoveredAlarm[] {
    const alarms: DiscoveredAlarm[] = [];
    const constants = stringConstants(source);
    const factories = objectFactories(source);
    const parsed = parse(source);

    /** The nearest `new cloudwatch.Metric({…})` inside an alarm's props, with its resolvable fields. */
    const selectedMetric = (
        props: ts.ObjectLiteralExpression,
    ): Pick<DiscoveredAlarm, 'namespace' | 'metricName' | 'dimensionKeys'> => {
        let namespace: string | undefined;
        let metricName: string | undefined;
        let dimensionKeys: readonly string[] = [];

        visit(props as unknown as ts.SourceFile, (node) => {
            if (!ts.isNewExpression(node) || !/Metric$/u.test(referenceText(node.expression) ?? '')) {
                return;
            }

            for (const argument of node.arguments ?? []) {
                if (!ts.isObjectLiteralExpression(argument)) {
                    continue;
                }

                const properties = objectProperties(argument);

                namespace = resolveString(properties.get('namespace'), constants) ?? namespace;
                metricName = resolveString(properties.get('metricName'), constants) ?? metricName;

                dimensionKeys = objectKeys(properties.get('dimensionsMap'), factories) ?? dimensionKeys;
            }
        });

        return { namespace, metricName, dimensionKeys };
    };

    const record = (node: ts.NewExpression, binding: string | undefined): void => {
        if (!/Alarm$/u.test(referenceText(node.expression) ?? '')) {
            return;
        }

        const [, idArgument, propsArgument] = node.arguments ?? [];
        const props =
            propsArgument !== undefined && ts.isObjectLiteralExpression(propsArgument) ? propsArgument : undefined;

        alarms.push({
            file: source.file,
            id: literalText(idArgument) ?? '(unnamed)',
            binding,
            ...(props === undefined
                ? { namespace: undefined, metricName: undefined, dimensionKeys: [] }
                : selectedMetric(props)),
        });
    };

    visit(parsed, (node) => {
        // `const x = new cloudwatch.Alarm(…)` — bound, so it can receive an action.
        if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer !== undefined) {
            if (ts.isNewExpression(node.initializer)) {
                record(node.initializer, node.name.text);
            }

            return;
        }

        // A bare `new cloudwatch.Alarm(…);` statement — unbound, so nothing can ever call addAlarmAction on it.
        if (ts.isExpressionStatement(node) && ts.isNewExpression(node.expression)) {
            record(node.expression, undefined);
        }
    });

    return alarms.filter((alarm) => alarm.namespace === undefined || !alarm.namespace.startsWith('AWS/'));
}

/**
 * The dimension keys a service's EMF emitter attaches to EVERY metric it publishes.
 *
 * Read from the `Dimensions: [[…]]` array inside the emitter's `_aws.CloudWatchMetrics` directive — the one
 * place the EMF contract is expressed in code. Only LITERAL keys count, which is what makes this safe across the
 * three emitter shapes in the tree:
 *
 *  - `identity-webhooks`: `Dimensions: [['service', 'metric', ...Object.keys(dimensions)]]` → `service`,
 *    `metric` are unconditional; the spread adds per-call keys on top.
 *  - `recipe-workers`: `Dimensions: [['Stage']]` → `Stage` is unconditional.
 *  - `food-service`: `Dimensions: [dimensionKeys]` → NOTHING is unconditional, so its dimensionless alarms are
 *    correct and must not be reported.
 *
 * A key CloudWatch attaches to every datapoint is a key the alarm must select, because EMF publishes only the
 * dimension sets the directive lists — there is no dimensionless rollup to fall back on. That asymmetry is the
 * entire bug in defect (3).
 *
 * @param service - The service to analyse.
 * @returns The unconditional dimension keys, empty when the emitter computes them all.
 */
function unconditionalEmfDimensions(service: DiscoveredService): readonly string[] {
    const keys = new Set<string>();

    for (const source of runtimeSources(service)) {
        visit(parse(source), (node) => {
            if (!ts.isObjectLiteralExpression(node)) {
                return;
            }

            const directives = objectProperties(node).get('CloudWatchMetrics');

            if (directives === undefined || !ts.isArrayLiteralExpression(directives)) {
                return;
            }

            for (const directive of directives.elements) {
                if (!ts.isObjectLiteralExpression(directive)) {
                    continue;
                }

                const dimensions = objectProperties(directive).get('Dimensions');

                if (dimensions === undefined || !ts.isArrayLiteralExpression(dimensions)) {
                    continue;
                }

                for (const set of dimensions.elements) {
                    if (!ts.isArrayLiteralExpression(set)) {
                        continue;
                    }

                    for (const key of set.elements) {
                        const text = literalText(key);

                        if (text !== undefined) {
                            keys.add(text);
                        }
                    }
                }
            }
        });
    }

    return [...keys];
}

/**
 * W3 — an alarm on a custom metric watches a metric name the runtime code actually emits.
 *
 * The metric name must appear as a string literal somewhere in the service's runtime sources. Deliberately
 * coarse — proving "this exact call publishes this exact name" needs dataflow through three different emitter
 * signatures — but it cannot be satisfied by accident, and it catches the alarm that watches a renamed or
 * never-implemented metric, which is indistinguishable from a healthy system.
 *
 * @param service - The service to check.
 * @returns One finding per alarm on a metric name the code never mentions.
 */
function unemittedMetricViolations(service: DiscoveredService): readonly string[] {
    const emitted = new Set(runtimeSources(service).flatMap((source) => stringLiterals(source)));

    return infraSources(service)
        .flatMap((source) => discoverAlarms(source))
        .filter((alarm) => alarm.namespace !== undefined && alarm.metricName !== undefined)
        .filter((alarm) => !emitted.has(alarm.metricName as string))
        .map(
            (alarm) =>
                `${alarm.file}: alarm '${alarm.id}' watches ${alarm.namespace}/${alarm.metricName}, ` +
                'which no runtime source emits',
        );
}

/**
 * W4 — an alarm cannot omit a dimension its emitter attaches unconditionally.
 *
 * This is the gate for defect (3), and it is worth more than the fix: an alarm whose dimension set does not
 * match the emitter's subscribes to a time series that has never had a datapoint, and with
 * `treatMissingData: NOT_BREACHING` it reports a permanent, confident `OK`. Both deployed
 * `kitchensink-erasure-incomplete-*` alarms did exactly that, with `Dimensions: []` and the state reason "no
 * datapoints were received for 2 periods".
 *
 * @param service - The service to check.
 * @returns One finding per alarm missing an unconditional dimension.
 */
function alarmDimensionViolations(service: DiscoveredService): readonly string[] {
    const unconditional = unconditionalEmfDimensions(service);

    if (unconditional.length === 0) {
        return [];
    }

    return infraSources(service)
        .flatMap((source) => discoverAlarms(source))
        .filter((alarm) => alarm.namespace !== undefined && alarm.metricName !== undefined)
        .flatMap((alarm) => {
            const missing = unconditional.filter((key) => !alarm.dimensionKeys.includes(key));

            return missing.length === 0
                ? []
                : [
                      `${alarm.file}: alarm '${alarm.id}' selects dimensions ` +
                          `[${[...alarm.dimensionKeys].sort().join(', ') || 'none'}] but the emitter publishes ` +
                          `every metric with [${[...unconditional].sort().join(', ')}] — the alarmed time ` +
                          'series has no datapoints',
                  ];
        });
}

/**
 * W5 — every alarm has somewhere to page.
 *
 * "Make every alert actionable — if a human can't act on it, it's a dashboard, not an alert"
 * (`ENGINEERING_EXCELLENCE.md` § Observability). A CDK alarm takes its actions through `addAlarmAction`, never
 * through props, so an alarm constructed as a bare statement and bound to nothing is structurally incapable of
 * having one. `identity-service-stack.ts` records having already been through this once — "A4: alarms previously
 * had no action wired, so they fired silently" — and `webhooks-stack.ts` still had one.
 *
 * @param service - The service to check.
 * @returns One finding per alarm with no action.
 */
function actionlessAlarmViolations(service: DiscoveredService): readonly string[] {
    return infraSources(service).flatMap((source) => {
        const actioned = new Set<string>();

        visit(parse(source), (node) => {
            if (
                ts.isCallExpression(node) &&
                ts.isPropertyAccessExpression(node.expression) &&
                node.expression.name.text === 'addAlarmAction'
            ) {
                const target = referenceText(node.expression.expression);

                if (target !== undefined) {
                    actioned.add(target);
                }
            }
        });

        return discoverAlarms(source)
            .filter((alarm) => alarm.binding === undefined || !actioned.has(alarm.binding))
            .map(
                (alarm) =>
                    `${alarm.file}: alarm '${alarm.id}' has no addAlarmAction — it changes state but pages nobody`,
            );
    });
}

// ───────────────────────────── the mutation proof ─────────────────────────────

/**
 * THE FAKE SIXTH SERVICE — every invariant above, violated at once, each violation wrapped in prose that names
 * the very thing the gate looks for.
 *
 * The prose is not decoration. Two gates in `service-security-invariants.test.ts` passed against deliberately
 * broken code because a comment above the code contained the words they searched for, and the fixtures below are
 * written to reproduce that trap: the queue's comment says `grantSendMessages`, the stack's comment quotes the
 * missing `esbuild.mjs` entry point, and the alarm's comment names the dimensions it fails to select. A gate
 * that reads text instead of the AST passes all of this.
 *
 * In memory rather than a real directory under `packages/services/`, because a real fixture package would be
 * discovered by turbo, the boundaries ratchet, the CI matrix, tsconfig resolution and this very test — so
 * proving the gate would mean shipping a broken service and suppressing it in five other places.
 */
const VIOLATING_SERVICE: DiscoveredService = {
    name: 'fake-service',
    packageName: '@kitchensink/fake-service',
    sources: [
        {
            file: 'packages/services/fake-service/infra/lib/fake-service-stack.ts',
            contents: `
                const ALARM_NAMESPACE = 'KitchenSink/Fake';

                const deletionQueue = sqs.Queue.fromQueueArn(this, 'Q', props.queueArn);

                // The task PRODUCES deletion messages, so the role needs grantSendMessages on this queue.
                // (A comment saying so must NOT satisfy the gate — this is the exact trap that defeated two
                // text-matching gates in service-security-invariants.test.ts.)
                deletionQueue.grantConsumeMessages(taskRole);

                taskDefinition.addContainer('FakeContainer', {
                    environment: {
                        DELETION_QUEUE_URL: deletionQueue.queueUrl,
                    },
                });

                // Deploys the sync worker. Bundled by esbuild.mjs as src/handlers/handle-sync-worker.ts.
                new lambda.Function(this, 'HandleSyncFunction', {
                    handler: 'handlers/handle-sync-worker.handler',
                    code: lambda.Code.fromAsset(DIST_PATH),
                });

                // Alarms on the rejection counter, dimensioned by service, metric and reason.
                new cloudwatch.Alarm(this, 'FakeRejectedAlarm', {
                    metric: new cloudwatch.Metric({
                        namespace: ALARM_NAMESPACE,
                        metricName: 'FakeRejected',
                    }),
                    threshold: 0,
                });

                const ghostAlarm = new cloudwatch.Alarm(this, 'FakeGhostAlarm', {
                    metric: new cloudwatch.Metric({
                        namespace: ALARM_NAMESPACE,
                        metricName: 'MetricNobodyEmits',
                        dimensionsMap: { service: 'fake', metric: 'MetricNobodyEmits' },
                    }),
                    threshold: 0,
                });
                ghostAlarm.addAlarmAction(alarmAction);
            `,
        },
        {
            file: 'packages/services/fake-service/src/queue/sqs.service.ts',
            contents: `
                import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';

                export class SqsService {
                    async enqueue(): Promise<void> {
                        const queueUrl = process.env['DELETION_QUEUE_URL'];

                        await this.sqs.send(new SendMessageCommand({ QueueUrl: queueUrl, MessageBody: '{}' }));
                    }
                }
            `,
        },
        {
            file: 'packages/services/fake-service/src/common/observability.ts',
            contents: `
                export const emitMetric = (metricName, value, dimensions = {}) => {
                    process.stdout.write(JSON.stringify({
                        _aws: {
                            Timestamp: Date.now(),
                            CloudWatchMetrics: [
                                {
                                    Namespace: 'KitchenSink/Fake',
                                    Dimensions: [['service', 'metric', ...Object.keys(dimensions)]],
                                    Metrics: [{ Name: metricName, Unit: 'Count' }],
                                },
                            ],
                        },
                        service: 'fake',
                        metric: metricName,
                    }));
                };
            `,
        },
        {
            file: 'packages/services/fake-service/src/handlers/handle-sync-worker.ts',
            contents: "import { emitMetric } from '../common/observability.js';\nemitMetric('FakeRejected', 1);",
        },
    ],
};

/** The fake's `esbuild.mjs` — five entries, none of them the handler the stack deploys. */
const VIOLATING_BUNDLER_CONFIG = `
    // Bundles every handler, including src/handlers/handle-sync-worker.ts.
    const entryPoints = [
        'src/handlers/version-archive-worker.ts',
        'src/handlers/account-erasure-worker.ts',
    ];

    await build({ entryPoints, outdir: 'dist', outbase: 'src', bundle: true });
`;

/**
 * W2 reads `esbuild.mjs` off disk, which the in-memory fake has none of. Rather than weaken the gate with an
 * injectable filesystem, the fake's config is fed straight to the two pure functions W2 composes — which is
 * where the logic under test actually lives.
 *
 * @returns The handlers the fake stack deploys but does not bundle.
 */
function fakeUnbundledHandlers(): readonly string[] {
    const entries = new Set(
        bundledEntryPoints({ file: 'fake-service/esbuild.mjs', contents: VIOLATING_BUNDLER_CONFIG }),
    );

    return VIOLATING_SERVICE.sources
        .filter((source) => isInfraFile(source.file))
        .flatMap((source) => deployedHandlers(source))
        .filter((handler) => {
            const entry = entryPointForHandler(handler);

            return entry !== undefined && !entries.has(entry);
        });
}

const services = discoverServices();

describe('every deployable service wires its infra to its code', () => {
    // A guard on the guard: if discovery yields nothing, every assertion below passes vacuously.
    it('discovers the services it is meant to constrain', () => {
        expect(services.map((service) => service.name)).toContain('identity');
        expect(services.length).toBeGreaterThanOrEqual(5);
        expect(services.every((service) => service.sources.length > 0)).toBe(true);
    });

    it.each([
        ['W1 grants every queue it injects the operations its code performs', queueGrantViolations],
        ['W2 bundles every Lambda handler it deploys', unbundledHandlerViolations],
        ['W3 alarms only on metrics its code emits', unemittedMetricViolations],
        ['W4 selects the dimensions its emitter publishes', alarmDimensionViolations],
        ['W5 gives every alarm somewhere to page', actionlessAlarmViolations],
    ] as const)('%s', (_title, check) => {
        expect(services.flatMap((service) => check(service))).toEqual([]);
    });

    /**
     * Non-vacuity: each gate must have real subjects in the tree, or it is green because it examined nothing.
     * This is the assertion that would have caught W2's predecessors — a gate over an empty subject set is
     * indistinguishable from a gate over a clean one.
     */
    describe('the gates have real subjects — not green because they found nothing', () => {
        it('W1 finds a queue URL injected into an environment', () => {
            const injections = services.flatMap((service) =>
                infraSources(service).flatMap((source) => queueUrlInjections(source)),
            );

            expect(injections.map((injection) => injection.envName)).toContain('DELETION_QUEUE_URL');
        });

        it('W1 finds runtime code that requires a send grant', () => {
            const identity = services.find((service) => service.name === 'identity');

            expect([...requiredQueueGrants(identity as DiscoveredService)]).toEqual(['send']);
        });

        it('W2 finds deployed handlers and bundled entry points', () => {
            const handlers = services.flatMap((service) =>
                infraSources(service).flatMap((source) => deployedHandlers(source)),
            );
            const config = readServiceFile('recipe-workers', 'esbuild.mjs');

            expect(handlers).toContain('handlers/handle-sync-worker.handler');
            expect(
                bundledEntryPoints({ file: 'esbuild.mjs', contents: config as string }).length,
            ).toBeGreaterThanOrEqual(6);
        });

        it('W4 finds an emitter that attaches unconditional dimensions', () => {
            const webhooks = services.find((service) => service.name === 'identity-webhooks');

            expect([...unconditionalEmfDimensions(webhooks as DiscoveredService)].sort()).toEqual([
                'metric',
                'service',
            ]);
        });

        it('W5 finds alarms to check', () => {
            const alarms = services.flatMap((service) =>
                infraSources(service).flatMap((source) => discoverAlarms(source)),
            );

            expect(alarms.length).toBeGreaterThanOrEqual(10);
        });
    });

    /**
     * The mutation proof. Every gate is asserted to FIRE on a service that breaks it — and each fixture wraps
     * its violation in a comment naming exactly what the gate looks for, so a gate that reads text rather than
     * the AST fails here.
     */
    describe('the gates actually fire — proven against a fake sixth service that violates all of them', () => {
        it('W1 catches a send-only producer holding consume-only permission', () => {
            expect(queueGrantViolations(VIOLATING_SERVICE)).toEqual([
                'packages/services/fake-service/infra/lib/fake-service-stack.ts: injects DELETION_QUEUE_URL ' +
                    'but the queue is not granted [send] — the code issues commands requiring it ' +
                    '(granted: [consume])',
            ]);
        });

        it('W1 is satisfied by a raw sqs:SendMessage PolicyStatement — recipe-service’s shape', () => {
            const rawIam: DiscoveredService = {
                ...VIOLATING_SERVICE,
                sources: VIOLATING_SERVICE.sources.map((source) =>
                    isInfraFile(source.file)
                        ? {
                              ...source,
                              contents: `
                                  taskRole.addToPolicy(new iam.PolicyStatement({
                                      actions: ['sqs:SendMessage'],
                                      resources: [queueArn],
                                  }));

                                  taskDefinition.addContainer('FakeContainer', {
                                      environment: { DELETION_QUEUE_URL: ssmQueueUrl },
                                  });
                              `,
                          }
                        : source,
                ),
            };

            expect(queueGrantViolations(rawIam)).toEqual([]);
        });

        it('W1 does NOT accept the comment that names the missing grant', () => {
            // The fixture's comment says "the role needs grantSendMessages on this queue". The finding above
            // proves the gate reported the violation anyway; this pins that the prose alone never grants.
            const proseOnly: DiscoveredService = {
                ...VIOLATING_SERVICE,
                sources: VIOLATING_SERVICE.sources.map((source) =>
                    isInfraFile(source.file)
                        ? {
                              ...source,
                              contents: `
                                  // deletionQueue.grantSendMessages(taskRole) — deliberately commented out.
                                  taskDefinition.addContainer('C', {
                                      environment: { DELETION_QUEUE_URL: deletionQueue.queueUrl },
                                  });
                              `,
                          }
                        : source,
                ),
            };

            expect(queueGrantViolations(proseOnly)).toHaveLength(1);
        });

        it('W2 catches a deployed handler that the bundler config omits', () => {
            expect(fakeUnbundledHandlers()).toEqual(['handlers/handle-sync-worker.handler']);
        });

        it('W2 accepts the handler once the bundler config carries its entry point', () => {
            const entries = new Set(
                bundledEntryPoints({
                    file: 'esbuild.mjs',
                    contents: "const entryPoints = ['src/handlers/handle-sync-worker.ts'];",
                }),
            );

            expect(entries.has(entryPointForHandler('handlers/handle-sync-worker.handler') as string)).toBe(true);
        });

        it('W2 derives the entry point from the handler, whatever the layout', () => {
            expect(entryPointForHandler('lambdas/migrate/handler.handler')).toBe('src/lambdas/migrate/handler.ts');
            expect(entryPointForHandler('handlers/erasure-sweeper.handler')).toBe('src/handlers/erasure-sweeper.ts');
        });

        it('W3 catches an alarm on a metric no runtime source emits', () => {
            expect(unemittedMetricViolations(VIOLATING_SERVICE)).toEqual([
                "packages/services/fake-service/infra/lib/fake-service-stack.ts: alarm 'FakeGhostAlarm' watches " +
                    'KitchenSink/Fake/MetricNobodyEmits, which no runtime source emits',
            ]);
        });

        it('W4 catches the dimensionless alarm over a dimensioned emitter', () => {
            const findings = alarmDimensionViolations(VIOLATING_SERVICE);

            expect(findings).toHaveLength(1);
            expect(findings[0]).toContain("alarm 'FakeRejectedAlarm' selects dimensions [none]");
            expect(findings[0]).toContain('the emitter publishes every metric with [metric, service]');
        });

        it('W4 still fires when a WRONG dimension set is hidden behind a local factory', () => {
            // The gate resolves `dimensionsMap: someFactory(x)` so that expressing the emitter's contract once
            // (the correct fix) does not blind it. This pins the other half: resolving the factory must not
            // become a way to LAUNDER a wrong dimension set through a helper.
            const factoryHidden: DiscoveredService = {
                ...VIOLATING_SERVICE,
                sources: VIOLATING_SERVICE.sources.map((source) =>
                    isInfraFile(source.file)
                        ? {
                              ...source,
                              contents: `
                                  // Selects the dimensions the emitter publishes: service and metric.
                                  const emitterDimensions = (metricName) => ({ stage: 'prod' });

                                  const a = new cloudwatch.Alarm(this, 'FakeRejectedAlarm', {
                                      metric: new cloudwatch.Metric({
                                          namespace: 'KitchenSink/Fake',
                                          metricName: 'FakeRejected',
                                          dimensionsMap: emitterDimensions('FakeRejected'),
                                      }),
                                  });
                                  a.addAlarmAction(alarmAction);
                              `,
                          }
                        : source,
                ),
            };
            const findings = alarmDimensionViolations(factoryHidden);

            expect(findings).toHaveLength(1);
            expect(findings[0]).toContain('selects dimensions [stage]');
        });

        it('W4 accepts a factory that DOES yield the emitter’s dimensions, spread included', () => {
            const correct: DiscoveredService = {
                ...VIOLATING_SERVICE,
                sources: VIOLATING_SERVICE.sources.map((source) =>
                    isInfraFile(source.file)
                        ? {
                              ...source,
                              contents: `
                                  const emitterDimensions = (metricName) => ({
                                      service: 'fake',
                                      metric: metricName,
                                  });

                                  const a = new cloudwatch.Alarm(this, 'Rejected', {
                                      metric: new cloudwatch.Metric({
                                          namespace: 'KitchenSink/Fake',
                                          metricName: 'FakeRejected',
                                          dimensionsMap: { ...emitterDimensions('FakeRejected'), reason: 'shape' },
                                      }),
                                  });
                                  a.addAlarmAction(alarmAction);
                              `,
                          }
                        : source,
                ),
            };

            expect(alarmDimensionViolations(correct)).toEqual([]);
        });

        it('W4 does NOT report an emitter whose dimensions are entirely per-call — food-service’s shape', () => {
            const dynamicEmitter: DiscoveredService = {
                ...VIOLATING_SERVICE,
                sources: VIOLATING_SERVICE.sources.map((source) =>
                    source.file.endsWith('observability.ts')
                        ? {
                              ...source,
                              contents: `
                                  export function buildEmf(input) {
                                      const dimensionKeys = Object.keys(input.dimensions ?? {});

                                      return {
                                          _aws: {
                                              Timestamp: Date.now(),
                                              CloudWatchMetrics: [
                                                  { Namespace: input.namespace, Dimensions: [dimensionKeys] },
                                              ],
                                          },
                                      };
                                  }
                              `,
                          }
                        : source,
                ),
            };

            expect(alarmDimensionViolations(dynamicEmitter)).toEqual([]);
        });

        it('W5 catches the unbound alarm that can never receive an action', () => {
            expect(actionlessAlarmViolations(VIOLATING_SERVICE)).toEqual([
                "packages/services/fake-service/infra/lib/fake-service-stack.ts: alarm 'FakeRejectedAlarm' has " +
                    'no addAlarmAction — it changes state but pages nobody',
            ]);
        });

        it('W5 accepts an alarm bound to a variable that receives an action', () => {
            const actioned: DiscoveredService = {
                ...VIOLATING_SERVICE,
                sources: VIOLATING_SERVICE.sources.map((source) =>
                    isInfraFile(source.file)
                        ? {
                              ...source,
                              contents: `
                                  const a = new cloudwatch.Alarm(this, 'A', { threshold: 1 });
                                  a.addAlarmAction(alarmAction);
                              `,
                          }
                        : source,
                ),
            };

            expect(actionlessAlarmViolations(actioned)).toEqual([]);
        });
    });

    /**
     * False-positive guards. Each corresponds to a real shape in the tree that a naive version of the same gate
     * reported. A gate that fires on correct code gets weakened or deleted, so each is pinned.
     */
    describe('does not report the correct shapes already in the tree', () => {
        it('W5 ignores alarms on AWS-published metrics — there is no emitter of ours to check', () => {
            const awsMetric: SourceFile = {
                file: 'packages/services/x/infra/lib/x-stack.ts',
                contents: `
                    const a = new cloudwatch.Alarm(this, 'Cpu', {
                        metric: new cloudwatch.Metric({ namespace: 'AWS/ECS', metricName: 'CPUUtilization' }),
                        threshold: 80,
                    });
                    a.addAlarmAction(action);
                `,
            };

            expect(discoverAlarms(awsMetric)).toEqual([]);
        });

        it('W3/W4 skip an alarm whose metric name is a synth-time value — food-service’s helper factory', () => {
            const factory: SourceFile = {
                file: 'packages/services/x/infra/lib/x-stack.ts',
                contents: `
                    const emfMetric = (metricName, statistic) =>
                        new cloudwatch.Metric({ namespace: FOOD_METRIC_NAMESPACE, metricName, statistic });

                    const a = new cloudwatch.Alarm(this, 'Tombstone', { metric: emfMetric(NAME, 'max') });
                    a.addAlarmAction(action);
                `,
            };
            const [alarm] = discoverAlarms(factory);

            expect(alarm?.metricName).toBeUndefined();
        });

        it('W3 resolves a metric name hoisted into a const — recipe-workers’ shape', () => {
            const hoisted: SourceFile = {
                file: 'packages/services/x/infra/lib/x-stack.ts',
                contents: `
                    const NS = 'Commise/RecipeArchive';
                    const AGE = 'OldestPendingArchiveAgeSeconds';

                    const a = new cloudwatch.Alarm(this, 'Age', {
                        metric: new cloudwatch.Metric({
                            namespace: NS,
                            metricName: AGE,
                            dimensionsMap: { Stage: props.stage },
                        }),
                    });
                    a.addAlarmAction(action);
                `,
            };
            const [alarm] = discoverAlarms(hoisted);

            expect(alarm?.metricName).toBe('OldestPendingArchiveAgeSeconds');
            expect(alarm?.dimensionKeys).toEqual(['Stage']);
        });

        it('W1 ignores a queue URL named only in a comment', () => {
            expect(
                queueUrlInjections({
                    file: 'packages/services/x/infra/lib/x-stack.ts',
                    contents: '// Reads DELETION_QUEUE_URL from SSM. See the worker.\nconst x = 1;',
                }),
            ).toEqual([]);
        });

        it('W2 ignores a handler string named only in a comment', () => {
            expect(
                deployedHandlers({
                    file: 'packages/services/x/infra/lib/x-stack.ts',
                    contents: "// handler: 'handlers/ghost.handler' — must match esbuild.mjs.\nconst x = 1;",
                }),
            ).toEqual([]);
        });
    });
});
