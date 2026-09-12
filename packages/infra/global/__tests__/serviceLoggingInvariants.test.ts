// @vitest-environment node
/**
 * Repo-wide guard: a service that has ADOPTED `@kitchensink/service-logging` actually routes through it.
 *
 * ## The class of defect this exists for
 *
 * Every gate here catches one shape: **a log line silently goes nowhere, and an absence of logs is what a
 * healthy quiet system looks like.** That is the worst failure mode an observability component has, and this
 * repository has now shipped it twice:
 *
 *  1. `identity/src/observability/sentryLogging.ts` routed every level to `Sentry.logger` and wrote NOTHING
 *     to stdout. With no client `Sentry.logger.*` returns before emitting — measured — so on every local
 *     run, the whole integration tier, and any stage whose SSM parameter is unwritten, the identity service
 *     booted in total silence: no bootstrap line, no route line, no `AuthMiddleware` warning, no
 *     `UsersService` error. `aws logs tail` on its group showed an empty stream, indistinguishable from a
 *     task that never started — and ADR-0042 had just registered a subscription filter on that group, so the
 *     coverage the ADR asserts was vacuous for the one service that serves real users.
 *  2. `RecipeServiceStack.ts` set `command: ['node', 'dist/src/main.js']`, which OVERRIDES the image `CMD`
 *     and so discarded its `--import ./dist/src/instrument.js`. `Sentry.init` had never run in the deployed
 *     recipe API. (That one is W6 in `serviceInfraWiringInvariants.test.ts`, whose stated class it matches
 *     exactly: "the CDK stack and the code it deploys disagree, and nothing fails".)
 *
 * ## Why adoption is DISCOVERED from the manifest
 *
 * A service is a subject of these gates iff its own `package.json` declares the dependency. A sixth service
 * is therefore covered the day its manifest lands, and no service can opt out by not being named here — the
 * failure mode `serviceInfraWiringInvariants.test.ts` records for its own predecessors, where "a list is not
 * a check when the list is the thing that is wrong".
 *
 * ## Why the AST and not grep
 *
 * ⚠️ This file's own prose names `Sentry.logger.error`, `new NestRoutedLogger()` and `beforeSendLog`. So do
 * the docstrings of every module it guards — `NestRoutedLogger.ts` explains the rule by quoting it. A text
 * gate would report its own rationale, or pass on a comment; that trap has been sprung twice in this
 * repository (`serviceSources.ts` records it). Every predicate below reads the TypeScript AST, where
 * comments are trivia, and every predicate is fired at {@link VIOLATING_SERVICE}.
 */
import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
    type DiscoveredService,
    type SourceFile,
    discoverServices,
    isTestFile,
    moduleSpecifiers,
    objectProperties,
    parse,
    presentFiles,
    readServiceFile,
    referenceText,
    repoRoot,
    visit,
} from './serviceSources.js';

/** The package whose adoption makes a service a subject of these gates. */
const PACKAGE = '@kitchensink/service-logging';

/**
 * The ONE file allowed to reach `Sentry.logger` directly, and the reason.
 *
 * ⛔ A REGISTER WITH A REASON, not a pattern. `identity/src/observability/authTrace.ts` is not application
 * logging: it is a flag-gated diagnostic (`DEBUG_AUTH`) whose entire value is that a deployed operator can
 * filter ONE signup's whole flow by `sub` in Sentry. The shared rule sends `info` to stdout, which would put
 * that trace in the shared drain project mixed with every other line — exactly what the flag exists to
 * avoid. The file's own docstring carries this reason; if that pairing is ever broken, the exemption should
 * be revisited rather than silently widened.
 */
const DIRECT_SENTRY_LOGGER_EXEMPTIONS: ReadonlyMap<string, string> = new Map([
    ['packages/services/identity/src/observability/authTrace.ts', 'DEBUG_AUTH-gated diagnostic (ADR-0042)'],
]);

// ───────────────────────────── discovery ─────────────────────────────

