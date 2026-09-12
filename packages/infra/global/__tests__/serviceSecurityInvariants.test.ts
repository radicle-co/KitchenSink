// @vitest-environment node
/**
 * Repo-wide guard: the SECURITY INVARIANTS every deployable service must satisfy — enforced against services
 * that DO NOT EXIST YET, not just today's five.
 *
 * ## Why this file exists
 *
 * Each invariant below was established by fixing a real defect in one service. Every one of them was then
 * protected by nothing but the memory of the person who fixed it, which is the same as being protected by
 * nothing: the next service is written by someone who never read that pull request, and every gate the repo
 * has — `typecheck`, `lint`, the per-service suites — is scoped to code that already exists. A new service
 * that simply omits the invariant is green everywhere.
 *
 * So the service list is DISCOVERED from each `packages/services/<name>/package.json` (the mechanism
 * `appServiceDependency.test.ts` uses), never enumerated. A sixth service is covered the day its manifest
 * lands, and it cannot opt out by not being mentioned here.
 *
 * ## Why the checks are PURE PREDICATES over file contents
 *
 * Every gate is a pure function of `(path, contents)` pairs, and each is proven twice: once against the real
 * tree, and once against {@link VIOLATING_SERVICE} — an in-memory FAKE SIXTH SERVICE that breaks all of them
 * at once. Without that second half, a gate that silently stopped matching anything would keep passing
 * forever, which is the failure mode a guard is supposed to prevent rather than exhibit.
 *
 * The fake service is in memory rather than a real directory under `packages/services/` on purpose: a real
 * fixture package would be discovered by turbo, the boundaries ratchet, the CI matrix, `tsconfig` project
 * resolution and this very test — so proving the gate would mean shipping a broken service and then
 * suppressing it in five other places. The predicate is the unit under test; the tree walk is just its input.
 *
 * ## Why the TypeScript PARSER and not grep
 *
 * Several invariants are about things that also appear in PROSE — `trust proxy` is discussed at length in a
 * docstring that explains why it is never set, and `sql.raw` is named in the ESLint rule's own message. A
 * textual gate reports its own rationale as a violation, and a gate that fires on its own rationale gets
 * deleted (the lesson recorded in `appServiceDependency.test.ts`). Parsing means comments are comments and
 * string literals are string literals.
 */
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// The DISCOVERY and AST-reading mechanism lives in one module, shared with
// `serviceInfraWiringInvariants.test.ts`. It was duplicated into both files, and that is the one
// duplication here that actually matters: both suites depend on discovering services from their manifests to
// constrain services that do not exist yet, so if the copies drifted, a guard would silently stop covering a
// service and pass vacuously forever — the failure mode a guard exists to prevent. The INVARIANTS stay here,
// as pure predicates; only the tree walk is shared.
import {
    type DiscoveredService,
    type SourceFile,
    discoverServices,
    isTestFile,
    moduleSpecifiers,
    parse,
    stringLiterals,
    visit,
} from './serviceSources.js';

// ───────────────────────────── the invariants, as pure predicates ─────────────────────────────

/**
 * G1 — `trust proxy` is NEVER configured.
 *
 * Every service sits behind the shared, internet-facing ALB (ADR-0003), and Express's `trust proxy` switches
 * `req.ip` from the ALB node's address to the CLIENT-SUPPLIED `X-Forwarded-For`. `UserThrottlerGuard`'s
 * unauthenticated fallback keys a rate-limit bucket on `req.ip`, so flipping that setting silently converts an
 * over-restrictive shared bucket into a bucket key the caller CHOOSES — an attacker rotates the header and the
 * limit evaporates. The guard's docstring says the setting is deliberately not enabled; that claim is true and,
 * until this gate, was protected by nothing at all.
 *
 * The check is for the STRING, anywhere in a non-test source. That is deliberately broader than
 * `app.set('trust proxy', …)`: `enable('trust proxy')`, a hoisted constant, and a settings object all reach the
 * same place, and there is no legitimate reason to write the string other than to configure it. Comments are
 * invisible here (the parser sees them as trivia), so the guard cannot report the docstring that explains it.
 *
 * @param service - The service to check.
 * @returns One finding per offending file.
 */
