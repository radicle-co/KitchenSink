#!/usr/bin/env node
/**
 * The INFRASTRUCTURE MANIFEST generator — `docs/generated/infrastructure/`.
 *
 * ## What this exists to replace
 *
 * `docs/architecture/2026-08-28-ingredient-pipeline-state.md` §1 was a hand-maintained table headed "What
 * runs where, today" and it marked `verifyLine` plus thirteen other Lambda handlers ✅ deployed. Measured
 * against the live account: `kitchensink-recipe-workers-prod` held SIX Lambdas and had last been updated on
 * 2026-08-02, with the branch 600+ commits ahead. Neither `verifyLine` nor `parseLine` was deployed anywhere.
 *
 * ⛔ AND A DOCUMENT GENERATED FROM CDK WOULD HAVE SAID THE SAME THING, because both handlers ARE declared at
 * HEAD. CDK describes INTENT; only the account holds REALITY; the gap between them is the defect. So this
 * generator emits exactly one claim — {@link MANIFEST_CLAIM} — and `scripts/deploymentDrift.mjs` owns the
 * comparison against what is running. Do not "improve" the wording into "the deployed infrastructure": that
 * is the original defect in a machine-readable format, and `infrastructureManifest.test.ts` fails on it.
 *
 * ## Why the source is the TypeScript AST, and not a synthesized cloud assembly
 *
 * A cloud assembly is the more faithful reading and was measured unusable as the source of a COMMITTED
 * artifact. Every service app calls `ec2.Vpc.fromLookup` (six sites) so synth needs AWS credentials and an
 * uncached context; `RecipeWorkersStack` throws unless `packages/services/recipe-workers` has been BUILT;
 * and each entrypoint requires between one and nine environment variables (`DOMAIN_NAME`, `RECIPE_VPC_ID`,
 * `RECIPE_DB_INSTANCE_ID`, …). A generated file only a credentialed, fully-built job can reproduce cannot
 * have a regenerate-and-diff staleness gate — and a generated file with no staleness gate rots exactly the
 * way the prose table did. That is the whole reason the prose table existed.
 *
 * The AST reading is hermetic: no build, no credentials, no network. It is therefore gated the same way
 * `contractDriftGate.mjs` gates the wire contracts, and it can never silently fall behind the source.
 *
 * ## The two limits, stated because a green artifact must not be over-read
 *
 *  1. A construct reached through a NON-relative import is not followed. It is counted and NAMED under
 *     `unfollowedConstructs`, so the hole announces itself rather than reading as an empty stack.
 *  2. A name built from anything but a literal or a plain reference chain renders `{?}`.
 *
 * ## Usage
 *
 *     node scripts/infrastructureManifest.mjs            # write the manifest, its rendered view and the edges
 *     node scripts/infrastructureManifest.mjs --check    # regenerate into memory and diff (exit 1 on drift)
 *
 * ## The third output, and why a deploy reads it
 *
 * `cross-app-imports.tsv` projects the one thing CloudFormation cannot order for itself: a `Fn.importValue`
 * that crosses a CDK **app** boundary. `DependsOn` does not leave a stack and nothing orders two `cdk deploy`
 * invocations (ADR-0022 §5), so a consumer whose producer has not deployed fails outright. `prod-deploy.yml`
 * gated each leg independently on a path diff and had no way to see those edges — measured on 2026-09-02,
 * `kitchensink-service-logs-prod` did not exist while two apps imported from it. `.github/scripts/deploy-gate.sh`
 * now reads this file to force a producer leg, and gets the edges DERIVED rather than enumerated.
 *
 * @sideEffect The CLI reads the repository through git and the filesystem, and writes three files.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

/**
 * ⛔ THE PUBLISHED JSON SHAPE. Another tool renders `manifest.json`; `deploymentDrift.mjs` compares it
 * against the account. Both read these fields by name, so a change here is a contract change — bump
 * {@link MANIFEST_SCHEMA_VERSION} with it.
 *
 * They are written as `@typedef`s rather than left as bare `object` because `packages/infra/global`'s
 * tsconfig pulls this file in through `allowJs` (see its `//allowJs` note): without them, every guard that
 * asserts on a manifest field compiles against `object` and would still compile if the field were renamed
 * or deleted — a suite with no type safety at all, which is the very failure that note was written about.
 *
 * @typedef {object} DeclaredResource
 * @property {string} kind - One of the values in `RESOURCE_KINDS`.
 * @property {string | null} logicalId - The construct id, or `null` when it is not a readable literal.
 * @property {string | null} nameTemplate - The physical name, `{stage}`-parameterised.
 * @property {string | null} handler - A Lambda's handler; `null` for every other kind, and for a handler
 *   this reader could not resolve (see `notes`).
 * @property {string | null} condition - The `if` guard this construction sits behind.
 * @property {string[]} notes - What could not be read, stated so the hole announces itself.
 *
 * @typedef {object} DeclaredChild
 * @property {string} className - The construct class.
 * @property {string} importedFrom - Its import specifier, verbatim.
 * @property {string | null} logicalId - The construct id given at the call site.
 * @property {string | null} stackNameTemplate - The `stackName` prop, `{stage}`-parameterised.
 * @property {string | null} condition - The `if` guard this construction sits behind.
 *
 * @typedef {object} SourceScope
 * @property {string} name - A class name, or `<module>` for the file's top level.
 * @property {boolean} isStack - Whether the class extends `Stack`.
 * @property {DeclaredResource[]} resources
 * @property {DeclaredChild[]} children
 * @property {string[]} importedExports - `Fn.importValue` names, `{stage}`-parameterised; see
 *   {@link CrossAppImport}.
 * @property {string[]} unclassifiedConstructs - `aws-cdk-lib` constructs outside this manifest's scope.
 * @property {string[]} unfollowedConstructs - Constructs from another workspace; see the header's limit (1).
 *
 * @typedef {object} DeclaredStack
 * @property {string} className
 * @property {string} source - Repo-relative path of the file declaring it.
 * @property {string | null} stackNameTemplate
 * @property {string | null} condition
 * @property {DeclaredResource[]} resources
 * @property {string[]} importedExports
 * @property {string[]} unclassifiedConstructs
 * @property {string[]} unfollowedConstructs
 *
 * @typedef {object} DeclaredApp
 * @property {string} entrypoint - Repo-relative `bin/app.ts`.
 * @property {string | null} packageName - The owning workspace.
 * @property {DeclaredStack[]} stacks
 * @property {string[]} importedExports - Every export this app resolves, from ITS STACKS AND ITS
 *   ENTRYPOINT'S TOP LEVEL. The second half matters: `identity-webhooks/infra/bin/app.ts` resolves ten of
 *   them at module scope and passes them in as props.
 *
 * @typedef {object} CrossAppImport
 * @property {string} consumerEntrypoint - The `bin/app.ts` whose `cdk deploy` FAILS without the producer.
 * @property {string | null} consumerPackage
 * @property {string} producerEntrypoint - The `bin/app.ts` that must have been deployed first.
 * @property {string | null} producerPackage
 * @property {string} producerStack - The producing stack's class name.
 * @property {string} exportName - The `{stage}`-parameterised export name, verbatim from the source.
 *
 * @typedef {object} InfrastructureManifest
 * @property {number} schemaVersion
 * @property {string} claim
 * @property {string} generator
 * @property {DeclaredApp[]} apps
 * @property {CrossAppImport[]} crossAppImports - The deploy-graph edges CloudFormation cannot order.
 * @property {string[]} unresolvedImports - Imports whose producer this reader could not name.
 */

