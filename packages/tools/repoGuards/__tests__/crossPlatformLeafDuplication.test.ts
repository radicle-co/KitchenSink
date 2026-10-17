// @vitest-environment node
/**
 * Repo-wide guard: **a web leaf and its `.native` twin share their drawing, not their logic**
 * (`docs/CODING_STANDARDS.md` §14.2: hooks, state and business logic may not fork per platform; duplicating logic
 * needs a code-review-visible `// PLATFORM-FORK: <reason>`).
 *
 * ## Why this exists
 *
 * Plan 002's end-of-plan review found four pairs split at the component that held the logic instead of at the leaf
 * that draws: `ShortlistPanel` was 63 identical lines, and `RecipeIngredientsFields.native.tsx` carried the web leaf's
 * whole focus mediator with 18 comments reading "see the web leaf". Every test was green, because each leaf's tests ran
 * its own copy. A copy drifts the first time one side is fixed, and nothing but a reader diffing two files sees it.
 *
 * ## What is measured
 *
 * The LOGIC both files carry: each file is parsed with the TypeScript compiler, its imports, comments and JSX are
 * removed, and what remains is compared line by line (the longest common subsequence, so a reordered block still
 * counts). JSX is removed because §14.2 lets the render layer fork, and a leaf mirroring its twin's markup is the rule
 * working. Lines that carry no logic are not counted: blank and punctuation-only lines, a bare `return (`, and a lone
 * identifier (a destructured parameter on its own line). Code written INSIDE JSX, an inline handler included, is
 * removed with the JSX: this is a known limit, not a judgement that such code is fine.
 *
 * A pair over {@link MAX_SHARED_LOGIC_LINES} fails. A `PLATFORM-FORK:` comment with a reason removes only the statement
 * or declaration it sits directly above, which is the one the compiler gives that comment to as a leading comment (a
 * JSX attribute counts as a declaration, as it does in the compiler). Everything else either file shares still counts.
 * The threshold sits above the shape the fix produces: a pair whose shared state is a hook (`useVariantDetailsDialog`,
 * `useIngredientsFields`) still mirrors its draw functions' signatures and their dispatch. Each file is parsed as its
 * extension says, because TSX reads a `.ts` file's generic arrow or angle-bracket cast as JSX and would blank it.
 *
 * ⚠️ Library-first: no diff library is a dependency of any workspace, and the comparison is a short dynamic program,
 * so adding one for it is the larger change.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { presentFiles, repoRoot } from './serviceSources.js';

/** The most logic lines a pair may share. */
const MAX_SHARED_LOGIC_LINES = 30;

/** The fewest words a `PLATFORM-FORK:` reason must have to be a reason. */
const MIN_REASON_WORDS = 3;