function trustProxyViolations(service: DiscoveredService): readonly string[] {
    return service.sources
        .filter((source) => !isTestFile(source.file))
        .filter((source) => stringLiterals(source).some((literal) => /^\s*trust\s+proxy\s*$/iu.test(literal)))
        .map((source) => `${source.file}: configures 'trust proxy'`);
}

/**
 * G6 — no service derives a caller's identity from a client-suppliable HEADER.
 *
 * PR #39 removed the `x-authorizer-context` path for a measured reason: both backend services sit behind a
 * PUBLIC internet-facing ALB (ADR-0003), so any header a client can set is a header an attacker can set. A
 * service that trusts one has no authentication at all — it has a suggestion. `auth.middleware.ts` is
 * Bearer-only via `ClerkAuthService.verifyToken`, and CLAUDE.md records the absence of the header path as a
 * standing property of the architecture.
 *
 * ⚠️ This gate exists because the property had DECAYED while every document still asserted it.
 * `identity/src/auth/middleware/wsAuth.ts` survived the WebSocket's retirement (`e81c1d3d`) as 46 lines that
 * read `x-authorizer-context` off a socket handshake, base64-decoded it, shape-checked it, and returned it as
 * an `AuthorizerContext` — with NO signature verification anywhere. It had zero importers, so it was inert;
 * but it was a loaded, correctly-named helper, and the next person wiring a socket gateway would have found
 * exactly it. Deleted alongside this gate. Absence of callers is not a security property — a grep that finds
 * nothing today finds something the moment someone reaches for the obvious name.
 *
 * Checks for the STRING in a non-test source, on G1's reasoning: there is no legitimate reason to write a
 * trusted-identity header name other than to read it. Comments are AST trivia and therefore invisible here,
 * which is what lets `auth.middleware.ts` keep the docstring explaining why the path does not exist without
 * the guard reporting its own rationale — the prose-defeats-the-gate trap two of these gates hit in review.
 *
 * @param service - The service to check.
 * @returns One finding per offending file.
 */
function trustedIdentityHeaderViolations(service: DiscoveredService): readonly string[] {
    return service.sources
        .filter((source) => !isTestFile(source.file))
        .flatMap((source) =>
            stringLiterals(source)
                .filter((literal) => /^x-(authorizer-context|user(-id)?|principal|identity)$/iu.test(literal.trim()))
                .map((literal) => `${source.file}: derives identity from the client-suppliable '${literal}' header`),
        );
}

/**
 * G2 — no route handler takes an UNVALIDATED body.
 *
 * `@Body() body: unknown` is the shape that forces a hand-rolled `safeParse` inside the handler, which is how a
 * validation branch ends up per-route, inconsistent, and occasionally forgotten. Typing the parameter as its DTO
 * is what makes the bound pipe (G5) responsible for it instead.
 *
 * Matches `unknown` and `any` — `any` is the same hole with the type checker also switched off.
 *
 * @param service - The service to check.
 * @returns One finding per offending parameter.
 */
function unvalidatedBodyViolations(service: DiscoveredService): readonly string[] {
    const findings: string[] = [];

    for (const source of service.sources.filter((candidate) => !isTestFile(candidate.file))) {
        visit(parse(source), (node) => {
            if (!ts.isParameter(node) || node.type === undefined) {
                return;
            }

            const isBody = ts
                .getDecorators(node)
                ?.some(
                    (decorator) =>
                        ts.isCallExpression(decorator.expression) &&
                        ts.isIdentifier(decorator.expression.expression) &&
                        decorator.expression.expression.text === 'Body',
                );

            const isOpaque =
                node.type.kind === ts.SyntaxKind.UnknownKeyword || node.type.kind === ts.SyntaxKind.AnyKeyword;

            if (isBody === true && isOpaque) {
                findings.push(
                    `${source.file}: @Body() typed as ${node.type.kind === ts.SyntaxKind.AnyKeyword ? 'any' : 'unknown'}`,
                );
            }
        });
    }

    return findings;
}

