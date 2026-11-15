import { describe, expect, it } from 'vitest';

import { MAX_VISIBLE_NODES, MAX_WALK_NODES } from '../pageCaps.js';
import { MAX_ELEMENT_DEPTH, parsePage, plainText, textBlocks } from '../pageDocument.js';

describe('textBlocks', () => {
    it('splits on block elements, line breaks and newlines', () => {
        expect(
            textBlocks('<p>Mix.</p><div>Bake.</div><ul><li>Cool.</li><li>Serve.</li></ul>Eat.<br>Enjoy.\nRest.'),
        ).toEqual(['Mix.', 'Bake.', 'Cool.', 'Serve.', 'Eat.', 'Enjoy.', 'Rest.']);
    });

    it('keeps inline markup inside one block and collapses whitespace', () => {
        expect(textBlocks('<p>Add  <b>two</b> cups   of <a href="/x">flour</a>.</p>')).toEqual([
            'Add two cups of flour.',
        ]);
    });

    it('decodes entities and drops blank blocks', () => {
        expect(textBlocks('<p>Salt &amp; pepper &frac12; tsp</p><p>  </p>\n\n<p>&nbsp;</p>')).toEqual([
            'Salt & pepper ½ tsp',
        ]);
    });

    it('never reads the content of a script or a style', () => {
        expect(textBlocks('Keep<script>var a = "x";</script><style>p{}</style> this')).toEqual(['Keep this']);
    });

    it('returns nothing for blank input', () => {
        expect(textBlocks('')).toEqual([]);
        expect(textBlocks('   \n  ')).toEqual([]);
    });
});

describe('plainText', () => {
    it('removes tags and decodes entities', () => {
        expect(plainText('1 cup <b>sugar</b> &amp; spice')).toBe('1 cup sugar & spice');
    });

    it('reads text that was encoded twice', () => {
        expect(plainText('Mac &amp;amp; Cheese')).toBe('Mac & Cheese');
        expect(plainText('&amp;frac12; cup milk')).toBe('½ cup milk');
        expect(plainText('1 cup &lt;b&gt;sugar&lt;/b&gt;')).toBe('1 cup sugar');
    });

    it('leaves a lone ampersand and a less-than sign in a quantity alone', () => {
        expect(plainText('Salt & pepper')).toBe('Salt & pepper');
        expect(plainText('Under 5 < 6 minutes')).toBe('Under 5 < 6 minutes');
    });

    it('joins the blocks of a multi-line value with one space', () => {
        expect(plainText('1 cup\nsugar<br>sifted')).toBe('1 cup sugar sifted');
    });

    it('returns an empty string for blank text', () => {
        expect(plainText('  \n ')).toBe('');
    });
});

describe('parsePage', () => {
    const page = parsePage(
        [
            '<html><head>',
            '<link rel="canonical" href="https://example.com/a">',
            '<script type="application/ld+json">{"a":"&amp;"}</script>',
            '</head><body><div itemscope itemtype="https://schema.org/Recipe">',
            '<span itemprop="name">Pie <i>deluxe</i></span>',
            '</div></body></html>',
        ].join(''),
    );

    it('finds elements by tag and by attribute, in document order', () => {
        expect(page.byTag('link').map((element) => element.attr('href'))).toEqual(['https://example.com/a']);
        expect(page.withAttribute('itemprop').map((element) => element.tag)).toEqual(['span']);
        expect(page.byTag('missing')).toEqual([]);
    });

    it('reads an attribute, and nothing for an absent one', () => {
        const [link] = page.byTag('link');

        expect(link?.attr('rel')).toBe('canonical');
        expect(link?.attr('nope')).toBeUndefined();
    });

    it('gives a script its raw text, with entities left alone', () => {
        expect(page.byTag('script')[0]?.rawText()).toBe('{"a":"&amp;"}');
    });

    it('gives an element its text blocks and its child elements', () => {
        const [root] = page.withAttribute('itemscope');

        expect(root?.children().map((child) => child.tag)).toEqual(['span']);
        expect(root?.blocks()).toEqual(['Pie deluxe']);
    });

    it('does not split an element on a newline inside its text', () => {
        const [paragraph] = parsePage('<p>one\ntwo</p>').byTag('p');

        expect(paragraph?.blocks()).toEqual(['one two']);
    });

    it('stops at 400,000 nested elements: it is quick, and it says the page was cut short', () => {
        const depth = 400_000;
        const started = performance.now();
        const deep = parsePage(`<i>kept</i>${'<div>'.repeat(depth)}core${'</div>'.repeat(depth)}`);

        expect(deep.truncated).toBe(true);
        expect(deep.byTag('i')[0]?.blocks()).toEqual(['kept']);
        expect(deep.byTag('div').length).toBeLessThan(depth / 10);
        expect(performance.now() - started).toBeLessThan(2_000);
    });

    it('reads a page nested to the cap in full', () => {
        const page = parsePage(`${'<div>'.repeat(MAX_ELEMENT_DEPTH)}core${'</div>'.repeat(MAX_ELEMENT_DEPTH)}`);

        expect(page.truncated).toBe(false);
        expect(page.byTag('div')).toHaveLength(MAX_ELEMENT_DEPTH);
    });

    it('reads at most the node budget of one element, so a huge value costs a bounded walk', () => {
        const [huge] = parsePage(`<div>${'<b>x</b>'.repeat(MAX_WALK_NODES * 3)}</div>`).byTag('div');
        const text = huge?.blocks().join(' ') ?? '';

        expect(text.length).toBeGreaterThan(MAX_WALK_NODES / 4);
        expect(text.length).toBeLessThanOrEqual(MAX_WALK_NODES / 2);
    });

    it('reads a whole body past the property budget, and says so when even the visible budget cuts it', () => {
        const paragraphs = MAX_WALK_NODES * 2;
        const [body] = parsePage(`<body>${'<p>x</p>'.repeat(paragraphs)}</body>`).byTag('body');
        const all = body?.visibleText();

        expect(all?.truncated).toBe(false);
        expect(all?.blocks).toHaveLength(paragraphs);

        const [wide] = parsePage(`<body>${'<b>x</b>'.repeat(MAX_VISIBLE_NODES)}</body>`).byTag('body');

        expect(wide?.visibleText().truncated).toBe(true);
        expect(wide?.blocks().join('').length).toBeLessThanOrEqual(MAX_WALK_NODES);
    });

    it('reads 200,000 sibling elements without slowing down', () => {
        const started = performance.now();
        const wide = parsePage(`<div>${'<i>a</i>'.repeat(200_000)}</div>`);

        expect(wide.truncated).toBe(false);
        expect(wide.byTag('i')).toHaveLength(200_000);
        expect(performance.now() - started).toBeLessThan(2_000);
    });
});
