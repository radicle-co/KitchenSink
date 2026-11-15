import { describe, expect, it } from 'vitest';

import { SOURCE_LINK_MAX_LENGTH, extractSourceLink, parseSourceLink } from '../sourceLink.js';

/**
 * ADR-0089: a pasted http(s) link is the recipe's web source. These pin the PURE reading of that link: which text is a
 * source, which site it names, and which pasted line is only a link (and so leaves the ingredient or step text).
 */
describe('parseSourceLink', () => {
    it.each([
        ['https://www.allrecipes.com/recipe/1/soup/', 'allrecipes.com'],
        ['http://example.com/a', 'example.com'],
        ['https://m.example.co.uk/recipe?id=3#top', 'example.co.uk'],
        ['https://cooking.nytimes.com/recipes/1', 'nytimes.com'],
        ['  https://example.com/a  ', 'example.com'],
    ])('%s names the site %s', (text, site) => {
        const result = parseSourceLink(text);

        expect(result).toMatchObject({ ok: true, link: { site } });
    });

    it('keeps the address the parser resolves, so the stored citation is a real URL', () => {
        expect(parseSourceLink('https://example.com')).toEqual({
            ok: true,
            link: { url: 'https://example.com/', site: 'example.com' },
        });
    });

    it.each([
        ['https://example.com/a.', 'https://example.com/a'],
        ['https://example.com/a),', 'https://example.com/a'],
        ['https://example.com/a?x=1!', 'https://example.com/a?x=1'],
        ['https://example.com/a)', 'https://example.com/a'],
        ['https://example.com/a]', 'https://example.com/a'],
        ['https://example.com/a}.', 'https://example.com/a'],
        ['https://example.com/Pie_(food)).', 'https://example.com/Pie_(food)'],
    ])('drops trailing punctuation from %s', (text, url) => {
        expect(parseSourceLink(text)).toMatchObject({ ok: true, link: { url } });
    });

    // A closing bracket that the address itself opened is part of the address (a Wikipedia title, a query with a list):
    // only an UNBALANCED one is sentence punctuation.
    it.each([
        ['https://en.wikipedia.org/wiki/Pie_(food)', 'https://en.wikipedia.org/wiki/Pie_(food)'],
        ['https://en.wikipedia.org/wiki/Pie_(food).', 'https://en.wikipedia.org/wiki/Pie_(food)'],
        ['https://example.com/a?tags=[x]', 'https://example.com/a?tags=[x]'],
        ['https://example.com/a?q={x}', 'https://example.com/a?q={x}'],
    ])('keeps a closing bracket the address opened: %s', (text, url) => {
        expect(parseSourceLink(text)).toMatchObject({ ok: true, link: { url: new URL(url).href } });
    });

    it('names an IDN site by its registrable domain', () => {
        const result = parseSourceLink('https://www.bücher.example/rezept');

        expect(result).toMatchObject({ ok: true, link: { site: 'xn--bcher-kva.example' } });
    });

    it.each([
        'https://commise.app/recipes/1',
        'https://www.commise.app',
        'https://pr-12.sandbox.commise.app/en',
        'HTTP://API.COMMISE.APP/x',
    ])('refuses our own site: %s', (text) => {
        expect(parseSourceLink(text)).toEqual({ ok: false, reason: 'ownSite' });
    });

    it('does not mistake a look-alike host for our own site', () => {
        expect(parseSourceLink('https://notcommise.app/x')).toMatchObject({ ok: true });
        expect(parseSourceLink('https://commise.app.evil.example/x')).toMatchObject({
            ok: true,
            link: { site: 'evil.example' },
        });
    });

    it.each([
        '',
        '   ',
        'not a link',
        'example.com/recipe',
        'mailto:cook@example.com',
        'javascript:alert(1)',
        'ftp://example.com/a',
        'https://user:pass@example.com/a',
        'https://localhost/a',
        'https://192.168.1.5/recipe',
        'https://[::1]/recipe',
        'https://example.com/a b',
        `https://example.com/${'a'.repeat(SOURCE_LINK_MAX_LENGTH)}`,
    ])('refuses %j as invalid', (text) => {
        expect(parseSourceLink(text)).toEqual({ ok: false, reason: 'invalid' });
    });
});