/**
 * Bumped when the JSON shape changes in a way a consumer must notice.
 *
 * 2 — added `crossAppImports`, `unresolvedImports` and the per-scope/stack/app `importedExports`, which
 * `.github/scripts/deploy-gate.sh` reads to close the deploy graph.
 */
export const MANIFEST_SCHEMA_VERSION = 2;

/**
 * ⛔ The sentence this artifact is FOR. Asserted verbatim by the suite; see the header.
 */
export const MANIFEST_CLAIM =
    'This manifest describes what the CDK source at this commit DECLARES. It does not describe what is ' +
    'deployed: CDK states intent, only the AWS account holds reality. Use scripts/deploymentDrift.mjs to ' +
    'compare this declaration against a live stage.';

/** Where the generated artifacts live, repo-relative. */
export const MANIFEST_DIR = 'docs/generated/infrastructure';

/** The machine-readable half. */
export const MANIFEST_JSON = `${MANIFEST_DIR}/manifest.json`;

/** The rendered half. */
export const MANIFEST_MARKDOWN = `${MANIFEST_DIR}/README.md`;

/**
 * The deploy-graph half, in the ONE shape a `bash` deploy gate can read without a JSON parser.
 *
 * ⚠️ Not a convenience. `.github/scripts/deploy-gate.sh` runs before `npm ci` has restored `typescript`, and
 * before the workspace is built — so it cannot run this generator, and a `jq`/`node -e` one-liner embedded in
 * a shell string is a third parser of the same fact with no test of its own. A tab-separated projection of
 * the SAME `--check` staleness gate costs one more generated file and is readable by `while IFS=$'\t' read`.
 *
 * A second, unlooked-for benefit: a new cross-app edge shows up in review as ONE added line here, which is
 * exactly the change a reviewer needs to notice and cannot see in a `Fn.importValue` buried 600 lines into a
 * stack.
 */
export const MANIFEST_DEPLOY_EDGES = `${MANIFEST_DIR}/cross-app-imports.tsv`;

/**
 * `aws-cdk-lib` module + class → the manifest's resource kind.
 *
 * ⚠️ This is CDK's taxonomy, not a list of THIS repository's resources, which is why writing it down is not
 * the enumeration ADR-0025 §3 warns against: it does not go stale when a stack gains a queue, only when CDK
 * gains a construct — and a construct outside it is reported as `unclassifiedConstructs` rather than dropped.
 *
 * ⛔ Keyed on MODULE and class together, never on the class name alone. `cloudfront.Function` is a CloudFront
 * function, and `EdgeStack`'s viewer-request verifier would otherwise be filed as a Lambda handler that no
 * account will ever run — a manifest entry that would then read as permanent drift.
 */