/**
 * G3 — `sql.raw` is never called.
 *
 * `sql.raw` splices its argument into the statement TEXT, bypassing parameterisation entirely. The ESLint rule
 * that bans it is the primary enforcement — but ESLint only sees files inside a tsconfig project and inside the
 * package's `lint` glob, and neither covers `infra/**` in any service (every `lint` script globs `src`/`tests`/
 * `contract` only, so no rule has ever run on a line of service infra code). This gate covers what the linter
 * structurally cannot see, which is the whole reason it is not redundant with it.
 *
 * Matched as a member CALL, so the rule's own message and this docstring are not findings.
 *
 * @param service - The service to check.
 * @returns One finding per call site.
 */
function sqlRawViolations(service: DiscoveredService): readonly string[] {
    const findings: string[] = [];

    for (const source of service.sources) {
        visit(parse(source), (node) => {
            if (
                ts.isCallExpression(node) &&
                ts.isPropertyAccessExpression(node.expression) &&
                node.expression.name.text === 'raw' &&
                ts.isIdentifier(node.expression.expression) &&
                node.expression.expression.text === 'sql'
            ) {
                findings.push(`${source.file}: calls sql.raw()`);
            }
        });
    }

    return findings;
}

/**
 * G4 — every service that receives QUEUE or WEBHOOK payloads parses them.
 *
 * An SQS/EventBridge/webhook payload is attacker-adjacent input that arrives with no framework pipe in front of
 * it: a raw Lambda handler is handed `event.Records[n].body` as a string and nothing validates it unless the
 * handler says so. The recorded failure is `c18a1765` — an unrecognised deletion event erasing an account —
 * which is what an unparsed discriminant does.
 *
 * Expressed as: a service with handlers must import zod somewhere in its handler tree. Deliberately coarse. A
 * precise "this handler parses THIS payload" check would need type-level dataflow, and a coarse gate that
 * cannot be satisfied accidentally is worth more than a precise one that is too expensive to keep honest — the
 * per-payload assertions live in each service's own suite.
 *
 * @param service - The service to check.
 * @returns One finding when a handler tree exists with no schema validation in it.
 */
function unparsedHandlerViolations(service: DiscoveredService): readonly string[] {
    const handlers = service.sources.filter(
        (source) => !isTestFile(source.file) && /(^|\/)(handlers|consumers|workers)\//u.test(source.file),
    );

    if (handlers.length === 0) {
        return [];
    }

    const validates = handlers.some((source) =>
        moduleSpecifiers(source).some((specifier) => specifier === 'zod' || specifier.endsWith('.schema.js')),
    );

    return validates ? [] : [`${service.name}: has handlers (${handlers.length}) but none validate their payload`];
}

/**
 * Whether a module file contains a provider object binding `ZodValidationPipe` to the `APP_PIPE` TOKEN.
 *
 * ⚠️ PARSED, NOT GREPPED, AND THAT IS NOT STYLE. The first version of this check asked whether the file's text
 * `includes('APP_PIPE')` and `includes('ZodValidationPipe')` — and it passed a deliberately broken binding
 * during its own mutation test, because the comment ABOVE the binding explains at length why the `APP_PIPE`
 * token is required. The gate was reading its own rationale as evidence. This is the same failure the file's
 * header warns about, committed by the file itself, which is why the mutation step is not optional.
 *
 * What actually matters is an object literal that says BOTH `provide: APP_PIPE` and supplies a
 * `ZodValidationPipe` — bug S-I1 was a pipe bound to the bare class token, which registers nothing.
 *
 * @param source - The module file.
 * @returns `true` when a real `APP_PIPE` → `ZodValidationPipe` provider is present.
 */
