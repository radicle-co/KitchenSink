// @vitest-environment node
/**
 * Plan 002 R42: food's per-user cap on `GET /api/v1/foods/search/live` is no looser than the per-user cap the recipe
 * service applies to the proxy route it replaces (`GET /api/v1/ingredients/search/live`, `@WriteRateLimit`).
 *
 * The proxy's cap is the only per-user control on this path today. When the apps call food directly (plan 002 S5)
 * and the proxy is deleted (S6), food's cap must already hold at least that line, or the deletion loosens it.
 *
 * It lives here because it compares two services, and neither service may import the other. Both sides are read
 * from the modules that own them, so neither number is restated.
 *
 * ⛔ S6 DELETES the recipe route, and then the premise check below fails on purpose. Delete this file in that change:
 * from then on food's cap is the only one, and there is nothing to compare it with.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import {
    LIVE_SEARCH_PER_USER_LIMIT,
    THROTTLE_WINDOW_MS as FOOD_WINDOW_MS,
} from '../../../services/food-service/src/common/throttle/throttle.config.js';
import { THROTTLE_WINDOW_MS as RECIPE_WINDOW_MS } from '../../../services/recipe-service/src/common/throttle/throttle.config.js';
import { RATE_LIMIT_DEFAULTS } from '../../../services/recipe-service/src/common/throttle/throttleDefaults.js';
import { parse, repoRoot, visit } from './serviceSources.js';

/** The recipe controller that serves the proxy route. */
const RECIPE_CONTROLLER = 'packages/services/recipe-service/src/ingredients/ingredients.controller.ts';

/**
 * The decorator names on the method a controller routes `GET <route>` to. Pure.
 *
 * @param file - Repo-relative path, for the parser.
 * @param contents - The controller's source.
 * @param route - The `@Get(…)` argument.
 * @returns The names of every decorator on that method, or `undefined` when no method routes it.
 */
function decoratorsOnGetRoute(file: string, contents: string, route: string): readonly string[] | undefined {
    let found: readonly string[] | undefined;

    visit(parse({ file, contents }), (node) => {
        if (!ts.isMethodDeclaration(node)) {
            return;
        }

        const calls = (ts.getDecorators(node) ?? [])
            .map((decorator) => decorator.expression)
            .filter((expression): expression is ts.CallExpression => ts.isCallExpression(expression));
        const routes = calls.some(
            (call) =>
                ts.isIdentifier(call.expression) &&
                call.expression.text === 'Get' &&
                call.arguments[0] !== undefined &&
                ts.isStringLiteral(call.arguments[0]) &&
                call.arguments[0].text === route,
        );

        if (routes) {
            found = calls.flatMap((call) => (ts.isIdentifier(call.expression) ? [call.expression.text] : []));
        }
    });

    return found;
}

describe('the live-search per-user cap (plan 002 R42)', () => {
    it('reads the premise: the recipe proxy route still exists and still carries the write budget', () => {
        const decorators = decoratorsOnGetRoute(
            RECIPE_CONTROLLER,
            readFileSync(path.join(repoRoot, RECIPE_CONTROLLER), 'utf8'),
            'search/live',
        );

        // If this fails because S6 deleted the route, delete this file in the same change (see the docblock).
        expect(decorators).toContain('WriteRateLimit');
    });

    it('counts over the same window on both sides, so the limits compare directly', () => {
        expect(FOOD_WINDOW_MS).toBe(RECIPE_WINDOW_MS);
    });

    it("is no looser than the recipe service's write budget", () => {
        expect(LIVE_SEARCH_PER_USER_LIMIT).toBeLessThanOrEqual(RATE_LIMIT_DEFAULTS.RATE_LIMIT_WRITE);
    });
});

describe('decoratorsOnGetRoute — reading a route off a controller', () => {
    const controller = [
        'class C {',
        "    @Get('search/live')",
        '    @WriteRateLimit()',
        '    public live(): void {}',
        '',
        "    @Get('search')",
        '    @SearchRateLimit()',
        '    public search(): void {}',
        '}',
    ].join('\n');

    it('finds the decorators on the method that routes the path', () => {
        expect(decoratorsOnGetRoute('c.ts', controller, 'search/live')).toEqual(['Get', 'WriteRateLimit']);
    });

    it('does not confuse a route with one that shares its prefix', () => {
        expect(decoratorsOnGetRoute('c.ts', controller, 'search')).toEqual(['Get', 'SearchRateLimit']);
    });

    it('answers undefined for a route no method serves, so a deleted route fails the premise', () => {
        expect(decoratorsOnGetRoute('c.ts', controller, 'search/deleted')).toBeUndefined();
    });
});