const RESOURCE_KINDS = new Map([
    ['aws-cdk-lib/aws-lambda.Function', 'lambdaFunction'],
    ['aws-cdk-lib/aws-lambda.DockerImageFunction', 'lambdaFunction'],
    ['aws-cdk-lib/aws-lambda-nodejs.NodejsFunction', 'lambdaFunction'],
    ['aws-cdk-lib/aws-sqs.Queue', 'queue'],
    ['aws-cdk-lib/aws-sns.Topic', 'topic'],
    ['aws-cdk-lib/aws-cloudwatch.Alarm', 'alarm'],
    ['aws-cdk-lib/aws-ecs.FargateService', 'ecsService'],
    ['aws-cdk-lib/aws-ecs.Ec2Service', 'ecsService'],
    ['aws-cdk-lib/aws-ssm.StringParameter', 'ssmParameter'],
]);

/**
 * The prop each kind takes its physical name from.
 *
 * A Lambda usually declares NONE of these — CloudFormation generates the physical name from the logical id,
 * which is why the drift check compares LOGICAL ids for functions and physical names for everything else.
 */
const NAME_PROPS = new Map([
    ['lambdaFunction', 'functionName'],
    ['queue', 'queueName'],
    ['topic', 'topicName'],
    ['alarm', 'alarmName'],
    ['ecsService', 'serviceName'],
    ['ssmParameter', 'parameterName'],
]);

/**
 * The name of a plain reference chain's final identifier: `props.stage` → `stage`, `this.stage` → `stage`.
 *
 * The last identifier is the semantic name at every site in this repository (`${stage}`, `${props.stage}`,
 * `${props.baseStage}`), and taking it is a rule that can be stated rather than a heuristic that can drift.
 *
 * @param {ts.Expression} node - The expression inside a `${…}`.
 * @returns {string | undefined} The name, or `undefined` when the expression is not a reference chain. Pure.
 */
function referenceName(node) {
    if (ts.isIdentifier(node)) {
        return node.text;
    }

    if (ts.isPropertyAccessExpression(node)) {
        return node.name.text;
    }

    return undefined;
}

/**
 * Render a string-producing expression as a stage-parameterised TEMPLATE.
 *
 * ⛔ A template, never one stage's answer. The CDK is stage-parameterised on purpose (ADR-0006), and baking
 * `prod` in would turn the manifest into a claim about a single deploy — the shape the prose table had.
 *
 * @param {ts.Expression | undefined} node - The expression to render.
 * @returns {string | null} The template, or `null` when the expression produces no readable name. Pure.
 */
export function renderTemplate(node) {
    if (node === undefined) {
        return null;
    }

    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
        return node.text;
    }

    if (ts.isTemplateExpression(node)) {
        let rendered = node.head.text;

        for (const span of node.templateSpans) {
            rendered += `{${referenceName(span.expression) ?? '?'}}${span.literal.text}`;
        }

        return rendered;
    }

    return null;
}

/**
 * Substitute a stage into a name template.
 *
 * A placeholder this function has no value for is LEFT IN PLACE rather than blanked: the caller — and the
 * drift report — must be able to see that the name could not be resolved, because a name silently rendered
 * `kitchensink--x` would be compared against the account and reported as missing.
 *
 * @param {string | null} template - A template from {@link renderTemplate}.
 * @param {string} stage - The stage to substitute.
 * @returns {string | null} The resolved name. Pure.
 */
export function resolveStageNames(template, stage) {
    return template === null ? null : template.replaceAll('{stage}', stage);
}

/**
 * The source text of an expression, for a guard or a note a human has to act on.
 *
 * @param {ts.SourceFile} parsed - The file the node came from.
 * @param {ts.Node} node - The expression.
 * @returns {string} Its verbatim text. Pure.
 */
function expressionText(parsed, node) {
    return parsed.text.slice(node.getStart(parsed), node.getEnd()).trim();
}

/**
 * Read one CDK source file: which classes it declares, what each constructs, and where children come from.
 *
 * A hand-written recursive walk rather than `ts.forEachChild` alone, because two facts are POSITIONAL and a
 * flat visit loses both: which class a construction sits in, and which `if` guards it. ADR-0008's cost
 * guardrails and ADR-0020's edge stack are prod-only, and a manifest that listed them unconditionally would
 * claim two stacks for `sandbox` that the app never builds.
 *
 * @param {string} source - The file's text.
 * @param {string} file - Its path, for parser diagnostics.
 * @returns {{ scopes: SourceScope[] }} One scope per class, plus `<module>` for the file's top level. Pure.
 */
