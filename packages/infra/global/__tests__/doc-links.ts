/**
 * `@link` DISCOVERY + RESOLUTION for the repo-wide docstring guard — mechanism only.
 *
 * A TSDoc link whose target does not resolve renders as dead plain text in every editor and doc tool: the
 * reader gets no navigation, and nothing tells the author. That makes it the same class of defect as a stale
 * ADR path, and it rots the same way — measured at 360 of them across 244 of the 808 link-bearing files here,
 * before the sweep that landed with this module. The classes, and why they are each a defect, are in the
 * guard's own docblock (`./doc-link-resolution.test.ts`).
 *
 * Resolution uses the COMPILER, not a regular expression, and mirrors what TypeScript's own language service
 * does to decide whether a link gets a target ({@link resolvesToDeclaration}). A text gate cannot do this job
 * at all: it cannot tell a resolvable target from an unresolvable one, and — measured here — it fires on the
 * fixture inside the guard that proves it works, which is how a gate gets deleted rather than fixed.
 *
 * Each file is analysed under the tsconfig that OWNS it (nearest ancestor, repo root as the fallback), because
 * a single repo-wide program would misresolve the packages that resolve differently: `@commise/web` compiles
 * with `moduleResolution: bundler` and extensionless relative imports, which are errors under the NodeNext
 * default every other package uses. A file whose imports fail to resolve reports every imported link target as
 * dangling, so getting this wrong manufactures false positives by the hundred.
 *
 * Subjects are DISCOVERED from `git ls-files`, never enumerated (`docs/CODING_STANDARDS.md` §16.3), so a new
 * package is covered the day it lands. The only filter is a text pre-scan for the `@link` opener: a link node
 * cannot exist in a file whose text does not contain the sequence, and skipping the rest keeps the walk to the
 * ~45% of sources that carry one.
 *
 * DESIGN PATTERN: Specification module over ONE parser — {@link collectDocLinks} reads links out of a program
 * and {@link unresolvedDocLinks} is the pure verdict over them, so the DECISION is testable against a
 * synthetic in-memory program instead of the working tree.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

/** Repo root — this file sits at `packages/infra/global/__tests__`, so the root is four levels up. */
export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

/**
 * The opener that makes a file worth parsing.
 *
 * Safe to write literally BECAUSE the verdict comes from the parser: this constant is a string literal, and a
 * string literal is not a comment, so neither this module nor the guard's own fixtures can be reported by the
 * check they define. A text-matching version of this gate would flag both — the self-match trap that has
 * bitten seven gates in this branch.
 */
const LINK_OPENER = '{@link';

/** A link target that is a URL rather than a symbol reference, in either shape the parser produces. */
const URL_SCHEME = /^(?:[a-z][a-z0-9+.-]*)?:\/\//u;

/** How the link's target was written, which decides whether resolution is even expected. */
export type DocLinkForm =
    /** A plain entity name: `Foo`, `Foo.bar`, `Foo#bar`. TypeScript resolves these in the enclosing scope. */
    | 'entity'
    /**
     * The `import('./x.js').Y` form. NEVER resolves: TypeScript's JSDoc parser stops the entity name at the
     * `(`, so the link's target is the bare word `import` and the rest is inert text. Editors render the whole
     * thing as plain text, which is why this form is reported rather than exempted.
     */
    | 'importType'
    /**
     * TypeScript read NO target at all — the link is inert text end to end. Measured causes in this tree: a
     * target pushed onto the next comment line (the parser reads the leading `*` as the target), and TSDoc's
     * `./module.js!member` declaration reference, which TypeScript does not implement.
     *
     * This form is the reason the exemption below is written against a URL SCHEME rather than against "the
     * parser found no name": exempting the name-less case swept 26 dead links out of this guard's first run.
     */
    | 'unparsed'
    /**
     * The opener appears in a COMMENT that produced no link node at all, so no tool will ever linkify it —
     * a link written in a `//` comment, or in a block the parser attaches to no declaration. Found by
     * reconciling comment text against the nodes ({@link countCommentOpeners}), which is what keeps the
     * guard's coverage claim honest: without it a whole comment can drop out of the check silently.
     */
    | 'uncompiled'
    /** A URL destination, which TSDoc permits and which needs no symbol. Exempt. */
    | 'url';