/** Whether a service declares the shared logging package at all. */
function hasAdopted(service: DiscoveredService): boolean {
    const manifest = readServiceFile(service.name, 'package.json');

    if (manifest === undefined) {
        return false;
    }

    const parsed = JSON.parse(manifest) as { dependencies?: Record<string, string> };

    return parsed.dependencies?.[PACKAGE] !== undefined;
}

/**
 * Whether a service uses the SINK, as opposed to only the pure `./logAttributes` subpath.
 *
 * ⛔ THE DISTINCTION IS THE WHOLE POINT OF THE SUBPATH, and a gate that ignored it would be wrong in the
 * direction that forces a bad change. `recipe-workers` declares this package for `renderLogAttributes` and
 * nothing else: it is a set of Lambdas on `@sentry/aws-serverless`, it owns its own equivalent of the sink
 * in `common/observability.ts`, and `logSink.ts` imports `@sentry/nestjs` — which those esbuild bundles must
 * not carry. Judging adoption by the manifest alone would report that package's own sink as a violation and
 * invite "fixing" it by pulling the Nest SDK into ten Lambda bundles.
 *
 * @param service - The service to classify.
 * @returns Whether any non-test source imports the package ROOT.
 */
function usesSink(service: DiscoveredService): boolean {
    return runtimeSources(service).some((source) => moduleSpecifiers(source).includes(PACKAGE));
}

/** A service's own non-test sources. */
function runtimeSources(service: DiscoveredService): readonly SourceFile[] {
    return service.sources.filter((source) => !isTestFile(source.file));
}

/** Namespace-import bindings for any `@sentry/*` module in a file (`import * as Sentry from …`). */
function sentryNamespaces(source: SourceFile): ReadonlySet<string> {
    const bindings = new Set<string>();

    visit(parse(source), (node) => {
        if (!ts.isImportDeclaration(node) || !ts.isStringLiteral(node.moduleSpecifier)) {
            return;
        }

        if (!node.moduleSpecifier.text.startsWith('@sentry/')) {
            return;
        }

        const clause = node.importClause?.namedBindings;

        if (clause !== undefined && ts.isNamespaceImport(clause)) {
            bindings.add(clause.name.text);
        }
    });

    return bindings;
}

// ───────────────────────────── the gates ─────────────────────────────

/**
 * L1 — an adopted Nest service hands the shared adapter to `NestFactory.create`.
 *
 * ⛔ THIS, AND NOT ANY CALL-SITE EDIT, IS WHAT ROUTES A SERVICE. `create(mod, { logger })` calls
 * `Logger.overrideLogger(logger)`, and Nest's `Logger` resolves that static at CALL time — so every existing
 * `new Logger(X.name)` routes through the adapter without being touched, including instances constructed at
 * module load before the app exists. Measured, and pinned by the shared package's own integration test.
 * Conversely, without this line the framework's own bootstrap and route output, and all 19 of those call
 * sites, keep going to Nest's `ConsoleLogger` — the package would be a dependency that changed nothing.
 *
 * @param service - The service to check.
 * @returns One finding per `NestFactory.create` that does not pass the adapter.
 */
function unroutedNestBootstraps(service: DiscoveredService): readonly string[] {
    return runtimeSources(service).flatMap((source) => {
        const findings: string[] = [];

        visit(parse(source), (node) => {
            if (
                !ts.isCallExpression(node) ||
                !ts.isPropertyAccessExpression(node.expression) ||
                node.expression.name.text !== 'create' ||
                referenceText(node.expression.expression) !== 'NestFactory'
            ) {
                return;
            }

            const options = node.arguments[1];
            const logger =
                options !== undefined && ts.isObjectLiteralExpression(options)
                    ? objectProperties(options).get('logger')
                    : undefined;
            // ⚠️ RESOLVED THROUGH A LOCAL CONST, because `{ logger }` over `const logger = new
            // NestRoutedLogger()` is the shape identity already uses and is in no way worse than the
            // inline one. A gate that accepted only the inline form would have demanded a pointless edit
            // and taught the next reader that the variable form is wrong.
            const routed = logger !== undefined && constructsAdapter(logger, adapterConstants(source));

            if (!routed) {
                findings.push(
                    `${source.file}: NestFactory.create does not pass { logger: new NestRoutedLogger() } — ` +
                        `the framework's own output and every new Logger(...) in this service stay on Nest's ` +
                        `ConsoleLogger`,
                );
            }
        });

        return findings;
    });
}