export function readInfrastructureSource(source, file) {
    const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

    /**
     * Local alias → the module a `alias.Class` construction resolves to.
     *
     * ⚠️ BOTH spellings, because this repository uses both and the second is the common one — a fact
     * measured, not assumed: the first version of this reader handled only `import * as sqs from
     * 'aws-cdk-lib/aws-sqs'` and read `RecipeWorkersStack` — the very stack this whole change exists for —
     * as declaring ZERO resources, because it spells its imports `import { aws_sqs as sqs } from
     * 'aws-cdk-lib'`. A reader that silently returns an empty stack is the prose table again.
     *
     * A named import from the barrel names a SUBMODULE by CDK's own convention (`aws_sqs` →
     * `aws-cdk-lib/aws-sqs`, `triggers` → `aws-cdk-lib/triggers`), and the ORIGINAL export name is what
     * carries it — never the local alias, which the importer chooses.
     */
    const namespaces = new Map();
    /** imported class name → module specifier, for `import { GlobalStack } from './GlobalStack.js'`. */
    const named = new Map();

    for (const statement of parsed.statements) {
        if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
            continue;
        }

        const from = statement.moduleSpecifier.text;
        const bindings = statement.importClause?.namedBindings;

        if (bindings === undefined) {
            continue;
        }
        if (ts.isNamespaceImport(bindings)) {
            namespaces.set(bindings.name.text, from);
        } else {
            for (const element of bindings.elements) {
                const exported = (element.propertyName ?? element.name).text;

                named.set(element.name.text, from);
                namespaces.set(element.name.text, `${from}/${exported.replaceAll('_', '-')}`);
            }
        }
    }

    const scopes = new Map();
    const scopeFor = (name, isStack) => {
        const existing = scopes.get(name);

        if (existing !== undefined) {
            return existing;
        }

        const created = {
            name,
            isStack,
            resources: [],
            children: [],
            importedExports: [],
            unclassifiedConstructs: [],
            unfollowedConstructs: [],
        };

        scopes.set(name, created);

        return created;
    };

    // The file's top level. Created eagerly so an entrypoint with no class still reports a scope.
    scopeFor('<module>', false);

    const walk = (node, context) => {
        let next = context;

        if (ts.isClassDeclaration(node) && node.name !== undefined) {
            const heritage = node.heritageClauses?.flatMap((clause) => clause.types.map((type) => type.expression));
            const base = heritage?.map((expression) => referenceName(expression) ?? '') ?? [];

            next = { ...context, scope: scopeFor(node.name.text, base.includes('Stack')) };
        }

        // ⚠️ The guard is recorded from the `if` STATEMENT, not from the enclosing block, so a construction
        // in an `else` branch is attributed to the condition it is actually reached under.
        if (ts.isIfStatement(node)) {
            const condition = expressionText(parsed, node.expression);

            walk(node.expression, next);
            walk(node.thenStatement, { ...next, condition });
            if (node.elseStatement !== undefined) {
                walk(node.elseStatement, { ...next, condition: `!(${condition})` });
            }

            return;
        }

        if (ts.isNewExpression(node)) {
            record(node, next);
        }

        // ⛔ Deliberately NOT an early return, and deliberately not statement-level. `Number(Fn.importValue(…))`
        // is how every database port is read here, and `ec2.SecurityGroup.fromSecurityGroupId(this, 'X',
        // Fn.importValue(…))` is how every security group is; a reader that only inspected top-level calls
        // would report six of them as importing nothing, which is the empty-stack failure the barrel-import
        // note above records, one construct over.
        if (ts.isCallExpression(node)) {
            recordImport(node, next);
        }

        ts.forEachChild(node, (child) => walk(child, next));
    };

    /**
     * Record one `Fn.importValue(<name>)`.
     *
     * ⛔ Keyed on the identifier RESOLVING to `aws-cdk-lib`, never on the method name alone — the same rule
     * that keeps `cloudfront.Function` from being filed as a Lambda. Some other object's `.importValue` is a
     * different fact and must not become a deploy-graph edge.
     */
    const recordImport = (node, context) => {
        if (!ts.isPropertyAccessExpression(node.expression) || node.expression.name.text !== 'importValue') {
            return;
        }
        if (!ts.isIdentifier(node.expression.expression)) {
            return;
        }
        if (named.get(node.expression.expression.text) !== 'aws-cdk-lib') {
            return;
        }

        // `{?}` rather than a drop: an import this reader could not read is an UNGUARDED EDGE, and an edge
        // silently omitted reads as "there is no edge" — the one answer that must never be inferred here.
        const template = renderTemplate(node.arguments?.[0]) ?? '{?}';

        if (!context.scope.importedExports.includes(template)) {
            context.scope.importedExports.push(template);
        }
    };

    const record = (node, context) => {
        const target = context.scope;
        const condition = context.condition ?? null;
        const [, idArgument, propsArgument] = node.arguments ?? [];
        const logicalId = renderTemplate(idArgument);
        const props = new Map();

        if (propsArgument !== undefined && ts.isObjectLiteralExpression(propsArgument)) {
            for (const property of propsArgument.properties) {
                if (ts.isPropertyAssignment(property) && ts.isIdentifier(property.name)) {
                    props.set(property.name.text, property.initializer);
                }
            }
        }

        // `new lambda.Function(...)` — a namespaced CDK construct.
        if (ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.expression)) {
            const module = namespaces.get(node.expression.expression.text);

            if (module === undefined) {
                return;
            }

            const qualified = `${module}.${node.expression.name.text}`;
            const kind = RESOURCE_KINDS.get(qualified);

            if (kind === undefined) {
                if (module.startsWith('aws-cdk-lib') && !target.unclassifiedConstructs.includes(qualified)) {
                    target.unclassifiedConstructs.push(qualified);
                }

                return;
            }

            const notes = [];
            const handlerNode = props.get('handler');
            let handler = null;

            if (kind === 'lambdaFunction' && handlerNode !== undefined) {
                handler = renderTemplate(handlerNode);
                if (handler === null) {
                    // The ingredient parser passes an imported constant. Reported, never silently absent —
                    // "this function declares no handler" and "we could not read the handler" are different
                    // facts, and only one of them is a defect.
                    notes.push(`handler is not a literal: ${expressionText(parsed, handlerNode)}`);
                }
            }

            target.resources.push({
                kind,
                logicalId,
                nameTemplate: renderTemplate(props.get(NAME_PROPS.get(kind) ?? '')),
                handler,
                condition,
                notes,
            });

            return;
        }

        // `new GlobalStack(app, id, props)` — a class reached by a bare identifier.
        if (ts.isIdentifier(node.expression)) {
            const className = node.expression.text;
            const from = named.get(className);

            if (className === 'App' || from === undefined) {
                return;
            }

            // ⛔ Only a RELATIVE import is a child to follow, and the two non-relative cases are DIFFERENT
            // facts. `new CfnOutput(...)` comes from the `aws-cdk-lib` barrel by exactly this syntax and is
            // simply outside this manifest's scope — treating it as unfollowed listed nine phantom holes on
            // `RecipeWorkersStack` alone. A construct from another WORKSPACE is the genuine hole (limit 1),
            // because anything IT declares is missing, so only that is reported as unfollowed.
            if (!from.startsWith('.')) {
                const qualified = `${from}.${className}`;
                const bucket = from.startsWith('aws-cdk-lib')
                    ? target.unclassifiedConstructs
                    : target.unfollowedConstructs;

                if (!bucket.includes(qualified)) {
                    bucket.push(qualified);
                }

                return;
            }

            target.children.push({
                className,
                importedFrom: named.get(className),
                logicalId,
                stackNameTemplate: renderTemplate(props.get('stackName')),
                condition,
            });
        }
    };

    walk(parsed, { scope: scopes.get('<module>'), condition: null });

    return { scopes: [...scopes.values()] };
}