function bindsZodPipeGlobally(source: SourceFile): boolean {
    let bound = false;

    visit(parse(source), (node) => {
        if (!ts.isObjectLiteralExpression(node)) {
            return;
        }

        const properties = node.properties.filter(ts.isPropertyAssignment);
        const providesAppPipe = properties.some(
            (property) =>
                property.name.getText(parse(source)) === 'provide' ||
                (ts.isIdentifier(property.name) && property.name.text === 'provide'),
        );

        if (!providesAppPipe) {
            return;
        }

        const provideValue = properties.find(
            (property) => ts.isIdentifier(property.name) && property.name.text === 'provide',
        )?.initializer;

        if (provideValue === undefined || !ts.isIdentifier(provideValue) || provideValue.text !== 'APP_PIPE') {
            return;
        }

        // The pipe itself: `useValue: new ZodValidationPipe()` or `useClass: ZodValidationPipe`.
        const supplied = properties.filter(
            (property) =>
                ts.isIdentifier(property.name) && ['useValue', 'useClass', 'useFactory'].includes(property.name.text),
        );

        for (const property of supplied) {
            let mentionsZodPipe = false;

            visit(property.initializer as unknown as ts.SourceFile, (inner) => {
                if (ts.isIdentifier(inner) && inner.text === 'ZodValidationPipe') {
                    mentionsZodPipe = true;
                }
            });

            if (mentionsZodPipe) {
                bound = true;
            }
        }
    });

    return bound;
}

/**
 * Whether a controller declares a real `@Body()` or `@Query()` PARAMETER — i.e. accepts structured payload
 * input that a body pipe is responsible for.
 *
 * ⚠️ PARSED, NOT GREPPED, for the second time in this file and for the same reason. The text version
 * (`/@(Body|Query)\(/.test(contents)`) reported `versions.controller.ts` the moment that file's docstring was
 * rewritten to EXPLAIN that it has "no `@Body()` and no `@Query()`". Two of this file's five gates were
 * defeated by prose during their own mutation tests, which is the most direct evidence available that a
 * repo-wide gate over source text has to go through a parser.
 *
 * @param source - The controller file.
 * @returns `true` when at least one parameter carries a `@Body()`/`@Query()` decorator.
 */
function acceptsStructuredInput(source: SourceFile): boolean {
    let accepts = false;

    visit(parse(source), (node) => {
        if (!ts.isParameter(node)) {
            return;
        }

        const named = ts
            .getDecorators(node)
            ?.some(
                (decorator) =>
                    ts.isCallExpression(decorator.expression) &&
                    ts.isIdentifier(decorator.expression.expression) &&
                    ['Body', 'Query'].includes(decorator.expression.expression.text),
            );

        if (named === true) {
            accepts = true;
        }
    });

    return accepts;
}

/**
 * Whether a controller declares `@UsePipes(ZodValidationPipe)` at the class level.
 *
 * Parsed for the same reason as everything else here: a docstring that names the decorator (and several in this
 * repo do, to explain that the pipe is load-bearing) must not count as declaring it.
 *
 * @param source - The controller file.
 * @returns `true` when a real `@UsePipes(...)` decorator references `ZodValidationPipe`.
 */
function usesZodPipe(source: SourceFile): boolean {
    let used = false;

    visit(parse(source), (node) => {
        if (
            !ts.isDecorator(node) ||
            !ts.isCallExpression(node.expression) ||
            !ts.isIdentifier(node.expression.expression) ||
            node.expression.expression.text !== 'UsePipes'
        ) {
            return;
        }

        for (const argument of node.expression.arguments) {
            if (ts.isIdentifier(argument) && argument.text === 'ZodValidationPipe') {
                used = true;
            }
        }
    });

    return used;
}

/**
 * G5 — every HTTP controller is covered by a ZOD validation pipe.
 *
 * ⚠️ THE TRAP THIS EXISTS FOR: a `createZodDto` class carries NO `class-validator` metadata, so under Nest's own
 * `ValidationPipe` it validates NOTHING while looking perfectly wired. The two mistakes are therefore (a) no
 * pipe at all, and (b) the WRONG pipe — and (b) is worse, because it presents as correct. A controller counts as
 * covered when its service binds `ZodValidationPipe` globally via the `APP_PIPE` token (the bare class token does
 * not register a global pipe — that was bug S-I1), or when the controller itself declares
 * `@UsePipes(ZodValidationPipe)`.
 *
 * Only controllers that ACCEPT STRUCTURED INPUT are in scope — i.e. those declaring a `@Body()` or `@Query()`
 * parameter. That is the invariant rather than a convenience: a health probe or a route whose only input is a
 * path param already narrowed by `ParseUUIDPipe` has nothing for a body pipe to validate, and demanding a pipe
 * there is what produces the inert, looks-wired `@UsePipes(new ValidationPipe())` decoration this gate exists
 * to distrust. A `@Param()` alone does not qualify: path params are validated per-parameter, and G5 is about
 * the payload surface.
 *
 * @param service - The service to check.
 * @returns One finding per uncovered controller.
 */