/**
 * Module-level `const NAME = new NestRoutedLogger()` bindings in a file.
 *
 * @param source - The file to scan.
 * @returns Every constant name bound to a freshly constructed adapter.
 */
function adapterConstants(source: SourceFile): ReadonlySet<string> {
    const names = new Set<string>();

    visit(parse(source), (node) => {
        if (
            ts.isVariableDeclaration(node) &&
            ts.isIdentifier(node.name) &&
            node.initializer !== undefined &&
            ts.isNewExpression(node.initializer) &&
            referenceText(node.initializer.expression) === 'NestRoutedLogger'
        ) {
            names.add(node.name.text);
        }
    });

    return names;
}

/**
 * Whether an expression is the adapter, inline or through a local constant.
 *
 * @param expression - The `logger` property's value.
 * @param constants - Adapter-bound constants in the same file.
 * @returns Whether it constructs the adapter. Pure.
 */
function constructsAdapter(expression: ts.Expression, constants: ReadonlySet<string>): boolean {
    if (ts.isNewExpression(expression)) {
        return referenceText(expression.expression) === 'NestRoutedLogger';
    }

    const reference = referenceText(expression);

    return reference !== undefined && constants.has(reference);
}

/**
 * L2 — an adopted service does not reach past the sink to `Sentry.logger`.
 *
 * ⛔ WHAT IT PROTECTS. The routing rule is only a rule if it cannot be bypassed: a direct
 * `Sentry.logger.error` writes to the service's project whatever the table says, and — worse — a direct
 * `Sentry.logger.info` with no client writes NOWHERE, which is defect (1) in this file's header returning
 * one call site at a time.
 *
 * ⚠️ IT MATCHES THE `.logger.` CHAIN SPECIFICALLY, not "any call on a Sentry namespace". Both
 * `ApiExceptionFilter`s call `Sentry.captureException`, which is correct, shipped and reviewed: an ISSUE is
 * a different product from a LOG, and only logs are routed here.
 *
 * @param service - The service to check.
 * @returns One finding per unexempted direct call.
 */
function directSentryLoggerCalls(service: DiscoveredService): readonly string[] {
    return runtimeSources(service).flatMap((source) => {
        if (DIRECT_SENTRY_LOGGER_EXEMPTIONS.has(source.file)) {
            return [];
        }

        const namespaces = sentryNamespaces(source);
        const findings: string[] = [];

        visit(parse(source), (node) => {
            if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) {
                return;
            }

            const target = node.expression.expression;

            if (!ts.isPropertyAccessExpression(target) || target.name.text !== 'logger') {
                return;
            }

            const binding = referenceText(target.expression);

            if (binding !== undefined && namespaces.has(binding)) {
                findings.push(
                    `${source.file}: calls ${binding}.logger.${node.expression.name.text} directly — the ` +
                        `level threshold and the no-client fallback both live in ${PACKAGE}, and a direct ` +
                        `call has neither`,
                );
            }
        });

        return findings;
    });
}

/**
 * L3 — every `instrument.ts` wires BOTH shared scrubbers.
 *
 * ⛔ WHY THIS BECAME LOAD-BEARING IN THE SAME CHANGE. `beforeSendLog` is the ONLY scrub on the Sentry path:
 * the sink deliberately scrubs the console path and not the Sentry one, because `scrubAttributes`
 * PSEUDONYMIZES person-linked ids and pseudonymizing twice yields a different token, destroying the
 * cross-service correlation that is the entire reason ids are pseudonymized rather than redacted. Before
 * this step `beforeSendLog` guarded almost nothing; it now sees every error line these services emit,
 * recipe text and display names included (ADR-0027).
 *
 * @param service - The service to check.
 * @returns One finding per missing hook.
 */