// ── Impure: the repository walk ─────────────────────────────────────────────────────────────────────────

/** This file sits at `scripts/`, so the repo root is one level up. */
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Every file git tracks under a pathspec that is also on disk.
 *
 * @param {string} pathspec - A git pathspec.
 * @returns {string[]} Repo-relative paths.
 * @sideEffect Spawns git.
 */
function trackedFiles(pathspec) {
    return execFileSync('git', ['ls-files', '--', pathspec], { cwd: repoRoot, encoding: 'utf8', maxBuffer: 1 << 28 })
        .split('\n')
        .filter((file) => file !== '' && existsSync(path.join(repoRoot, file)));
}

/**
 * Every CDK app entrypoint, DISCOVERED by content.
 *
 * The same predicate `packages/infra/global/__tests__/cdkApps.ts` uses — a tracked `bin/app.ts` that
 * constructs a CDK `App`. Deliberately not imported from there: that module is a test helper in a workspace,
 * and a repo-root script importing across that boundary is the coupling `packages/infra/global`'s ESLint
 * exemption exists to bound in ONE direction only. `infrastructureManifest.test.ts` asserts the two
 * discoveries agree, which is what stops them drifting.
 *
 * @returns {string[]} Repo-relative entrypoints, sorted.
 * @sideEffect Reads the working tree.
 */
export function discoverCdkApps() {
    return trackedFiles('packages')
        .filter((file) => file.endsWith('/bin/app.ts'))
        .filter((file) => readFileSync(path.join(repoRoot, file), 'utf8').includes('new App('))
        .sort();
}

/** The nearest ancestor `package.json`'s name, so a stack can be attributed to a workspace. */
function owningPackage(file) {
    let directory = path.dirname(path.join(repoRoot, file));

    while (directory.startsWith(repoRoot)) {
        const manifest = path.join(directory, 'package.json');

        if (existsSync(manifest)) {
            return JSON.parse(readFileSync(manifest, 'utf8')).name ?? null;
        }
        directory = path.dirname(directory);
    }

    return null;
}

/**
 * Resolve a relative import to the SOURCE file it names.
 *
 * `.js` → `.ts` because every package here is `NodeNext`, where a relative import must carry the emitted
 * extension (`docs/CODING_STANDARDS.md` §4). A non-relative specifier resolves to `null` on purpose: see the
 * header's limit (1).
 *
 * @param {string} fromFile - The importing file, repo-relative.
 * @param {string} specifier - The import specifier.
 * @returns {string | null} A repo-relative `.ts` path, or `null`. Pure apart from the existence check.
 */
function resolveRelative(fromFile, specifier) {
    if (!specifier.startsWith('.')) {
        return null;
    }

    const candidate = path.posix.join(path.posix.dirname(fromFile), specifier).replace(/\.js$/u, '.ts');

    return existsSync(path.join(repoRoot, candidate)) ? candidate : null;
}

/**
 * Walk one app's composition, collecting every stack it declares and the resources inside them.
 *
 * @param {string} entrypoint - Repo-relative `bin/app.ts`.
 * @returns {DeclaredApp} The app's manifest entry.
 * @sideEffect Reads source files.
 */