/** A line that carries no logic: punctuation only, a bare `return (`, or a lone identifier. Pure. */
const isTrivial = (line: string): boolean =>
    /^[\s()[\]{};,:<>/?]*$/u.test(line) || /^return\s*\($/u.test(line) || /^[A-Za-z_$][\w$]*,?$/u.test(line);

/**
 * Every comment in a parsed file, from the compiler's own trivia, so a `//` inside a string is not one. Pure.
 *
 * @param file - The parsed file.
 * @returns Each comment's `[start, end)` range, once.
 */
const commentRanges = (file: ts.SourceFile): readonly (readonly [number, number])[] => {
    const text = file.getFullText();
    const ranges = new Map<number, number>();

    const visit = (node: ts.Node): void => {
        // A comment at the end of a code line is the previous node's TRAILING comment, never a leading one.
        for (const range of [
            ...(ts.getLeadingCommentRanges(text, node.getFullStart()) ?? []),
            ...(ts.getTrailingCommentRanges(text, node.getEnd()) ?? []),
        ]) {
            ranges.set(range.pos, range.end);
        }

        for (const child of node.getChildren(file)) {
            visit(child);
        }
    };

    visit(file);

    return [...ranges];
};

/** Parse a source as its extension says: TSX for `.tsx`, TypeScript otherwise. Pure. */
const parse = (source: string, fileName: string): ts.SourceFile =>
    ts.createSourceFile(
        fileName,
        source,
        ts.ScriptTarget.Latest,
        true,
        fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );

/**
 * A comment's `PLATFORM-FORK:` reason: the text after the marker, when it has at least {@link MIN_REASON_WORDS} words.
 * Pure.
 *
 * @param comment - The comment's text.
 * @returns The reason, or `undefined` when the comment gives none.
 */
const forkReason = (comment: string): string | undefined => {
    const reason = /PLATFORM-FORK:([^\n]*)/u.exec(comment)?.[1]?.replace(/\*\/$/u, '').trim();

    return reason !== undefined && reason.split(/\s+/u).filter(Boolean).length >= MIN_REASON_WORDS ? reason : undefined;
};

/** A node a fork comment can excuse: a statement, or a declaration (a member, an object entry, a JSX attribute). Pure. */
const isExcusable = (node: ts.Node): boolean =>
    ts.isStatement(node) ||
    ts.isClassElement(node) ||
    ts.isTypeElement(node) ||
    ts.isObjectLiteralElementLike(node) ||
    ts.isEnumMember(node) ||
    ts.isJsxAttributeLike(node);

/** A `PLATFORM-FORK:` reason and the node it excuses. */
interface ForkedNode {
    readonly reason: string;
    readonly node: ts.Node;
}

/**
 * Each `PLATFORM-FORK:` reason in a parsed file, with the node it sits directly above: the statement or declaration
 * whose leading comments, read from its full start, hold the comment. A comment no such node holds (one closing a
 * block, or trailing a line) excuses nothing. Pure.
 *
 * @param file - The parsed file.
 * @returns The reasons and their nodes, in order.
 */
const forkedNodes = (file: ts.SourceFile): readonly ForkedNode[] => {
    const text = file.getFullText();
    const forks: ForkedNode[] = [];

    const visit = (node: ts.Node): void => {
        if (isExcusable(node)) {
            for (const range of ts.getLeadingCommentRanges(text, node.getFullStart()) ?? []) {
                const reason = forkReason(text.slice(range.pos, range.end));

                if (reason !== undefined) {
                    forks.push({ reason, node });
                }
            }
        }

        ts.forEachChild(node, visit);
    };

    visit(file);

    return forks;
};

/**
 * What a file's `PLATFORM-FORK:` comments excuse: each reason, and the first line of the node under it. Pure.
 *
 * @param source - The file's text.
 * @param fileName - Its name.
 * @returns The reasons and what each excuses, in order.
 */
export function platformForks(
    source: string,
    fileName: string,
): readonly { readonly reason: string; readonly excuses: string }[] {
    const file = parse(source, fileName);

    return forkedNodes(file).map(({ reason, node }) => ({ reason, excuses: node.getText(file).split('\n')[0] }));
}

/**
 * A file's logic lines: its source with imports, comments, JSX and whatever a `PLATFORM-FORK:` reason excuses blanked,
 * trimmed, trivial lines dropped. Pure.
 *
 * @param source - The file's text.
 * @param fileName - Its name, for the parser's diagnostics.
 * @returns The lines, in order.
 */
export function logicLines(source: string, fileName: string): readonly string[] {
    const file = parse(source, fileName);
    const blank: (readonly [number, number])[] = [
        ...commentRanges(file),
        ...forkedNodes(file).map(({ node }) => [node.getStart(file), node.getEnd()] as const),
    ];

    const visit = (node: ts.Node): void => {
        if (
            ts.isImportDeclaration(node) ||
            ts.isJsxElement(node) ||
            ts.isJsxFragment(node) ||
            ts.isJsxSelfClosingElement(node)
        ) {
            blank.push([node.getStart(file), node.getEnd()]);

            return;
        }

        ts.forEachChild(node, visit);
    };

    visit(file);

    const chars = source.split('');

    for (const [start, end] of blank) {
        for (let index = start; index < end; index += 1) {
            if (chars[index] !== '\n') {
                chars[index] = ' ';
            }
        }
    }

    return chars
        .join('')
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => !isTrivial(line));
}

/**
 * How many lines two sequences share in order: the length of their longest common subsequence. Pure.
 *
 * @param a - One sequence.
 * @param b - The other.
 * @returns The shared length.
 */
export function sharedInOrder(a: readonly string[], b: readonly string[]): number {
    let previous = new Array<number>(b.length + 1).fill(0);

    for (const line of a) {
        const current = new Array<number>(b.length + 1).fill(0);

        b.forEach((other, index) => {
            current[index + 1] =
                line === other ? (previous[index] ?? 0) + 1 : Math.max(previous[index + 1] ?? 0, current[index] ?? 0);
        });
        previous = current;
    }

    return previous[b.length] ?? 0;
}