function unscrubbedInstrumentation(service: DiscoveredService): readonly string[] {
    const instrument = runtimeSources(service).find((source) => source.file.endsWith('/src/instrument.ts'));

    if (instrument === undefined) {
        return [];
    }

    const findings: string[] = [];

    visit(parse(instrument), (node) => {
        if (
            !ts.isCallExpression(node) ||
            !ts.isPropertyAccessExpression(node.expression) ||
            node.expression.name.text !== 'init'
        ) {
            return;
        }

        const options = node.arguments[0];

        if (options === undefined || !ts.isObjectLiteralExpression(options)) {
            findings.push(`${instrument.file}: Sentry.init is not called with an options object`);

            return;
        }

        const properties = objectProperties(options);

        for (const [hook, scrubber] of [
            ['beforeSend', 'scrubEvent'],
            ['beforeSendLog', 'scrubLog'],
        ] as const) {
            const wired = properties.get(hook);

            if (wired === undefined || referenceText(wired) !== scrubber) {
                findings.push(
                    `${instrument.file}: Sentry.init does not wire ${hook}: ${scrubber} — nothing else ` +
                        `scrubs what this service sends to Sentry`,
                );
            }
        }

        const logs = properties.get('enableLogs');

        if (logs === undefined || logs.kind !== ts.SyntaxKind.TrueKeyword) {
            findings.push(
                `${instrument.file}: Sentry.init does not set enableLogs: true — every diverted error line ` +
                    `is then dropped by BOTH sinks, silently`,
            );
        }
    });

    return findings;
}

/**
 * L4 — every workspace declaring `@sentry/nestjs` declares the SAME range.
 *
 * ⛔ THE FAILURE THIS PREVENTS IS INVISIBLE AND PERMANENT. Sentry's carrier is keyed BY SDK VERSION
 * (`globalThis.__SENTRY__[SDK_VERSION]`). Two `@sentry/core` versions in one process therefore give two
 * carriers, and `getClient()` inside the shared package answers `undefined` while the service holds a
 * perfectly good client. Under the routing rule that is indistinguishable from "no DSN configured": every
 * error falls back to stdout, forever, with nothing failing and no error anywhere.
 *
 * @returns One finding per manifest whose range differs from the majority.
 */
function sentryRangeDisagreements(): readonly string[] {
    const ranges = new Map<string, string[]>();

    for (const manifest of presentFiles(['packages']).filter((file) => file.endsWith('/package.json'))) {
        const parsed = JSON.parse(readFileSync(path.join(repoRoot, manifest), 'utf8')) as {
            dependencies?: Record<string, string>;
            devDependencies?: Record<string, string>;
        };
        const range = parsed.dependencies?.['@sentry/nestjs'] ?? parsed.devDependencies?.['@sentry/nestjs'];

        if (range !== undefined) {
            ranges.set(range, [...(ranges.get(range) ?? []), manifest]);
        }
    }

    if (ranges.size <= 1) {
        return [];
    }

    return [...ranges.entries()].map(
        ([range, files]) =>
            `@sentry/nestjs is declared as '${range}' by ${files.join(', ')} — a second @sentry/core in one ` +
            `process gives a second version-keyed carrier, and getClient() then answers undefined forever`,
    );
}

/**
 * L5 — nothing hands the sink text it has already rendered.
 *
 * ⛔ THE DEFECT THIS CLOSES, which a GATE found in the change that introduced the sink. The rule ADR-0043
 * states is render-then-`scrubText`, and the sink implements it for values IT renders. A caller that renders
 * first — `logger.error(line, renderThrowable(exception))`, which both `ApiExceptionFilter`s did — hands
 * over a multi-kilobyte string the sink did not produce, and such a string used to reach `scrubAttributes`
 * instead, whose string branch is a WHOLE-VALUE verdict against an unanchored bearer pattern. Two failures,
 * opposite in shape: one token-shaped substring replaces the ENTIRE stack trace with `[redacted]` and the
 * operator loses the error, while an email or Clerk `sub` in the same dump is never touched at all.
 *
 * ⚠️ The sink now scrubs EVERY string, so this is no longer a leak — it is the class staying closed. What
 * remains wrong with pre-rendering is that it duplicates a rule the sink owns, and the next renderer someone
 * reaches for will not be `renderThrowable`. The right shape is `{ error: exception }`.
 *
 * @param service - The service to check.
 * @returns One finding per rendered value passed to a log call.
 */