// A hostile citation is read on the request path of POST, PATCH and the import route, and in the editor on every keystroke. Its
// cost must be linear in the text: a regex over a long run of trailing punctuation was quadratic (a 99k-character citation
// took about 2 s). The bound is generous, because a correct reader returns in about a millisecond.
describe('parseSourceLink — a hostile length costs next to nothing', () => {
    const FAST_MS = 50;

    const timed = (text: string) => {
        const started = performance.now();
        const result = parseSourceLink(text);

        return { result, ms: performance.now() - started };
    };

    it.each([
        ['a 1 MB run of "!"', '!'.repeat(1_000_000)],
        ['an address followed by a 1 MB run of "!"', `https://example.com/a${'!'.repeat(1_000_000)}`],
        ['a 1 MB run of mixed trailing punctuation', `https://example.com/a${'.,;:!?)]}>\'"'.repeat(100_000)}`],
        ['an address, 1 MB of spaces, then more text', `https://example.com/a${' '.repeat(1_000_000)}b`],
    ])('refuses %s as invalid, fast', (_name, text) => {
        const { result, ms } = timed(text);

        expect(result).toEqual({ ok: false, reason: 'invalid' });
        expect(ms).toBeLessThan(FAST_MS);
    });

    it('still reads an address at the length cap followed by sentence punctuation', () => {
        const url = `https://example.com/${'a'.repeat(SOURCE_LINK_MAX_LENGTH - 'https://example.com/'.length - 1)}`;

        expect(parseSourceLink(`${url}.`)).toMatchObject({ ok: true });
    });

    it('extractSourceLink also leaves a hostile long line alone, fast', () => {
        const line = `Source: https://example.com/a${'!'.repeat(1_000_000)}`;
        const started = performance.now();
        const result = extractSourceLink(line);

        expect(performance.now() - started).toBeLessThan(FAST_MS);
        expect(result).toEqual({ ownSiteLeftOut: false, remaining: line });
    });
});

describe('extractSourceLink', () => {
    it('removes a line that is only a link and returns the rest', () => {
        const result = extractSourceLink('Tomato soup\nhttps://www.allrecipes.com/recipe/1/\n1 cup water');

        expect(result).toEqual({
            link: { url: 'https://www.allrecipes.com/recipe/1/', site: 'allrecipes.com' },
            ownSiteLeftOut: false,
            remaining: 'Tomato soup\n1 cup water',
        });
    });

    it.each([
        'Source: https://example.com/a',
        'source:https://example.com/a',
        'Recipe from:   https://example.com/a  ',
    ])('removes a labelled link line: %j', (line) => {
        const result = extractSourceLink(`1 cup flour\n${line}\n2 eggs`);

        expect(result.link).toMatchObject({ site: 'example.com' });
        expect(result.remaining).toBe('1 cup flour\n2 eggs');
    });

    it('keeps CRLF text intact apart from the link line', () => {
        expect(extractSourceLink('a\r\nhttps://example.com/a\r\nb').remaining).toBe('a\nb');
    });

    it('leaves a link inside a sentence alone', () => {
        const text = 'Adapted from https://example.com/a with less salt';

        expect(extractSourceLink(text)).toEqual({ ownSiteLeftOut: false, remaining: text });
    });

    it('treats a non-http link as ordinary text', () => {
        const text = 'mailto:cook@example.com\nftp://example.com/a';

        expect(extractSourceLink(text)).toEqual({ ownSiteLeftOut: false, remaining: text });
    });

    it('leaves an own-site link out and says so, without making it the source', () => {
        const result = extractSourceLink('1 cup water\nhttps://commise.app/recipes/1');

        expect(result).toEqual({ ownSiteLeftOut: true, remaining: '1 cup water' });
    });

    it('takes the first outside link and leaves a second link line as text', () => {
        const result = extractSourceLink('https://example.com/a\nhttps://other.example/b');

        expect(result).toEqual({
            link: { url: 'https://example.com/a', site: 'example.com' },
            ownSiteLeftOut: false,
            remaining: 'https://other.example/b',
        });
    });

    it('leaves a link line that is not a usable source as text', () => {
        const text = 'https://localhost/a';

        expect(extractSourceLink(text)).toEqual({ ownSiteLeftOut: false, remaining: text });
    });

    it('returns text with no link unchanged', () => {
        expect(extractSourceLink('1 cup flour\n2 eggs')).toEqual({
            ownSiteLeftOut: false,
            remaining: '1 cup flour\n2 eggs',
        });
    });
});