/** One link found in a docstring. */
export interface DocLink {
    /** Repo-relative path of the file the link is written in. */
    readonly file: string;
    /** 1-based line of the link's opening brace. */
    readonly line: number;
    /** The target exactly as written, minus the braces. */
    readonly target: string;
    /** Which syntactic form the target takes. */
    readonly form: DocLinkForm;
    /** Whether the compiler reached a declaration for it — always false for `importType`, true for `url`. */
    readonly resolved: boolean;
}

/** The files that share one tsconfig, i.e. one program to build. */
export interface DocLinkUnit {
    /** Repo-relative path of the owning `tsconfig.json`. */
    readonly config: string;
    /** Repo-relative paths of the files it owns that contain at least one link opener. */
    readonly files: readonly string[];
}

/**
 * Every tracked path matching the given git pathspecs that is ALSO present in the working tree.
 *
 * `git ls-files` reports the INDEX, which disagrees with the working tree during an unstaged deletion or a
 * half-finished rebase; a guard that throws in those states fails for reasons unrelated to what it checks.
 *
 * @param pathspecs - Git pathspecs to list.
 * @returns Repo-relative paths, `node_modules` excluded.
 * @sideEffect Shells out to git and stats the working tree.
 */
function trackedFiles(pathspecs: readonly string[]): readonly string[] {
    return execFileSync('git', ['ls-files', '--', ...pathspecs], {
        cwd: repoRoot,
        encoding: 'utf8',
        maxBuffer: 1 << 28,
    })
        .split('\n')
        .filter((file) => file.length > 0 && !file.includes('node_modules/') && existsSync(path.join(repoRoot, file)));
}

/**
 * Group every link-bearing TypeScript source under the tsconfig that owns it.
 *
 * @returns One unit per owning tsconfig that has at least one link-bearing file.
 * @sideEffect Shells out to git and reads every candidate source.
 */
export function discoverDocLinkUnits(): readonly DocLinkUnit[] {
    const configs = ['tsconfig.json', ...trackedFiles(['*/tsconfig.json'])];
    const owners = configs
        .map((config) => ({ config, dir: path.posix.dirname(config) === '.' ? '' : path.posix.dirname(config) }))
        .sort((left, right) => right.dir.length - left.dir.length);
    const units = new Map<string, string[]>(configs.map((config) => [config, []]));

    for (const file of trackedFiles(['*.ts', '*.tsx'])) {
        if (!readFileSync(path.join(repoRoot, file), 'utf8').includes(LINK_OPENER)) {
            continue;
        }

        // First match wins: `owners` is sorted longest-path-first, so the nearest ancestor is found before the
        // root fallback (whose empty `dir` prefixes everything). Every file therefore has an owner, and no
        // file can drop out of coverage by living outside a package's tsconfig.
        const owner = owners.find((candidate) => candidate.dir === '' || file.startsWith(`${candidate.dir}/`));

        if (owner) {
            units.get(owner.config)?.push(file);
        }
    }

    return [...units].filter(([, files]) => files.length > 0).map(([config, files]) => ({ config, files }));
}

/**
 * Build the program for one unit.
 *
 * The unit's files are the root names rather than the tsconfig's own `include`: several packages exclude their
 * tests from the build config, and a file left out of the program is a file whose links are never checked.
 *
 * ⚠️ PARENT POINTERS ARE MANDATORY, and this is not a micro-optimisation to undo. `getJSDocCommentsAndTags`
 * walks `node.parent` and returns NOTHING when it is unset, and a program built the default way only sets
 * parents on files the binder happens to reach. Measured: without this the walk silently found zero links in
 * whole files — a guard reporting a clean tree it had never looked at.
 *
 * @param unit - The unit to compile.
 * @returns A program in which every one of the unit's files is present, parsed with parent pointers.
 * @sideEffect Reads the tsconfig and every file the program pulls in.
 */