function preRenderedLogArguments(service: DiscoveredService): readonly string[] {
    return runtimeSources(service).flatMap((source) => {
        const findings: string[] = [];

        visit(parse(source), (node) => {
            if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) {
                return;
            }

            if (!['error', 'warn', 'info', 'log', 'debug'].includes(node.expression.name.text)) {
                return;
            }

            for (const argument of node.arguments) {
                if (ts.isCallExpression(argument) && referenceText(argument.expression) === 'renderThrowable') {
                    findings.push(
                        `${source.file}: passes renderThrowable(...) to .${node.expression.name.text}() — ` +
                            `hand the throwable over whole ({ error: exception }); rendering it is the ` +
                            `sink's job, and the sink scrubs what it renders`,
                    );
                }
            }
        });

        return findings;
    });
}

/**
 * L6 — a Nest service that boots an app has adopted the package.
 *
 * ⛔ WHAT IT CLOSES, and it is the one hole a GATE found in L1's own claim. L1 discovers its subjects from
 * each service's manifest, which is what keeps it from being an enumerated list — but it also means adoption
 * is OPT-IN. A new Nest service that never declares the dependency is not a subject, so it routes nowhere
 * while L1 stays green and this file's header promising that "no service can opt out by not being named
 * here" would be false by one word. Owning a `NestFactory.create` is the obligation; declaring the
 * dependency is how it is met.
 *
 * @param services - Every discovered service.
 * @returns One finding per Nest service that has not adopted.
 */
function unadoptedNestServices(services: readonly DiscoveredService[]): readonly string[] {
    return services
        .filter((service) => !hasAdopted(service))
        .filter((service) =>
            runtimeSources(service).some((source) => {
                let boots = false;

                visit(parse(source), (node) => {
                    if (
                        ts.isCallExpression(node) &&
                        ts.isPropertyAccessExpression(node.expression) &&
                        node.expression.name.text === 'create' &&
                        referenceText(node.expression.expression) === 'NestFactory'
                    ) {
                        boots = true;
                    }
                });

                return boots;
            }),
        )
        .map(
            (service) =>
                `${service.name}: calls NestFactory.create but does not declare ${PACKAGE} — its bootstrap ` +
                `output and every new Logger(...) in it route nowhere, and L1 cannot see it`,
        );
}

// ───────────────────────────── the mutation proof ─────────────────────────────

/**
 * THE FAKE SERVICE — every gate above violated at once, each violation wrapped in prose that names exactly
 * what the gate looks for.
 *
 * The prose is not decoration: it reproduces the trap that defeated two gates in
 * `serviceSecurityInvariants.test.ts`, where a comment ABOVE the code contained the words the gate searched
 * for. A gate reading text instead of the AST passes all of this.
 */
const VIOLATING_SERVICE: DiscoveredService = {
    name: 'fake-logging-service',
    packageName: '@kitchensink/fake-logging-service',
    sources: [
        {
            file: 'packages/services/fake-logging-service/src/main.ts',
            contents: `
                import { NestFactory } from '@nestjs/core';

                // Boots with { logger: new NestRoutedLogger() } so Nest's own output is routed.
                // (A comment saying so must NOT satisfy L1.)
                const app = await NestFactory.create(AppModule);
            `,
        },
        {
            file: 'packages/services/fake-logging-service/src/users/users.service.ts',
            contents: `
                import * as Sentry from '@sentry/nestjs';

                export class UsersService {
                    fail(): void {
                        // Routed through @kitchensink/service-logging rather than Sentry.logger directly.
                        Sentry.logger.error('provisioning failed', { step: 'resolve' });
                        Sentry.captureException(new Error('boom'));
                    }
                }
            `,
        },
        {
            file: 'packages/services/fake-logging-service/src/instrument.ts',
            contents: `
                import * as Sentry from '@sentry/nestjs';

                // Wires enableLogs: true, beforeSend: scrubEvent and beforeSendLog: scrubLog.
                Sentry.init({
                    dsn: process.env['SENTRY_DSN'],
                    sendDefaultPii: false,
                });
            `,
        },
    ],
};