function readApp(entrypoint) {
    const stacks = [];
    const seen = new Set();
    /**
     * Every export the app resolves, from ANY scope it descends through.
     *
     * ⛔ Accumulated here rather than read off `stacks`, because `identity-webhooks/infra/bin/app.ts` resolves
     * TEN exports at its `<module>` top level and hands them to the stack as props — and `<module>` is the one
     * scope `descend` never pushes onto `stacks`. Deriving the edges from `stacks` alone would report the app
     * that motivated this whole guard as importing nothing.
     */
    const importedExports = new Set();

    /**
     * @param {string} file - The file declaring the scope.
     * @param {string} scopeName - `<module>` or a class name.
     * @param {object | null} declaration - How this scope's stack was constructed, when it is one.
     */
    const descend = (file, scopeName, declaration) => {
        const key = `${file}#${scopeName}`;

        if (seen.has(key)) {
            return;
        }
        seen.add(key);

        const read = readInfrastructureSource(readFileSync(path.join(repoRoot, file), 'utf8'), file);
        const scope = read.scopes.find((candidate) => candidate.name === scopeName);

        if (scope === undefined) {
            return;
        }

        const unfollowed = [...scope.unfollowedConstructs];

        for (const imported of scope.importedExports) {
            importedExports.add(imported);
        }

        for (const child of scope.children) {
            const target = resolveRelative(file, child.importedFrom);

            if (target === null) {
                // Limit (1), made loud. A construct we cannot follow is NAMED, never assumed empty.
                unfollowed.push(`${child.className} (from ${child.importedFrom})`);
                continue;
            }

            descend(target, child.className, child);
        }

        if (declaration !== null) {
            stacks.push({
                className: scopeName,
                source: file,
                stackNameTemplate: declaration.stackNameTemplate,
                condition: declaration.condition,
                resources: scope.resources,
                importedExports: [...scope.importedExports].sort(),
                unclassifiedConstructs: scope.unclassifiedConstructs.sort(),
                unfollowedConstructs: unfollowed.sort(),
            });
        }
    };

    descend(entrypoint, '<module>', null);

    return {
        entrypoint,
        packageName: owningPackage(entrypoint),
        stacks: stacks.sort((left, right) => left.className.localeCompare(right.className)),
        importedExports: [...importedExports].sort(),
    };
}

/**
 * Canonicalise a stack-name template so the two SIDES of one edge compare equal.
 *
 * ⛔ A placeholder here is the LOCAL VARIABLE NAME the author happened to choose, not a concept — because
 * {@link renderTemplate} takes the last identifier of the reference chain, which is all a hermetic AST read
 * can know. `WebhooksStack.ts` proves it single-handedly: it calls the very same stage `deployStage`
 * (`const deployStage = props.stage`), `identityStage` (`deployStage === 'prod' ? 'prod' : 'sandbox'`) and,
 * in `bin/app.ts`, `stage` — so three spellings of `kitchensink-data-…` name ONE stack. Matching templates
 * verbatim read them as three, and the ADR-0028 edge this whole guard exists for came back UNRESOLVED.
 *
 * ⚠️ ADR-0006 supplies the same problem from the other side: a `pr-{N}` service imports the BASE stage's
 * platform, spelling it `kitchensink-data-{baseStage}` where the platform app declares
 * `kitchensink-data-{stage}`. Every food and recipe edge — the majority of the graph — hangs on this.
 *
 * So EVERY readable placeholder collapses. That is safe for a lookup because a stack name in this repository
 * is `kitchensink-<component>-<stage>`: two templates differing only in the placeholder's SPELLING are the
 * same stack. `{?}` — the marker for a name this reader could not read — is deliberately NOT collapsed; it
 * must never match anything, which is why the pattern requires an identifier.
 *
 * @param {string} template - A stack-name template.
 * @returns {string} The comparable form. Pure.
 */
export function canonicalStackTemplate(template) {
    return template.replace(/\{[A-Za-z_][A-Za-z0-9_]*\}/gu, '{stage}');
}

/**
 * Join every app's imports to the app that declares the producing stack.
 *
 * The export name is `<producer stack name>:<key>`, which is this repository's own convention (every
 * `exportName` is `` `${this.stackName}:…` ``) rather than a CloudFormation rule — so the join is a lookup,
 * not a guess. An import this function cannot attribute is REPORTED, never dropped: see the header's rule
 * about holes announcing themselves.
 *
 * @param {DeclaredApp[]} apps - Every app, already read.
 * @returns {{ crossAppImports: CrossAppImport[], unresolvedImports: string[] }} The deploy graph. Pure.
 */