export function createUnitProgram(unit: DocLinkUnit): ts.Program {
    const configPath = path.join(repoRoot, unit.config);
    const parsed = ts.parseJsonConfigFileContent(
        ts.readConfigFile(configPath, ts.sys.readFile).config ?? {},
        ts.sys,
        path.dirname(configPath),
        { noEmit: true, incremental: false, composite: false },
        configPath,
    );

    return ts.createProgram(
        unit.files.map((file) => path.join(repoRoot, file)),
        parsed.options,
        ts.createCompilerHost(parsed.options, true),
    );
}

/**
 * Whether the compiler reaches a DECLARATION for a link target.
 *
 * Deliberately the same two steps TypeScript's own `buildLinkParts` takes before it emits a navigable link:
 * resolve the name, then follow import/export aliases to something declared. The alias hop is what catches a
 * link whose target is imported from a module that does not resolve — the checker still hands back an alias
 * symbol there, so stopping at the first symbol would call a broken import resolvable.
 *
 * @param checker - The program's checker.
 * @param name - The entity name written inside the link.
 * @returns True when a declaration was reached. Pure with respect to the program.
 */
function resolvesToDeclaration(checker: ts.TypeChecker, name: ts.EntityName | ts.JSDocMemberName): boolean {
    let symbol = checker.getSymbolAtLocation(name);

    // Bounded: a malformed re-export cycle would otherwise spin here.
    for (let hop = 0; symbol && hop < 16 && (symbol.flags & ts.SymbolFlags.Alias) !== 0; hop += 1) {
        const aliased = checker.getAliasedSymbol(symbol);

        if (aliased === symbol) {
            break;
        }

        symbol = aliased;
    }

    return (symbol?.declarations?.length ?? 0) > 0;
}

/**
 * Read every link out of the given files of a program, with its resolution verdict.
 *
 * The walk visits each node's attached JSDoc via the compiler's own accessor and dedupes by position, because
 * one comment is reachable from several host nodes (a variable statement and its declaration) and would
 * otherwise be reported two or three times. A link written in a comment the parser attaches to NO declaration
 * is not visited — and is not a link in any tool either, since TypeScript never turns it into a node.
 *
 * @param program - The program to read.
 * @param files - Repo-relative paths to inspect; anything absent from the program is reported as an error row.
 * @returns One entry per link, in file order.
 */
export function collectDocLinks(program: ts.Program, files: readonly string[]): readonly DocLink[] {
    const checker = program.getTypeChecker();
    const links: DocLink[] = [];

    for (const file of files) {
        const source = program.getSourceFile(path.isAbsolute(file) ? file : path.join(repoRoot, file));

        if (!source) {
            throw new Error(`doc-link guard: ${file} is not in its program, so its links cannot be checked.`);
        }

        const seen = new Set<number>();
        const visitComment = (node: ts.Node): void => {
            if (ts.isJSDocLinkLike(node) && !seen.has(node.pos)) {
                seen.add(node.pos);
                links.push(describeLink(node, source, file, checker));
            }

            ts.forEachChild(node, visitComment);
        };
        const visit = (node: ts.Node): void => {
            for (const comment of jsDocBlocks(node)) {
                visitComment(comment);
            }

            ts.forEachChild(node, visit);
        };

        visit(source);

        for (const position of countCommentOpeners(source)) {
            if (!seen.has(position)) {
                links.push({
                    file,
                    line: source.getLineAndCharacterOfPosition(position).line + 1,
                    target:
                        source.text.slice(position, Math.min(position + 60, source.text.length)).split('\n')[0] ?? '',
                    form: 'uncompiled',
                    resolved: false,
                });
            }
        }
    }

    return links;
}