describe('every service that adopted the shared logger actually routes through it', () => {
    const services = discoverServices();
    const adopted = services.filter((service) => hasAdopted(service));
    const sinkUsers = adopted.filter((service) => usesSink(service));

    it.each([
        ['L1 hands the adapter to NestFactory.create', unroutedNestBootstraps],
        ['L2 never reaches past the sink to Sentry.logger', directSentryLoggerCalls],
        ['L5 never hands the sink text it has already rendered', preRenderedLogArguments],
    ] as const)('%s', (_title, check) => {
        expect(sinkUsers.flatMap((service) => check(service))).toEqual([]);
    });

    it('L6 leaves no Nest service unadopted — adoption is opt-in, owning a bootstrap is not', () => {
        expect(unadoptedNestServices(services)).toEqual([]);
    });

    // ⚠️ L3's subject is EVERY service, not only the sink's users: a service that initialises Sentry owes
    // the scrubbers whether or not it routes its application logs through this package.
    it('L3 wires both scrubbers and enableLogs in instrument.ts', () => {
        expect(services.flatMap((service) => unscrubbedInstrumentation(service))).toEqual([]);
    });

    it('L4 declares one @sentry/nestjs range across the workspace', () => {
        expect(sentryRangeDisagreements()).toEqual([]);
    });

    /**
     * Non-vacuity: a gate whose subject set is empty is green because it examined nothing, which is
     * indistinguishable from green because everything is correct.
     */
    describe('the gates have real subjects', () => {
        it('finds the services that adopted the package, and which of them use the SINK', () => {
            expect(adopted.map((service) => service.name).sort()).toEqual([
                'food-service',
                'identity',
                'recipe-service',
                'recipe-workers',
            ]);

            // ⚠️ recipe-workers is deliberately absent: it takes only the pure `./logAttributes` subpath.
            expect(sinkUsers.map((service) => service.name).sort()).toEqual([
                'food-service',
                'identity',
                'recipe-service',
            ]);
        });

        it('L1 finds real NestFactory.create calls to check', () => {
            const bootstraps = sinkUsers.flatMap((service) =>
                runtimeSources(service).filter((source) => source.contents.includes('NestFactory.create')),
            );

            expect(bootstraps.length).toBeGreaterThanOrEqual(3);
        });

        it('L3 finds a real instrument.ts per HTTP service', () => {
            const instruments = sinkUsers.flatMap((service) =>
                runtimeSources(service).filter((source) => source.file.endsWith('/src/instrument.ts')),
            );

            expect(instruments.length).toBeGreaterThanOrEqual(3);
        });

        it('⚠️ the one direct-Sentry.logger exemption still exists, and still carries its reason', () => {
            const [[file]] = [...DIRECT_SENTRY_LOGGER_EXEMPTIONS];
            const source = sinkUsers
                .flatMap((service) => runtimeSources(service))
                .find((candidate) => candidate.file === file);

            // An exemption for a file that no longer exists is a rule nobody is following any more.
            expect(source, `${file} is exempted but absent`).toBeDefined();
            expect(source?.contents).toContain('DEBUG_AUTH');
        });
    });

    describe('the gates actually fire — proven against a fake service that violates all of them', () => {
        it('L1 reports a bootstrap that passes no logger', () => {
            expect(unroutedNestBootstraps(VIOLATING_SERVICE)).toHaveLength(1);
        });

        it('⛔ L1 is not satisfied by the comment above the call that names the adapter', () => {
            const main = VIOLATING_SERVICE.sources[0];

            expect(main?.contents).toContain('new NestRoutedLogger()');
            expect(unroutedNestBootstraps(VIOLATING_SERVICE)).toHaveLength(1);
        });

        it('L1 accepts a bootstrap that passes the adapter', () => {
            const routed: DiscoveredService = {
                ...VIOLATING_SERVICE,
                sources: VIOLATING_SERVICE.sources.map((source) =>
                    source.file.endsWith('/main.ts')
                        ? {
                              ...source,
                              contents: source.contents.replace(
                                  'NestFactory.create(AppModule)',
                                  'NestFactory.create(AppModule, { logger: new NestRoutedLogger() })',
                              ),
                          }
                        : source,
                ),
            };

            expect(unroutedNestBootstraps(routed)).toEqual([]);
        });

        it('L2 reports a direct Sentry.logger call', () => {
            expect(directSentryLoggerCalls(VIOLATING_SERVICE)).toHaveLength(1);
        });

        it('⚠️ L2 does NOT report Sentry.captureException, which is an issue and not a log', () => {
            const [finding] = directSentryLoggerCalls(VIOLATING_SERVICE);

            expect(VIOLATING_SERVICE.sources[1]?.contents).toContain('Sentry.captureException');
            expect(finding).toContain('Sentry.logger.error');
        });

        it('L5 reports a rendered value passed to a log call', () => {
            const rendering: DiscoveredService = {
                ...VIOLATING_SERVICE,
                sources: [
                    {
                        file: 'packages/services/fake-logging-service/src/filters/apiException.filter.ts',
                        contents: `
                            // Hands the throwable over whole as { error: exception } so the sink renders it.
                            export class Filter {
                                catch(exception: unknown): void {
                                    this.logger.error('GET /x -> 500', renderThrowable(exception));
                                }
                            }
                        `,
                    },
                ],
            };

            expect(preRenderedLogArguments(rendering)).toHaveLength(1);
            // The fixture's comment names the correct shape; a text gate would pass on it.
            expect(rendering.sources[0]?.contents).toContain('{ error: exception }');
        });

        it('⚠️ L5 leaves a throwable handed over WHOLE alone — that is the shape it asks for', () => {
            const correct: DiscoveredService = {
                ...VIOLATING_SERVICE,
                sources: [
                    {
                        file: 'packages/services/fake-logging-service/src/filters/apiException.filter.ts',
                        contents: `
                            export class Filter {
                                catch(exception: unknown): void {
                                    this.logger.error('GET /x -> 500', { error: exception });
                                }
                            }
                        `,
                    },
                ],
            };

            expect(preRenderedLogArguments(correct)).toEqual([]);
        });

        it('L6 reports a Nest service that boots without adopting', () => {
            // The fake declares no manifest, so `hasAdopted` is false and its `main.ts` calls create.
            expect(unadoptedNestServices([VIOLATING_SERVICE])).toHaveLength(1);
        });

        it('L3 reports every missing hook at once', () => {
            expect(unscrubbedInstrumentation(VIOLATING_SERVICE)).toHaveLength(3);
        });

        it('⛔ L3 is not satisfied by the comment above init that names all three options', () => {
            const instrument = VIOLATING_SERVICE.sources[2];

            expect(instrument?.contents).toContain('beforeSendLog: scrubLog');
            expect(unscrubbedInstrumentation(VIOLATING_SERVICE)).not.toEqual([]);
        });
    });

    describe('does not report the correct shapes already in the tree', () => {
        it('L2 leaves the exception filters’ captureException alone', () => {
            const filters = sinkUsers
                .flatMap((service) => runtimeSources(service))
                .filter((source) => source.file.endsWith('/filters/apiException.filter.ts'));

            expect(filters.length).toBeGreaterThanOrEqual(2);
            expect(filters.every((source) => source.contents.includes('captureException'))).toBe(true);
        });
    });
});
