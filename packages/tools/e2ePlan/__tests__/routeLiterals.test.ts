import { describe, expect, it } from 'vitest';

import { routeLiterals } from '../src/routeLiterals.js';

const find = (body: string) => routeLiterals(`async function t(page) { ${body} }`, 'x.spec.ts');

describe('routeLiterals', () => {
    it('collects a literal passed to route() inside goto()', () => {
        expect(find("await page.goto(route('/recipes'));")).toEqual({ paths: ['/recipes'], dynamic: false });
    });

    it('collects every distinct path once', () => {
        const found = find("await page.goto(route('/a')); await page.goto(route('/b')); await page.goto(route('/a'));");

        expect(found.paths).toEqual(['/a', '/b']);
    });

    it('collects pseudoRoute too, and a plain goto of a path', () => {
        expect(find("await page.goto(pseudoRoute('/collections')); await page.goto('/profile');").paths).toEqual([
            '/collections',
            '/profile',
        ]);
    });

    it('turns a template substitution into a placeholder segment', () => {
        expect(find('await page.goto(route(`/recipes/${id}/edit`));').paths).toEqual(['/recipes/__dynamic__/edit']);
    });

    it('collects the route inside a template that adds a query to it', () => {
        const found = find('await page.goto(`${route("/sign-in")}?__clerk_ticket=${token}`);');

        expect(found).toEqual({ paths: ['/sign-in'], dynamic: false });
    });

    it('reports dynamic when the path is a variable, which no reading of the file can resolve', () => {
        expect(find('await page.goto(route(path));')).toEqual({ paths: [], dynamic: true });
        expect(find('await page.goto(route(spec.route));').dynamic).toBe(true);
        expect(find('await page.goto(target);').dynamic).toBe(true);
    });

    it('ignores page.route() network interception, which is not a visit', () => {
        expect(find("await page.route('**/api/**', handler);")).toEqual({ paths: [], dynamic: false });
    });

    it('ignores an absolute URL and about:blank', () => {
        expect(find("await page.goto('about:blank'); await page.goto('https://example.com/x');")).toEqual({
            paths: [],
            dynamic: false,
        });
    });

    it('strips a query and fragment before comparing', () => {
        expect(find("await page.goto(route('/discover?query=e#top'));").paths).toEqual(['/discover']);
    });

    describe('URL assertions, which show where a click ends up', () => {
        it('reads the path out of a regular expression', () => {
            expect(find('await expect(page).toHaveURL(/\\/recipes\\/new/u);').paths).toEqual(['/recipes/new']);
            expect(find('await page.waitForURL(/\\/collections$/);').paths).toEqual(['/collections']);
        });

        it('keeps each path-shaped run of a regular expression that has a gap in it', () => {
            const found = find('await expect(page).toHaveURL(/\\/recipes\\/[0-9a-f-]{36}\\/edit/u);');

            expect(found.paths).toEqual(['/recipes', '/edit']);
        });

        it('reads a string and a template, and the path inside new RegExp()', () => {
            expect(find("await expect(page).toHaveURL('/profile');").paths).toEqual(['/profile']);
            expect(find('await expect(page).toHaveURL(new RegExp(`/recipes/${id}/edit`));').paths).toEqual([
                '/recipes/__dynamic__/edit',
            ]);
        });

        it('ignores an assertion about the query only', () => {
            expect(find('await expect(page).toHaveURL(/dietaryFlags=vegan/u);')).toEqual({ paths: [], dynamic: false });
        });

        it('does not call an assertion on a variable dynamic, since the visit itself is read elsewhere', () => {
            expect(find('await expect(page).toHaveURL(parent);').dynamic).toBe(false);
        });
    });
});