/**
 * A node's JSDoc blocks, ALL of them.
 *
 * `ts.getJSDocCommentsAndTags` looks tempting and is wrong here: it keeps only the LAST block attached to a
 * node, so a file whose first declaration carries its own docstring loses the module header above it — and in
 * this repo the module header is the largest and most link-dense comment there is. Measured: it hid every link
 * in 60-odd headers. The property is not in TypeScript's public surface, hence the structural assertion; the
 * opener reconciliation in {@link countCommentOpeners} is what proves this traversal misses nothing.
 *
 * @param node - Any node.
 * @returns Its JSDoc blocks in source order, or none.
 */
function jsDocBlocks(node: ts.Node): readonly ts.JSDoc[] {
    return (node as ts.Node & { readonly jsDoc?: readonly ts.JSDoc[] }).jsDoc ?? [];
}

/**
 * Every position in the file where a link opener appears inside a COMMENT.
 *
 * Comment ranges come from the compiler's own trivia reader over every token, so a string literal holding the
 * opener — this module's own needle, and the guard's fixtures — is never counted. Reconciling these positions
 * against the link nodes is what turns "the walk found N links" into "the walk found every link there is".
 *
 * @param source - The file to scan.
 * @returns The absolute position of each opener found in comment text.
 */
function countCommentOpeners(source: ts.SourceFile): readonly number[] {
    const positions: number[] = [];
    const scanned = new Set<number>();
    const scanToken = (node: ts.Node): void => {
        for (const range of ts.getLeadingCommentRanges(source.text, node.pos) ?? []) {
            if (scanned.has(range.pos)) {
                continue;
            }

            scanned.add(range.pos);

            for (let at = source.text.indexOf(LINK_OPENER, range.pos); at !== -1 && at < range.end; ) {
                positions.push(at);
                at = source.text.indexOf(LINK_OPENER, at + LINK_OPENER.length);
            }
        }

        node.forEachChild(scanToken);
    };

    scanToken(source);
    scanToken(source.endOfFileToken);

    return positions;
}

/**
 * Describe one link node.
 *
 * @param node - The link node.
 * @param source - The file it was found in.
 * @param file - That file's repo-relative path.
 * @param checker - The program's checker.
 * @returns The link, classified and resolved.
 */
function describeLink(
    node: ts.JSDocLink | ts.JSDocLinkCode | ts.JSDocLinkPlain,
    source: ts.SourceFile,
    file: string,
    checker: ts.TypeChecker,
): DocLink {
    const line = source.getLineAndCharacterOfPosition(node.pos).line + 1;
    const { name } = node;
    const written = `${name ? name.getText(source) : ''}${node.text}`.trim();

    // A URL destination needs no symbol. A link to `https://…` parses as the identifier `https` followed by
    // `://…`, and a scheme TypeScript will not take as an identifier leaves no name at all — so the test is
    // for the SCHEME, in either shape.
    if (URL_SCHEME.test(written)) {
        return { file, line, target: written, form: 'url', resolved: true };
    }

    if (!name) {
        return { file, line, target: written, form: 'unparsed', resolved: false };
    }

    const form: DocLinkForm =
        ts.isIdentifier(name) && name.text === 'import' && node.text.startsWith('(') ? 'importType' : 'entity';

    return {
        file,
        line,
        target: written,
        form,
        resolved: form === 'entity' && resolvesToDeclaration(checker, name),
    };
}

/**
 * The links a reader cannot follow.
 *
 * Pure. `url` links are exempt (a URL needs no symbol); everything else must reach a declaration.
 *
 * @param links - Links to filter.
 * @returns The unresolved subset, in input order.
 */
export function unresolvedDocLinks(links: readonly DocLink[]): readonly DocLink[] {
    return links.filter((link) => link.form !== 'url' && !link.resolved);
}

/**
 * Analyse the whole working tree.
 *
 * @returns Every link in every tracked, link-bearing TypeScript source.
 * @sideEffect Shells out to git and builds one program per owning tsconfig.
 */
export function analyzeRepoDocLinks(): readonly DocLink[] {
    return discoverDocLinkUnits().flatMap((unit) => collectDocLinks(createUnitProgram(unit), unit.files));
}