export function resolveCrossAppImports(apps) {
    /** canonical stack-name template → the stacks declaring it, across every app. */
    const producers = new Map();

    for (const app of apps) {
        for (const stack of app.stacks) {
            if (stack.stackNameTemplate === null) {
                continue;
            }

            const key = canonicalStackTemplate(stack.stackNameTemplate);

            producers.set(key, [...(producers.get(key) ?? []), { app, stack }]);
        }
    }

    const crossAppImports = [];
    const unresolvedImports = [];

    for (const app of apps) {
        for (const exportName of app.importedExports) {
            const separator = exportName.indexOf(':');

            if (separator < 1 || exportName.includes('{?}')) {
                unresolvedImports.push(`${app.entrypoint} imports '${exportName}', which is not a readable name`);
                continue;
            }

            const wanted = canonicalStackTemplate(exportName.slice(0, separator));
            const candidates = producers.get(wanted) ?? [];
            const entrypoints = [...new Set(candidates.map(({ app: owner }) => owner.entrypoint))];

            if (entrypoints.length === 0) {
                unresolvedImports.push(
                    `${app.entrypoint} imports '${exportName}', but no CDK app here declares a stack named ` +
                        `'${wanted}' — nothing can order that deploy`,
                );
                continue;
            }
            if (entrypoints.length > 1) {
                // Two apps claiming one stack name is a real deploy hazard and an ambiguity this reader must
                // not resolve by picking one: the WRONG producer would be forced and the right one skipped.
                unresolvedImports.push(
                    `${app.entrypoint} imports '${exportName}', but '${wanted}' is declared by more than one ` +
                        `app: ${entrypoints.join(', ')}`,
                );
                continue;
            }

            const producer = candidates[0];

            // Within ONE app a single `cdk deploy --all` covers both stacks, so no LEG can be gated away from
            // its producer. Only an edge crossing an app boundary can be missed by a per-leg gate.
            if (producer.app.entrypoint === app.entrypoint) {
                continue;
            }

            crossAppImports.push({
                consumerEntrypoint: app.entrypoint,
                consumerPackage: app.packageName,
                producerEntrypoint: producer.app.entrypoint,
                producerPackage: producer.app.packageName,
                producerStack: producer.stack.className,
                exportName,
            });
        }
    }

    const order = (edge) => [edge.consumerEntrypoint, edge.producerEntrypoint, edge.exportName].join(' ');

    return {
        crossAppImports: crossAppImports.sort((left, right) => order(left).localeCompare(order(right))),
        unresolvedImports: unresolvedImports.sort(),
    };
}

/**
 * Build the whole manifest.
 *
 * @returns {InfrastructureManifest} The manifest.
 * @sideEffect Reads the repository.
 */
export function buildManifest() {
    const apps = discoverCdkApps().map(readApp);

    return {
        schemaVersion: MANIFEST_SCHEMA_VERSION,
        claim: MANIFEST_CLAIM,
        generator: 'scripts/infrastructureManifest.mjs',
        apps,
        ...resolveCrossAppImports(apps),
    };
}

/**
 * Render the deploy-graph edges as the tab-separated file the shell gate reads.
 *
 * Columns: consumer entrypoint, producer entrypoint, `{stage}`-parameterised export name. The template is
 * emitted VERBATIM — the shell substitutes the stage — for the reason {@link renderTemplate} gives: a file
 * carrying one stage's answer is a claim about a single deploy.
 *
 * ⛔ `unresolvedImports` are rendered as `#!` lines rather than omitted, so the gate can fail on a hole
 * instead of reading a shortened file as a complete graph.
 *
 * @param {InfrastructureManifest} manifest - A manifest from {@link buildManifest}.
 * @returns {string} The TSV. Pure.
 */
export function renderDeployEdges(manifest) {
    const lines = [
        '# GENERATED FILE — DO NOT EDIT. Run `npm run infra:manifest`.',
        '#',
        '# Every CDK-app boundary a `Fn.importValue` crosses. The CONSUMER cannot deploy until the PRODUCER',
        '# has: `DependsOn` does not leave a stack and nothing orders two `cdk deploy` invocations',
        '# (ADR-0022 §5). `.github/scripts/deploy-gate.sh close` reads this to force a producer leg whose',
        '# exports a deploying consumer needs.',
        '#',
        '# consumer entrypoint\tproducer entrypoint\texport name ({stage}/{baseStage} substituted by the caller)',
        ...manifest.unresolvedImports.map((note) => `#!\t${note}`),
        ...manifest.crossAppImports.map(
            (edge) => `${edge.consumerEntrypoint}\t${edge.producerEntrypoint}\t${edge.exportName}`,
        ),
    ];

    return `${lines.join('\n')}\n`;
}

// ── Pure: rendering ─────────────────────────────────────────────────────────────────────────────────────

/** One Markdown table row per resource, or a note when a stack declares none of the kinds we summarise. */
function renderResources(stack) {
    if (stack.resources.length === 0) {
        return ['_No Lambda, queue, topic, alarm, ECS service or SSM parameter is declared in this stack._', ''];
    }

    const rows = [...stack.resources]
        .sort((left, right) => `${left.kind}${left.logicalId}`.localeCompare(`${right.kind}${right.logicalId}`))
        .map((resource) => {
            const detail = resource.handler ?? resource.nameTemplate ?? '—';
            const guard = resource.condition === null ? '—' : `\`${resource.condition}\``;
            const notes = resource.notes.length === 0 ? '' : ` ${resource.notes.join('; ')}`;

            return `| ${resource.kind} | \`${resource.logicalId}\` | \`${detail}\` | ${guard} |${notes}`;
        });

    return ['| kind | logical id | handler / name template | only when |', '| --- | --- | --- | --- |', ...rows, ''];
}

