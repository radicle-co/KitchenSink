// @vitest-environment node
/**
 * Repo-wide guard (plan 002 S3, property 4): no path the production edge SHARES across callers reaches a route that
 * reads the caller.
 *
 * `EDGE_POLICY.<service>.sharedCachePathPatterns` keys a response on its URL and `Origin` alone (ADR-0020), so the
 * edge serves one caller's response to every other. That is sound only for a route whose answer does not depend on who
 * asks. The route that answers a path is decided by the SERVICE (its controllers, in declaration order), and the
 * pattern by the EDGE, in another package; nothing else ties the two together. This guard does, from both sources:
 *
 * | Rule | Violation                                                                                                   |
 * | ---- | ----------------------------------------------------------------------------------------------------------- |
 * | R1   | a pattern holds a CloudFront wildcard (`*` or `?`), so it reaches routes nobody reviewed                      |
 * | R2   | a pattern matches no `GET` route, so it is stale or misspelt                                                 |
 * | R3   | the route that SERVES the pattern takes anything but `@Query`/`@Param` — the first matching `GET` route in     |
 * |      | declaration order, which is a `:param` route when that one is declared first                                 |
 *
 * Routes are read by `serviceSources.ts`'s `declaredRoutes` from every production `*.controller.ts` in the service,
 * never from a list, so a new route is covered the day it lands. Files come from the git index (`discoverServices`), so
 * a new controller is seen locally only once it is staged (`git add -N`).
 *
 * ⚠️ R3 reads the HANDLER's parameters. A guard or interceptor that reads the caller and changes the response (the
 * throttler's `X-RateLimit-*` headers) is outside it; the service's own suites assert those
 * (`food-service/tests/catalogSearchApi.integration.test.ts`).
 *
 * @pattern Fitness function — an architectural invariant made executable over the real tree
 */
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { EDGE_POLICY } from '../lib/platform/EdgeStack.js';
import {
    declaredRoutes,
    discoverServices,
    isServiceDirectoryOf,
    isTestFile,
    servingRoutes,
    type DeclaredRoute,
    type SourceFile,
} from './serviceSources.js';

/** The parameter decorators that read only the request's URL, which is the shared cache's key. */
const URL_ONLY_PARAMETERS: ReadonlySet<string> = new Set(['Query', 'Param']);

/**
 * The violations of R1–R3 for one service's shared patterns over its declared routes. Pure.
 *
 * @param patterns - The service's `sharedCachePathPatterns`.
 * @param routes - The service's declared routes.
 * @returns One message per violation; empty when every pattern is sound.
 */
function sharedCacheViolations(patterns: readonly string[], routes: readonly DeclaredRoute[]): string[] {
    return patterns.flatMap((pattern) => {
        if (/[*?]/u.test(pattern)) {
            return [`R1 ${pattern}: a CloudFront wildcard reaches routes nobody reviewed — share an exact path`];
        }

        const serving = servingRoutes(routes, 'Get', pattern);

        if (serving.length === 0) {
            return [`R2 ${pattern}: no GET route serves this shared path`];
        }

        if (new Set(serving.map((route) => route.controller)).size > 1) {
            return [`R3 ${pattern}: served by more than one controller, so which answers depends on module order`];
        }

        const first = serving[0]!;
        const readsCaller = first.parameters.filter((name) => !URL_ONLY_PARAMETERS.has(name));

        return readsCaller.length === 0
            ? []
            : [
                  `R3 ${pattern}: served by ${first.where}, which reads ${readsCaller.map((name) => `@${name}`).join(', ')}`,
              ];
    });
}

/**
 * The production controller sources of the service an `EDGE_POLICY` entry names.
 *
 * @param service - The registered service.
 * @returns Its `*.controller.ts` files, tests excluded.
 * @sideEffect Reads the services tree.
 */
function controllersOf(service: string): readonly SourceFile[] {
    const discovered = discoverServices().find((candidate) => isServiceDirectoryOf(candidate.name, service));

    expect(discovered, `no packages/services directory serves ${service}`).toBeDefined();

    return discovered!.sources.filter((source) => source.file.endsWith('.controller.ts') && !isTestFile(source.file));
}

describe('no shared edge path reaches a route that reads the caller (plan 002 S3, property 4)', () => {
    const shared = Object.entries(EDGE_POLICY).filter(([, policy]) => policy.sharedCachePathPatterns.length > 0);

    it('is not vacuous: the food catalog search and nutrition are discovered as the routes serving their paths', () => {
        const routes = declaredRoutes(controllersOf('food'));
        const servingOf = (literal: string): string | undefined => servingRoutes(routes, 'Get', literal)[0]?.where;

        expect(shared.map(([service]) => service)).toContain('food');
        expect(servingOf('/api/v1/foods/catalog/search')).toBe('FoodsController.searchCatalog');
        expect(servingOf('/v1/foods/catalog/search')).toBe('FoodsController.searchCatalog');
        expect(servingOf('/api/v1/foods/nutrition')).toBe('FoodsController.getNutritionBatch');
    });

    it.each(shared)('holds for %s in the real tree', (service, policy) => {
        expect(sharedCacheViolations(policy.sharedCachePathPatterns, declaredRoutes(controllersOf(service)))).toEqual(
            [],
        );
    });
});