function unpipedControllerViolations(service: DiscoveredService): readonly string[] {
    const globallyPiped = service.sources
        .filter((source) => /(^|\/)app\.module\.ts$/u.test(source.file))
        .some((source) => bindsZodPipeGlobally(source));

    if (globallyPiped) {
        return [];
    }

    return service.sources
        .filter((source) => source.file.endsWith('.controller.ts') && !isTestFile(source.file))
        .filter((source) => acceptsStructuredInput(source))
        .filter((source) => !usesZodPipe(source))
        .map((source) => `${source.file}: no ZodValidationPipe (neither a global APP_PIPE nor @UsePipes)`);
}

/**
 * The FAKE SIXTH SERVICE — every invariant above, violated at once.
 *
 * This is the mutation proof. Each gate is asserted to fire on this fixture, so a gate that stopped matching
 * (a renamed decorator, a parser change, an inverted condition) fails here rather than passing vacuously
 * against a clean tree forever.
 */
const VIOLATING_SERVICE: DiscoveredService = {
    name: 'fake-service',
    packageName: '@kitchensink/fake-service',
    sources: [
        {
            file: 'packages/services/fake-service/src/main.ts',
            contents: `
                // A comment mentioning trust proxy must NOT count — only the literal below does.
                const app = await NestFactory.create(AppModule);
                app.set('trust proxy', true);
                await app.listen(3000);
            `,
        },
        {
            // No APP_PIPE / ZodValidationPipe here, which is what leaves the controller uncovered.
            file: 'packages/services/fake-service/src/app.module.ts',
            contents: `
                @Module({ providers: [{ provide: APP_FILTER, useClass: ApiExceptionFilter }] })
                export class AppModule {}
            `,
        },
        {
            file: 'packages/services/fake-service/src/things/things.controller.ts',
            contents: `
                import { IsString } from 'class-validator';

                @Controller('things')
                @UsePipes(new ValidationPipe({ transform: true }))
                export class ThingsController {
                    @Post()
                    public async create(@Body() body: unknown): Promise<void> {}

                    @Patch(':id')
                    public async update(@Param('id') id: string, @Body() body: any): Promise<void> {}
                }
            `,
        },
        {
            // The PR #39 shape, rebuilt: a header read, decoded, shape-checked, and trusted as the caller.
            // Shape-checking is not verifying — it proves the attacker sent well-formed JSON, nothing more.
            file: 'packages/services/fake-service/src/auth/wsAuth.ts',
            contents: `
                // A comment naming x-authorizer-context must NOT count — only the literal below does.
                export function resolveContext(socket) {
                    const raw = socket.handshake?.headers?.['x-authorizer-context'];
                    return JSON.parse(Buffer.from(raw, 'base64').toString('utf-8'));
                }
            `,
        },
        {
            file: 'packages/services/fake-service/src/things/things.dao.ts',
            contents: `
                export const bad = (column: string) => db.execute(sql\`select \${sql.raw(column)} from things\`);
            `,
        },
        {
            file: 'packages/services/fake-service/src/handlers/thing-worker.ts',
            contents: `
                export const handler = async (event) => {
                    const body = JSON.parse(event.Records[0].body);

                    return doTheThing(body.id);
                };
            `,
        },
    ],
};

const services = discoverServices();

/*
 * ⛔ THE `UNCONVERGED_CONTROLLERS` RATCHET IS GONE, BECAUSE ITS DEBT IS PAID.
 *
 * It held one name — `packages/services/recipe-service/src/search/search.controller.ts`, which bound Nest's own
 * `ValidationPipe` over `SearchRecipesQueryDto`, the last `class-validator` DTO in `packages/services/**`. That
 * controller now binds `ZodValidationPipe` over a `createZodDto` of the authored `recipeSearchQuerySchema`, so
 * G5 below is asserted with NO exception list at all.
 *
 * Deleting the constant rather than keeping it at zero entries is what the ratchet's own docstring required, and
 * it is the stronger shape: an empty allowlist is still an allowlist, and a future controller could be added to
 * it as a one-line diff that reads like configuration. There is now no line to add.
 */

