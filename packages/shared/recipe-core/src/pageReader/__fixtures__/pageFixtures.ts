/**
 * Synthetic pages for the page reader's tests. Every page is made up here: no real site's page is committed (the
 * measured pages in the plan are read in place and never copied).
 */

/** A schema.org Recipe node as JSON-LD carries it, with every field filled. Override what a test changes. */
export function makeRecipeNode(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        '@type': 'Recipe',
        name: 'Test Pancakes',
        description: 'Fluffy pancakes.',
        recipeIngredient: ['1 cup flour', '2 eggs'],
        recipeInstructions: [
            { '@type': 'HowToStep', text: 'Mix.' },
            { '@type': 'HowToStep', text: 'Cook.' },
        ],
        recipeYield: ['4', '8 pancakes'],
        prepTime: 'PT10M',
        cookTime: 'PT15M',
        totalTime: 'PT25M',
        recipeCuisine: 'American',
        ...overrides,
    };
}

/** One `<script type="application/ld+json">` holding `data`, which is JSON-encoded (a string is written as it is). */
export function makeJsonLdScript(data: unknown, attributes = 'type="application/ld+json"'): string {
    const json = typeof data === 'string' ? data : JSON.stringify(data);

    return `<script ${attributes}>${json.replaceAll('</', '<\\/')}</script>`;
}

/** The pieces of a page. */
export interface PageParts {
    /** JSON-LD blocks, each written by {@link makeJsonLdScript}. */
    readonly jsonLd?: readonly unknown[];
    /** Extra markup for `<head>` (links and metas). */
    readonly head?: string;
    /** Markup for `<body>`. */
    readonly body?: string;
}

/** A whole page with the given JSON-LD blocks, head markup and body. */
export function makePage(parts: PageParts = {}): string {
    const { jsonLd = [], head = '', body = '<main><h1>A page</h1></main>' } = parts;

    return `<!doctype html><html><head><title>t</title>${head}${jsonLd.map((block) => makeJsonLdScript(block)).join('')}</head><body>${body}</body></html>`;
}

/** A canonical link, an og:url meta and so on, as head markup. */
export function makeLinkHead(links: { canonical?: string; ogUrl?: string; base?: string } = {}): string {
    return [
        links.base === undefined ? '' : `<base href="${links.base}">`,
        links.canonical === undefined ? '' : `<link rel="canonical" href="${links.canonical}">`,
        links.ogUrl === undefined ? '' : `<meta property="og:url" content="${links.ogUrl}">`,
    ].join('');
}

/** A Recipe written as microdata. */
export function makeMicrodataBody(extra = ''): string {
    return [
        '<div itemscope itemtype="https://schema.org/Recipe">',
        '<h1 itemprop="name">Micro Soup</h1>',
        '<meta itemprop="description" content="A warm soup.">',
        '<meta itemprop="recipeYield" content="4 servings">',
        '<time itemprop="prepTime" datetime="PT5M">5 min</time>',
        '<time itemprop="cookTime" datetime="PT30M">30 min</time>',
        '<link itemprop="url" href="https://example.com/soup">',
        '<ul><li itemprop="recipeIngredient">2 cups stock</li><li itemprop="recipeIngredient">1 onion, <b>diced</b></li></ul>',
        '<ol itemprop="recipeInstructions"><li>Simmer.</li><li>Serve.</li></ol>',
        extra,
        '</div>',
    ].join('');
}