describe('sharedCacheViolations — the shapes it must and must not see', () => {
    /**
     * One controller's source.
     *
     * @param body - The class body.
     * @returns The source file.
     */
    function controller(body: string): readonly SourceFile[] {
        return [
            {
                file: path.posix.join('fixture', 'x.controller.ts'),
                contents: `@Controller(['api/v1/x', 'v1/x'])\nclass XController {\n${body}\n}`,
            },
        ];
    }

    const clean = controller(
        [
            "    @Get('shared')",
            '    public shared(@Query() query: Q): void {}',
            "    @Get(':id')",
            "    public byId(@Param('id') id: string, @Req() req: R): void {}",
        ].join('\n'),
    );

    it.each([
        ['a clean literal route declared before the :id route', clean, ['/api/v1/x/shared', '/v1/x/shared'], []],
        [
            'a prefix pattern',
            clean,
            ['/api/v1/x/shared*'],
            ['R1 /api/v1/x/shared*: a CloudFront wildcard reaches routes nobody reviewed — share an exact path'],
        ],
        [
            'a one-character wildcard',
            clean,
            ['/api/v1/x/share?'],
            ['R1 /api/v1/x/share?: a CloudFront wildcard reaches routes nobody reviewed — share an exact path'],
        ],
        [
            'a pattern no route serves',
            clean,
            ['/api/v1/x/a/b'],
            ['R2 /api/v1/x/a/b: no GET route serves this shared path'],
        ],
        [
            'a path only the :id route serves',
            clean,
            ['/api/v1/x/other'],
            ['R3 /api/v1/x/other: served by XController.byId, which reads @Req'],
        ],
        [
            'the literal route declared AFTER the :id route',
            controller(
                [
                    "    @Get(':id')",
                    "    public byId(@Param('id') id: string, @Req() req: R): void {}",
                    "    @Get('shared')",
                    '    public shared(@Query() query: Q): void {}',
                ].join('\n'),
            ),
            ['/api/v1/x/shared'],
            ['R3 /api/v1/x/shared: served by XController.byId, which reads @Req'],
        ],
        [
            'a literal route whose handler reads the request',
            controller(
                ["    @Get('shared')", '    public shared(@Query() query: Q, @Req() req: R): void {}'].join('\n'),
            ),
            ['/api/v1/x/shared'],
            ['R3 /api/v1/x/shared: served by XController.shared, which reads @Req'],
        ],
        [
            'a custom caller decorator',
            controller(["    @Get('shared')", '    public shared(@OwnerId() owner: string): void {}'].join('\n')),
            ['/api/v1/x/shared'],
            ['R3 /api/v1/x/shared: served by XController.shared, which reads @OwnerId'],
        ],
        [
            'an @All route declared first, which Express also answers GET with',
            controller(
                [
                    "    @All('shared')",
                    '    public any(@Req() req: R): void {}',
                    "    @Get('shared')",
                    '    public shared(@Query() query: Q): void {}',
                ].join('\n'),
            ),
            ['/api/v1/x/shared'],
            ['R3 /api/v1/x/shared: served by XController.any, which reads @Req'],
        ],
        [
            'a route that differs only in case, declared first (Express matches paths case-insensitively)',
            controller(
                [
                    "    @Get('Shared')",
                    '    public loud(@Req() req: R): void {}',
                    "    @Get('shared')",
                    '    public shared(@Query() query: Q): void {}',
                ].join('\n'),
            ),
            ['/api/v1/x/shared'],
            ['R3 /api/v1/x/shared: served by XController.loud, which reads @Req'],
        ],
        [
            'a POST route at the shared path, which the edge never caches',
            controller(["    @Post('shared')", '    public shared(@Body() body: B): void {}'].join('\n')),
            ['/api/v1/x/shared'],
            ['R2 /api/v1/x/shared: no GET route serves this shared path'],
        ],
    ] as const)('%s', (_label, sources, patterns, expected) => {
        expect(sharedCacheViolations(patterns, declaredRoutes(sources))).toEqual(expected);
    });

    it('reads every prefix of a controller, so the deprecated alias is checked too', () => {
        expect(declaredRoutes(clean).map((route) => route.path)).toEqual([
            '/api/v1/x/shared',
            '/v1/x/shared',
            '/api/v1/x/:id',
            '/v1/x/:id',
        ]);
    });

    it('refuses a route path it cannot read, rather than vouching for it', () => {
        expect(() =>
            declaredRoutes(controller(['    @Get(SHARED_PATH)', '    public shared(): void {}'].join('\n'))),
        ).toThrow(/not a string literal/u);
    });
});