describe('every deployable service satisfies the repo-wide security invariants', () => {
    // A guard on the guard: if discovery yields nothing, every assertion below passes vacuously.
    it('discovers the services it is meant to constrain', () => {
        expect(services.map((service) => service.name)).toContain('identity');
        expect(services.length).toBeGreaterThanOrEqual(5);
        expect(services.every((service) => service.sources.length > 0)).toBe(true);
    });

    it.each([
        ['G1 never configures Express `trust proxy`', trustProxyViolations],
        ['G2 never takes an `unknown`/`any` request body', unvalidatedBodyViolations],
        ['G3 never calls `sql.raw`', sqlRawViolations],
        ['G4 validates every queue/webhook payload', unparsedHandlerViolations],
        ['G6 never derives identity from a client-suppliable header', trustedIdentityHeaderViolations],
    ] as const)('%s', (_title, check) => {
        expect(services.flatMap((service) => check(service))).toEqual([]);
    });

    it('G5 covers EVERY HTTP controller with a ZodValidationPipe, with no exceptions left', () => {
        expect(services.flatMap((service) => unpipedControllerViolations(service))).toEqual([]);
    });

    /**
     * The mutation proof. Every gate above is asserted to FIRE on a service that breaks it — so a gate that
     * silently stops matching fails here instead of passing against a clean tree forever.
     */
    describe('the gates actually fire — proven against a fake sixth service that violates all of them', () => {
        it('G1 catches a `trust proxy` setting, and does NOT catch the comment above it', () => {
            expect(trustProxyViolations(VIOLATING_SERVICE)).toEqual([
                "packages/services/fake-service/src/main.ts: configures 'trust proxy'",
            ]);
        });

        it('G2 catches both `unknown` and `any` bodies', () => {
            expect(unvalidatedBodyViolations(VIOLATING_SERVICE)).toHaveLength(2);
            expect(unvalidatedBodyViolations(VIOLATING_SERVICE).join('\n')).toContain('@Body() typed as unknown');
            expect(unvalidatedBodyViolations(VIOLATING_SERVICE).join('\n')).toContain('@Body() typed as any');
        });

        it('G6 catches the header read, and does NOT catch the comment naming it', () => {
            const findings = trustedIdentityHeaderViolations(VIOLATING_SERVICE);

            expect(findings).toEqual([
                "packages/services/fake-service/src/auth/wsAuth.ts: derives identity from the client-suppliable 'x-authorizer-context' header",
            ]);
        });

        it('G3 catches a `sql.raw` call', () => {
            expect(sqlRawViolations(VIOLATING_SERVICE)).toEqual([
                'packages/services/fake-service/src/things/things.dao.ts: calls sql.raw()',
            ]);
        });

        it('G4 catches a handler that parses its payload with JSON.parse and nothing else', () => {
            expect(unparsedHandlerViolations(VIOLATING_SERVICE)).toHaveLength(1);
        });

        it('G5 catches Nest’s own ValidationPipe standing in for the Zod one — the looks-wired trap', () => {
            expect(unpipedControllerViolations(VIOLATING_SERVICE)).toEqual([
                'packages/services/fake-service/src/things/things.controller.ts: no ZodValidationPipe (neither a global APP_PIPE nor @UsePipes)',
            ]);
        });

        it('G5 accepts a global APP_PIPE binding and a per-controller @UsePipes alike', () => {
            const globallyPiped: DiscoveredService = {
                ...VIOLATING_SERVICE,
                sources: VIOLATING_SERVICE.sources.map((source) =>
                    source.file.endsWith('app.module.ts')
                        ? {
                              ...source,
                              contents: `
                                  @Module({
                                      providers: [{ provide: APP_PIPE, useValue: new ZodValidationPipe() }],
                                  })
                                  export class AppModule {}
                              `,
                          }
                        : source,
                ),
            };
            const locallyPiped: DiscoveredService = {
                ...VIOLATING_SERVICE,
                sources: VIOLATING_SERVICE.sources.map((source) =>
                    source.file.endsWith('.controller.ts')
                        ? { ...source, contents: '@UsePipes(ZodValidationPipe)\nexport class ThingsController {}' }
                        : source,
                ),
            };

            expect(unpipedControllerViolations(globallyPiped)).toEqual([]);
            expect(unpipedControllerViolations(locallyPiped)).toEqual([]);
        });

        it('the APP_PIPE token is what counts — binding the bare class token is bug S-I1, not coverage', () => {
            const bareToken: DiscoveredService = {
                ...VIOLATING_SERVICE,
                sources: VIOLATING_SERVICE.sources.map((source) =>
                    source.file.endsWith('app.module.ts')
                        ? {
                              ...source,
                              contents: `
                                  // Mentions APP_PIPE in PROSE, which must not count as a binding — the first
                                  // version of this gate was defeated by exactly that.
                                  @Module({
                                      providers: [{ provide: ZodValidationPipe, useValue: new ZodValidationPipe() }],
                                  })
                                  export class AppModule {}
                              `,
                          }
                        : source,
                ),
            };

            expect(unpipedControllerViolations(bareToken)).not.toEqual([]);
        });
    });

    /**
     * False-positive guards. Each of these SHOULD pass, and each corresponds to real text in the tree that a
     * textual version of the same gate reported. A gate that fires on the prose explaining it gets deleted.
     */
    describe('does not report prose, rule messages, or test fixtures', () => {
        it('ignores `trust proxy` discussed in a comment — which is where the real tree names it', () => {
            expect(
                trustProxyViolations({
                    name: 'prose',
                    packageName: 'prose',
                    sources: [
                        {
                            file: 'packages/services/prose/src/guard.ts',
                            contents: `
                                /**
                                 * We deliberately do NOT enable \`trust proxy\`, so req.ip is the ALB's address
                                 * and a client cannot forge X-Forwarded-For to rotate its bucket key.
                                 */
                                export const tracker = (req) => req.ip;
                            `,
                        },
                    ],
                }),
            ).toEqual([]);
        });

        it('ignores `sql.raw` named in prose rather than called', () => {
            expect(
                sqlRawViolations({
                    name: 'prose',
                    packageName: 'prose',
                    sources: [
                        {
                            file: 'packages/services/prose/src/dao.ts',
                            contents: '// Do not use sql.raw() — it bypasses parameterisation.\nexport const q = 1;',
                        },
                    ],
                }),
            ).toEqual([]);
        });

        it('ignores a controller whose DOCSTRING says it has no @Body()/@Query() — the real regression', () => {
            // `versions.controller.ts` gained exactly this docstring, and the textual version of G5 promptly
            // reported it. Two of this file's gates were defeated by prose during their own mutation tests.
            expect(
                acceptsStructuredInput({
                    file: 'packages/services/prose/src/versions.controller.ts',
                    contents: `
                        /**
                         * THERE IS DELIBERATELY NO VALIDATION PIPE: this controller has no \`@Body()\` and no
                         * \`@Query()\`, and every parameter is a primitive covered by \`ParseUUIDPipe\`.
                         */
                        @Controller('versions')
                        export class VersionsController {
                            @Get()
                            public list(@Param('recipeId', ParseUUIDPipe) recipeId: string) {}
                        }
                    `,
                }),
            ).toBe(false);
        });

        it('ignores a @UsePipes named only in a docstring', () => {
            expect(
                usesZodPipe({
                    file: 'packages/services/prose/src/things.controller.ts',
                    contents: '/** The pipe is `@UsePipes(ZodValidationPipe)` elsewhere. */ export class C {}',
                }),
            ).toBe(false);
        });

        it('ignores a `@Body()` typed as its DTO, which is the shape the gate is steering toward', () => {
            expect(
                unvalidatedBodyViolations({
                    name: 'ok',
                    packageName: 'ok',
                    sources: [
                        {
                            file: 'packages/services/ok/src/things.controller.ts',
                            contents: '@Post() create(@Body() body: CreateThingDto) {}',
                        },
                    ],
                }),
            ).toEqual([]);
        });
    });
});