/** One file of a pair: its name, whose extension decides how it is parsed, and its text. */
interface PairFile {
    readonly fileName: string;
    readonly text: string;
}

/** A pair's measure, and whether it passes. */
interface PairVerdict {
    readonly shared: number;
    readonly passes: boolean;
}

/**
 * Whether a web leaf and its `.native` twin keep their logic in one place. Pure.
 *
 * @param web - The web file.
 * @param native - The native file.
 * @returns How many logic lines they share outside what their fork reasons excuse, and whether the pair passes.
 */
export function pairVerdict(web: PairFile, native: PairFile): PairVerdict {
    const shared = sharedInOrder(logicLines(web.text, web.fileName), logicLines(native.text, native.fileName));

    return { shared, passes: shared <= MAX_SHARED_LOGIC_LINES };
}

/**
 * A file's tokens as the compiler scans them: comments and whitespace are gone, a leading `'use client'` directive is
 * dropped (it is inert on native), and a RELATIVE module specifier loses its `.native` twin marker, because Metro
 * resolves `./x.js` to `x.native.tsx` on native, so `./x.js` and `./x.native.js` name the same module there. Pure.
 *
 * @param file - The file.
 * @returns Its tokens, in order.
 */
function tokensOf(file: PairFile): readonly string[] {
    const scanner = ts.createScanner(
        ts.ScriptTarget.Latest,
        true,
        file.fileName.endsWith('.tsx') ? ts.LanguageVariant.JSX : ts.LanguageVariant.Standard,
        file.text,
    );
    const tokens: string[] = [];

    for (let kind = scanner.scan(); kind !== ts.SyntaxKind.EndOfFileToken; kind = scanner.scan()) {
        const text = scanner.getTokenText();

        tokens.push(
            kind === ts.SyntaxKind.StringLiteral && /^(['"])\.{1,2}\//u.test(text)
                ? text.replace(/\.native(\.jsx?)?(['"])$/u, '$1$2')
                : text,
        );
    }

    const isDirective = tokens[0] === "'use client'" || tokens[0] === '"use client"';

    return isDirective ? tokens.slice(tokens[1] === ';' ? 2 : 1) : tokens;
}

/**
 * Whether a native file is its web twin's own source once comments, a `use client` directive and the twin marker in
 * relative specifiers are set aside, so that it adds nothing and Metro would load the web file for native anyway. Pure.
 *
 * @param web - The web file.
 * @param native - The native file.
 * @returns `true` when their tokens are equal.
 */
export function isTokenEqual(web: PairFile, native: PairFile): boolean {
    const a = tokensOf(web);
    const b = tokensOf(native);

    return a.length === b.length && a.every((token, index) => token === b[index]);
}

/** Lines of distinct logic, `count` of them: `const value0 = compute(0);` and on. Pure. */
const logic = (count: number, from = 0): string =>
    Array.from({ length: count }, (_, index) => `const value${from + index} = compute(${from + index});`).join('\n');

/** A leaf whose body is `body`: its signature is the one logic line every fixture pair shares. Pure. */
const leaf = (body: string, comment = ''): string =>
    `import { compute } from './compute.js';\n${comment}\nexport function Leaf() {\n${body}\n}\n`;

/**
 * Every `X.native.ts(x)` with an `X.ts(x)` beside it, present on disk, tests and fixtures excluded.
 *
 * @returns The pairs, by repo-relative path.
 * @sideEffect Lists the working tree through git.
 */
function discoveredPairs(): readonly { readonly web: string; readonly native: string }[] {
    const present = new Set(presentFiles(['packages']));

    return [...present]
        .filter(
            (file) =>
                /\.native\.tsx?$/u.test(file) &&
                !/\/(?:__tests__|__fixtures__|__testing__|tests|dist|testing)\//u.test(file),
        )
        .map((native) => ({ native, web: native.replace(/\.native\.(tsx?)$/u, '.$1') }))
        .filter(({ web }) => present.has(web));
}

/** Read a repo-relative file. */
const read = (file: string): PairFile => ({ fileName: file, text: readFileSync(path.join(repoRoot, file), 'utf8') });

/** A fixture leaf's source, as a `.tsx` file. Pure. */
const tsx = (text: string): PairFile => ({ fileName: 'leaf.tsx', text });

describe('what counts as shared logic', () => {
    it.each<[string, string, string, number]>([
        ['identical logic', logic(5), logic(5), 5],
        ['logic only one side has', logic(5), logic(5, 100), 0],
        [
            'identical markup, which the render layer may fork',
            '<View style={styles.row}>\n<Text>{title}</Text>\n<Text>{subtitle}</Text>\n</View>',
            '<View style={styles.row}>\n<Text>{title}</Text>\n<Text>{subtitle}</Text>\n</View>',
            0,
        ],
        [
            'identical code inside a JSX attribute, which goes with the JSX',
            'const button = <Button onPress={() => {\nsetRefreshed(false);\npicker.pick(position);\n}} />;',
            'const pressable = <Pressable onPress={() => {\nsetRefreshed(false);\npicker.pick(position);\n}} />;',
            0,
        ],
        ['identical comments', '// one\n/* two\nthree */\n/** four */', '// one\n/* two\nthree */\n/** four */', 0],
        ['identical imports, beyond the one every leaf has', "import { a } from 'a';", "import { a } from 'a';", 0],
        ['lines that carry no logic', 'return (\nrow,\nclose\n);', 'return (\nrow,\nclose\n);', 0],
        [
            'two blocks in the opposite order: the longer run counts',
            `${logic(3)}\n${logic(2, 10)}`,
            `${logic(2, 10)}\n${logic(3)}`,
            3,
        ],
        [
            'identical logic with a different comment at the end of each line, which is still the same logic',
            'const a = compute(1); // web\nconst b = compute(2); /* web */',
            'const a = compute(1); // native\nconst b = compute(2); /* native */',
            2,
        ],
        [
            'a `//` inside a string, which is code and not a comment',
            "const marker = '// PLATFORM-FORK: not a comment at all';",
            "const marker = '// PLATFORM-FORK: not a comment at all';",
            1,
        ],
    ])('%s', (_case, web, native, shared) => {
        expect(sharedInOrder(logicLines(leaf(web), 'web.tsx'), logicLines(leaf(native), 'native.tsx'))).toBe(
            shared + 1,
        );
    });

    it('reads a `.ts` pair as TypeScript, where a generic arrow is logic and not an unclosed JSX element', () => {
        const generic = leaf('const identity = <T>(value: T): T => {\nconst copy = value;\nreturn copy;\n};');

        expect(
            pairVerdict({ fileName: 'leaf.ts', text: generic }, { fileName: 'leaf.native.ts', text: generic }).shared,
        ).toBe(4);
        expect(pairVerdict(tsx(generic), tsx(generic)).shared).toBeLessThan(4);
    });
});

describe('what a PLATFORM-FORK comment excuses', () => {
    it.each<[string, string, readonly (readonly [string, string])[]]>([
        [
            'a line comment over a declaration',
            '// PLATFORM-FORK: native has no aria-describedby here\nconst a = 1;',
            [['native has no aria-describedby here', 'const a = 1;']],
        ],
        [
            'a JSDoc block over a declaration',
            '/**\n * ## PLATFORM-FORK: the web leaf paints a grid\n */\nconst a = 1;',
            [['the web leaf paints a grid', 'const a = 1;']],
        ],
        [
            'a reason over a function: the whole function',
            '// PLATFORM-FORK: native cannot read where focus was\nfunction focusBack() {\nreturn 1;\n}',
            [['native cannot read where focus was', 'function focusBack() {']],
        ],
        [
            'a reason over a statement inside a function: that statement, not the function',
            'function rows() {\nconst a = 1;\n// PLATFORM-FORK: native cannot read focus\nconst b = 2;\n}',
            [['native cannot read focus', 'const b = 2;']],
        ],
        [
            'a reason inside JSX: the attribute under it, not every attribute',
            'const view = <Combobox\n// PLATFORM-FORK: native has no describedby\n{...props} label="x"\n/>;',
            [['native has no describedby', '{...props}']],
        ],
        [
            'two reasons: each its own declaration',
            '// PLATFORM-FORK: native cannot read focus\nconst a = 1;\n// PLATFORM-FORK: native has no describedby\nconst b = 2;',
            [
                ['native cannot read focus', 'const a = 1;'],
                ['native has no describedby', 'const b = 2;'],
            ],
        ],
        ['a marker with no reason', '// PLATFORM-FORK:\nconst a = 1;', []],
        ['a reason too short to be one', '// PLATFORM-FORK: different\nconst a = 1;', []],
        ['the marker in a string', "const why = 'PLATFORM-FORK: native has no describedby';", []],
        ['a note that is not the marker', '// PLATFORM-FORK note: the web leaf paints a grid\nconst a = 1;', []],
        ['a reason with nothing under it', 'const a = 1;\n// PLATFORM-FORK: native has no describedby here', []],
        [
            'a reason trailing the line it follows, which it does not sit above',
            'const a = 1; // PLATFORM-FORK: native has no describedby here\nconst b = 2;',
            [],
        ],
    ])('%s', (_case, source, forks) => {
        expect(platformForks(source, 'leaf.tsx').map(({ reason, excuses }) => [reason, excuses])).toEqual(forks);
    });
});

describe('a PLATFORM-FORK reason over one member of a declaration (§14.2: it excuses that one, and nothing else)', () => {
    it.each<[string, string, string, readonly string[]]>([
        [
            'an entry of an object literal',
            "const hover = {\ncolor: 'coral',\n// PLATFORM-FORK: native has no hover state\ncursor: 'pointer',\n};",
            "cursor: 'pointer'",
            ['const hover = {', "color: 'coral',"],
        ],
        [
            'a member of an interface',
            'interface LeafProps {\nlabel: string;\n// PLATFORM-FORK: native has no describedby attribute\ndescribedBy?: string;\n}',
            'describedBy?: string;',
            ['interface LeafProps {', 'label: string;'],
        ],
        [
            'a field of a class',
            "class Mediator {\ntarget = 'name';\n// PLATFORM-FORK: native cannot read the focused element\nfocused = document.activeElement;\n}",
            'focused = document.activeElement;',
            ['class Mediator {', "target = 'name';"],
        ],
        [
            'a method of a class, body and all',
            "class Mediator {\ntarget = 'name';\n// PLATFORM-FORK: native cannot read the focused element\nrestore(): string {\nreturn this.target;\n}\n}",
            'restore(): string {',
            ['class Mediator {', "target = 'name';"],
        ],
        [
            'a member of an enum',
            "enum Edge {\nTop = 'top',\n// PLATFORM-FORK: native pins one edge only\nBottom = 'bottom',\n}",
            "Bottom = 'bottom'",
            ['enum Edge {', "Top = 'top',"],
        ],
    ])('%s', (_case, source, excused, counted) => {
        expect(platformForks(source, 'leaf.ts').map(({ excuses }) => excuses)).toEqual([excused]);
        expect(logicLines(source, 'leaf.ts')).toEqual(counted);
    });
});

describe('a pair that is the same file twice (token-equal, so the native twin should not exist)', () => {
    const body = 'export const Leaf = () => <Text>{label}</Text>;';

    it.each<[string, string, string, boolean]>([
        ['identical files', `${body}\n`, `${body}\n`, true],
        [
            'only comments and whitespace differ',
            `// web\n${body}`,
            `/* native */\n${body.replace(' = ', '   =   ')}`,
            true,
        ],
        ['only a `use client` directive differs', `'use client';\n\n${body}`, body, true],
        [
            'only the twin specifier of an import differs: Metro already resolves `./x.js` to `x.native.tsx` on native',
            `import { Body } from './Body.js';\n${body}`,
            `import { Body } from './Body.native.js';\n${body}`,
            true,
        ],
        ['one token differs', `${body}`, body.replace('label', 'title'), false],
        [
            'a different import target, not a twin specifier',
            "import { A } from './A.js';",
            "import { A } from './B.native.js';",
            false,
        ],
        ['a string that merely mentions `.native`', "const s = 'a.native.js';", "const s = 'a.js';", false],
        ['extra logic on one side', `${body}\nconst extra = 1;`, body, false],
    ])('%s', (_case, web, native, identical) => {
        expect(isTokenEqual(tsx(web), tsx(native))).toBe(identical);
    });
});

describe('a pair’s verdict', () => {
    const FORK = '// PLATFORM-FORK: native cannot read where focus was';

    it.each<[string, string, string, number, boolean]>([
        [
            'exactly the threshold passes',
            leaf(logic(MAX_SHARED_LOGIC_LINES - 1)),
            leaf(logic(MAX_SHARED_LOGIC_LINES - 1)),
            MAX_SHARED_LOGIC_LINES,
            true,
        ],
        [
            'one line over fails',
            leaf(logic(MAX_SHARED_LOGIC_LINES)),
            leaf(logic(MAX_SHARED_LOGIC_LINES)),
            MAX_SHARED_LOGIC_LINES + 1,
            false,
        ],
        [
            'a reason over a function, in the web file, excludes that function',
            leaf(logic(MAX_SHARED_LOGIC_LINES), FORK),
            leaf(logic(MAX_SHARED_LOGIC_LINES)),
            0,
            true,
        ],
        [
            'a reason over a function, in the native file, excludes it the same way',
            leaf(logic(MAX_SHARED_LOGIC_LINES)),
            leaf(logic(MAX_SHARED_LOGIC_LINES), FORK),
            0,
            true,
        ],
        [
            'a marker that gives no reason excludes nothing',
            leaf(logic(MAX_SHARED_LOGIC_LINES), '// PLATFORM-FORK:'),
            leaf(logic(MAX_SHARED_LOGIC_LINES)),
            MAX_SHARED_LOGIC_LINES + 1,
            false,
        ],
        [
            `a reason under ${MIN_REASON_WORDS} words excludes nothing`,
            leaf(logic(MAX_SHARED_LOGIC_LINES), '// PLATFORM-FORK: different'),
            leaf(logic(MAX_SHARED_LOGIC_LINES)),
            MAX_SHARED_LOGIC_LINES + 1,
            false,
        ],
        [
            'a reason over one statement, with 40 other shared lines, still fails',
            leaf(`${FORK}\n${logic(1, 900)}\n${logic(40)}`),
            leaf(`${logic(1, 900)}\n${logic(40)}`),
            41,
            false,
        ],
        [
            'a reason inside JSX excuses its attribute only, and the 40 shared lines outside still fail',
            leaf(`const view = <Combobox\n${FORK}\n{...props}\n/>;\n${logic(40)}`),
            leaf(`const view = <Combobox\n{...props}\n/>;\n${logic(40)}`),
            42,
            false,
        ],
        [
            'two reasons exclude their two functions, and the 31 shared lines beside them still fail',
            leaf(
                `${FORK}\nfunction first() {\n${logic(20)}\n}\n${FORK}\nfunction second() {\n${logic(20, 100)}\n}\n${logic(31, 500)}`,
            ),
            leaf(`function first() {\n${logic(20)}\n}\nfunction second() {\n${logic(20, 100)}\n}\n${logic(31, 500)}`),
            32,
            false,
        ],
        [
            'far over, sharing markup only, passes',
            leaf(`const view = (<>\n${'<Text>{label}</Text>\n'.repeat(80)}</>);`),
            leaf(`const view = (<>\n${'<Text>{label}</Text>\n'.repeat(80)}</>);`),
            2,
            true,
        ],
    ])('%s', (_case, web, native, shared, passes) => {
        expect(pairVerdict(tsx(web), tsx(native))).toEqual({ shared, passes });
    });
});

describe('the tree', () => {
    const pairs = discoveredPairs();

    it('discovers the leaf pairs, and measures logic in them (a vacuous pass would hide every rule below)', () => {
        const measured = pairs.filter((pair) => pairVerdict(read(pair.web), read(pair.native)).shared > 0);

        expect(pairs.length).toBeGreaterThan(50);
        expect(measured.length).toBeGreaterThan(pairs.length / 2);
    });

    it('⛔ no native twin is token-equal to its web file: delete it, Metro resolves the web file for native', () => {
        const offenders = pairs
            .filter((pair) => isTokenEqual(read(pair.web), read(pair.native)))
            .map(({ native }) => `${native} — is the same file as its web twin; delete it`);

        expect(offenders).toEqual([]);
    });

    it(`⛔ no pair shares more than ${MAX_SHARED_LOGIC_LINES} logic lines outside what a PLATFORM-FORK reason excuses`, () => {
        const offenders = pairs
            .map((pair) => ({ ...pair, verdict: pairVerdict(read(pair.web), read(pair.native)) }))
            .filter(({ verdict }) => !verdict.passes)
            .map(
                ({ native, verdict }) =>
                    `${native} — shares ${verdict.shared} logic lines with its web twin; move the shared logic into a hook or model`,
            );

        expect(offenders).toEqual([]);
    });
});