/**
 * Render the human-readable view.
 *
 * @param {InfrastructureManifest} manifest - A manifest from {@link buildManifest}.
 * @returns {string} Markdown. Pure.
 */
export function renderManifestMarkdown(manifest) {
    const lines = [
        '<!-- GENERATED FILE — DO NOT EDIT. Run `npm run infra:manifest`. -->',
        '',
        '# Declared infrastructure',
        '',
        `> ${manifest.claim}`,
        '',
        'Every name below is a **template**: `{stage}` is substituted at deploy time (`prod`, `sandbox`,',
        '`pr-{N}` — ADR-0006). A Lambda declares no physical name, so CloudFormation derives one from the',
        'logical id; that is why the drift check compares functions by LOGICAL id and everything else by name.',
        '',
        `Schema version ${manifest.schemaVersion}. Generated by \`${manifest.generator}\`.`,
        '',
    ];

    const edges = manifest.crossAppImports ?? [];
    const unresolved = manifest.unresolvedImports ?? [];

    if (edges.length > 0 || unresolved.length > 0) {
        lines.push(
            '## Cross-app deploy edges',
            '',
            "Each row is a `Fn.importValue` that crosses a CDK **app** boundary. The consumer's `cdk deploy`",
            'fails outright — `No export named … found` — unless the producer has already been deployed, and',
            'nothing in CloudFormation can order two `cdk deploy` invocations (ADR-0022 §5). This table is what',
            '`.github/scripts/deploy-gate.sh close` reads to force a producer leg.',
            '',
            '| consumer | producer | export |',
            '| --- | --- | --- |',
            ...edges.map(
                (edge) =>
                    `| \`${edge.consumerPackage ?? edge.consumerEntrypoint}\` | ` +
                    `\`${edge.producerPackage ?? edge.producerEntrypoint}\` (\`${edge.producerStack}\`) | ` +
                    `\`${edge.exportName}\` |`,
            ),
            '',
        );

        if (unresolved.length > 0) {
            lines.push(
                '⚠️ UNRESOLVED — this reader could not name the producer of these imports, so nothing can ' +
                    'order them:',
                '',
                ...unresolved.map((note) => `- ${note}`),
                '',
            );
        }
    }

    for (const app of manifest.apps) {
        lines.push(`## ${app.packageName ?? app.entrypoint}`, '', `Entrypoint: \`${app.entrypoint}\``, '');

        for (const stack of app.stacks) {
            lines.push(`### \`${stack.stackNameTemplate ?? stack.className}\``, '');
            lines.push(`Construct \`${stack.className}\` — \`${stack.source}\``, '');

            if (stack.condition !== null) {
                lines.push(`⚠️ Declared only when \`${stack.condition}\`.`, '');
            }

            lines.push(...renderResources(stack));

            if (stack.unclassifiedConstructs.length > 0) {
                lines.push(
                    `Not summarised here (out of this manifest's scope): ${stack.unclassifiedConstructs
                        .map((name) => `\`${name}\``)
                        .join(', ')}.`,
                    '',
                );
            }
            if (stack.unfollowedConstructs.length > 0) {
                lines.push(
                    `⚠️ NOT FOLLOWED — reached through a non-relative import, so anything these declare is ` +
                        `missing from this manifest: ${stack.unfollowedConstructs.map((n) => `\`${n}\``).join(', ')}.`,
                    '',
                );
            }
        }
    }

    return `${lines.join('\n').trimEnd()}\n`;
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Write, or check, the generated pair.
 *
 * @sideEffect Reads the repository and writes two files (or, with `--check`, sets the exit code).
 */
function main() {
    const manifest = buildManifest();
    const json = `${JSON.stringify(manifest, null, 4)}\n`;
    const markdown = renderManifestMarkdown(manifest);
    const outputs = [
        [MANIFEST_JSON, json],
        [MANIFEST_MARKDOWN, markdown],
        [MANIFEST_DEPLOY_EDGES, renderDeployEdges(manifest)],
    ];

    if (process.argv.includes('--check')) {
        const stale = outputs.filter(([file, contents]) => {
            const absolute = path.join(repoRoot, file);

            return !existsSync(absolute) || readFileSync(absolute, 'utf8') !== contents;
        });

        if (stale.length > 0) {
            process.stdout.write(
                `::error::The committed infrastructure manifest is STALE — ${stale
                    .map(([file]) => file)
                    .join(', ')} no longer match the CDK source. Run \`npm run infra:manifest\` and commit ` +
                    'the result.\n',
            );
            process.exitCode = 1;

            return;
        }

        process.stdout.write(
            `Infrastructure manifest is current: ${manifest.apps.length} CDK app(s), ` +
                `${manifest.apps.reduce((total, app) => total + app.stacks.length, 0)} stack(s).\n`,
        );

        return;
    }

    mkdirSync(path.join(repoRoot, MANIFEST_DIR), { recursive: true });
    for (const [file, contents] of outputs) {
        writeFileSync(path.join(repoRoot, file), contents);
    }
    process.stdout.write(`Wrote ${outputs.map(([file]) => file).join(', ')}.\n`);
}

// `import.meta.main` is Node 24; the suite imports the pure helpers without running the generator.
if (import.meta.main) {
    main();
}
