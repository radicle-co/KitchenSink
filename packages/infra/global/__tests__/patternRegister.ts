/**
 * The PATTERN REGISTER's mechanism — reading the committed component catalogue, and the pure predicates that
 * decide which components owe a `@pattern` entry and which entries are worthless.
 *
 * ## Why this reads the committed catalogue instead of parsing the sources again
 *
 * `packages/tools/docgen-components` already walks every `.tsx` under `packages/apps/commise/**` with the
 * TypeScript compiler, resolves cross-platform leaves into one entry, and writes the result to
 * `docs/generated/components/`. Its own `generatedOutput.integration.test.ts` re-derives that artifact in
 * memory and compares it with the committed bytes, so the file on disk is PROVEN equal to the sources on
 * every run of `npm test`.
 *
 * A second extractor here would therefore buy nothing and cost the one thing that matters: two parsers that
 * can disagree. When they did, the gate would be reasoning about a component surface the documentation does
 * not describe, and neither side would say so. Reading the proven artifact keeps ONE authoritative
 * description of what components exist (`docs/CODING_STANDARDS.md` §16.3 — the gates parse, they do not
 * grep; this one consumes a parse rather than performing a worse one).
 *
 * ⚠️ The dependency is real and is the price: if the catalogue is stale, this gate is stale with it. That is
 * why {@link readComponentCatalogue} refuses an empty or unreadable catalogue rather than reporting a clean
 * tree — a guard that passes because it read nothing is the failure this branch has spent its whole length
 * removing.
 *
 * ## Everything here is MECHANISM or a PURE PREDICATE
 *
 * The register itself — which components are exempt and why, and the triage of every ref site — lives in
 * `patternRegister.test.ts`, where a reader looking for a judgement finds one. The predicates are pure so the
 * suite can fire them at deliberately-violating fakes, which is the only way to know the gate can still go
 * red. Same shape as `docLinks.ts` / `docCrossReferences.test.ts`.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import ts from 'typescript';

import { repoRoot } from './serviceSources.js';

/** The catalogue's own index — the ONE place group catalogues are enumerated, so this gate enumerates none. */
export const CATALOGUE_INDEX = 'docs/generated/components/index.json';

/**
 * One component as this gate sees it — a deliberately narrow projection of the catalogue entry.
 *
 * Narrow because a projection that carried every field would let a predicate quietly start depending on one,
 * and the fakes below would then stop resembling the real input.
 */
export interface RegisteredComponent {
    /** Stable id — `<group>/<path under the group's source root>/<name>`. */
    readonly id: string;
    /** Owning workspace package, e.g. `@commise/ui`. */
    readonly packageName: string;
    /** The catalogue GROUP's layer — a property of the registry, not of any docblock. */
    readonly layer: string;
    /** The layer the component's own docblock states, or `unclassified` when it states none. */
    readonly kind: 'presentational' | 'orchestration' | 'unclassified';
    /** Patterns the component's docblocks NAME via `@pattern`, as the generator extracted them. */
    readonly patterns: readonly string[];
    /** Ref APIs any leaf reaches for, deduplicated across leaves. Empty for the overwhelming majority. */
    readonly refApis: readonly string[];
    /** Boolean props used as the test of a conditional whose BOTH branches render JSX, across leaves. */
    readonly booleanSubtreeProps: readonly string[];
    /** Repo-relative source paths of every leaf, so a finding can point a reader at a file. */
    readonly sourcePaths: readonly string[];
}

/** The shape of a catalogue entry this module reads. Only the fields it uses are declared. */
interface CatalogueEntry {
    readonly id: string;
    readonly packageName: string;
    readonly layer: string;
    readonly kind: string;
    readonly patterns: readonly string[];
    readonly implementations: readonly {
        readonly sourcePath: string;
        readonly usesRefApi: readonly string[];
        readonly booleanPropsSelectingSubtree: readonly string[];
    }[];
}

/** The shape of the catalogue index this module reads. */
interface CatalogueIndex {
    readonly groups: readonly { readonly catalogue: string }[];
}

/** Thrown when the catalogue cannot be read or carries nothing — never swallowed into a clean verdict. */
export class CatalogueUnreadableError extends Error {
    public constructor(message: string) {
        super(message);
        this.name = 'CatalogueUnreadableError';
        Object.setPrototypeOf(this, CatalogueUnreadableError.prototype);
    }
}

/** Type guard for {@link CatalogueUnreadableError}. */
export function isCatalogueUnreadableError(error: unknown): error is CatalogueUnreadableError {
    return error instanceof CatalogueUnreadableError;
}

/**
 * Every component in the committed catalogue, projected to {@link RegisteredComponent}.
 *
 * @param root - Repo root; defaults to this checkout's.
 * @sideEffect Reads the committed catalogue from disk.
 * @returns Every catalogued component, in catalogue order.
 * @throws CatalogueUnreadableError when the index or a group catalogue is missing, malformed, or empty.
 */
export function readComponentCatalogue(root: string = repoRoot): readonly RegisteredComponent[] {
    const indexPath = path.join(root, CATALOGUE_INDEX);
    let index: CatalogueIndex;

    try {
        index = JSON.parse(readFileSync(indexPath, 'utf8')) as CatalogueIndex;
    } catch (cause) {
        throw new CatalogueUnreadableError(
            `cannot read the component catalogue index at ${CATALOGUE_INDEX} (${String(cause)}). Regenerate ` +
                'it with `npm run docs:generate --workspace=packages/tools/docgen-components`.',
        );
    }

    if (!Array.isArray(index.groups) || index.groups.length === 0) {
        throw new CatalogueUnreadableError(`${CATALOGUE_INDEX} lists no component groups.`);
    }

    const components: RegisteredComponent[] = [];

    for (const group of index.groups) {
        let parsed: { readonly components?: unknown };

        try {
            parsed = JSON.parse(readFileSync(path.join(root, group.catalogue), 'utf8')) as {
                readonly components?: unknown;
            };
        } catch (cause) {
            throw new CatalogueUnreadableError(
                `cannot read the group catalogue ${group.catalogue} (${String(cause)}).`,
            );
        }

        if (!Array.isArray(parsed.components)) {
            throw new CatalogueUnreadableError(`${group.catalogue} carries no \`components\` array.`);
        }

        for (const entry of parsed.components as readonly CatalogueEntry[]) {
            components.push({
                id: entry.id,
                packageName: entry.packageName,
                layer: entry.layer,
                kind: entry.kind === 'presentational' || entry.kind === 'orchestration' ? entry.kind : 'unclassified',
                patterns: entry.patterns,
                refApis: [...new Set(entry.implementations.flatMap((leaf) => leaf.usesRefApi))].sort(),
                booleanSubtreeProps: [
                    ...new Set(entry.implementations.flatMap((leaf) => leaf.booleanPropsSelectingSubtree)),
                ].sort(),
                sourcePaths: entry.implementations.map((leaf) => leaf.sourcePath),
            });
        }
    }

    if (components.length === 0) {
        throw new CatalogueUnreadableError('the component catalogue is empty — every assertion over it would pass.');
    }

    return components;
}

/**
 * Whether a component owes a `@pattern` register entry.
 *
 * THE SCOPE PREDICATE, and the whole amendment turns on it. It is an INCLUSION list, never an exclusion
 * list. An exclusion list has to anticipate every trivial shape in advance and gets them wrong by name:
 * `ChromeIcon` reads as a glyph and is a Registry keyed by the shared nav model, `LocaleLayout` reads as a
 * framework file and is a Null Object. An inclusion list only has to name the places where a pattern name
 * does work no other field does. Route segments and icon glyphs then need no rule at all — they are simply
 * not in scope, and nothing has to argue them away.
 *
 * A component owes an entry when its shape is a CHOICE rather than React's default:
 *
 *  1. **It is a design-system component** (`@commise/ui`). Seven units, and they are the vocabulary the
 *     other 217 are written in. A vocabulary that will not name its own words is the highest-leverage gap
 *     in the tree.
 *  2. **It reaches for a ref API.** CLAUDE.md permits a ref only "to wrap a genuinely external,
 *     non-declarative system with no alternative". That carve-out IS a pattern claim — Adapter, Facade,
 *     Decorator over the imperative subsystem — so naming the pattern is the justification the ref rule
 *     already demands, written where the rule can check it instead of nowhere. It also separates the honest
 *     claim from the dishonest one immediately, which is what `REF_SITES` in the suite then records.
 *  3. **A boolean prop selects between two rendered subtrees.** CLAUDE.md rule 3 and
 *     `docs/CODING_STANDARDS.md` §11 both say the resolution is orchestration selecting the right render
 *     component; the tag is where that resolution gets named, or where "this is display derivation, not
 *     behaviour" gets argued.
 *  4. **It states that it is an orchestration component.** It decides something, and what it decides WITH —
 *     a statechart, a Suspense selector, a Command, an Adapter over a container — is a design decision a
 *     reader cannot recover from the code without re-deriving it.
 *
 * ⛔ CLAUSE 4 IS THE ONLY ONE READ OUT OF PROSE, AND THAT IS A HAZARD, NOT A DETAIL. `kind` is derived by
 * regexing the docblock for layer words, so an obligation resting on it can be ESCAPED BY DELETING A WORD
 * FROM THE DOCBLOCK — the gate would go green because the documentation got worse, silently, and by the
 * hand of exactly the author who did not want to write the tag. It is kept because clauses 1-3 miss every
 * composition point in the tree (`RecipeDetailView`, the nutrition boundaries, the sign-out commands, the
 * route error boundary), which is where a pattern name is worth the most. The escape is closed instead by
 * `DECLARED_ORCHESTRATION` in the suite, which pins the components obliged under this clause and fails by
 * NAME when one stops declaring it. Do not add a fifth prose-derived clause without pinning it the same way,
 * and do not "simplify" clauses 1-3 into `kind`-based ones.
 *
 * A pure presentational leaf outside the design system owes nothing, and that is deliberate rather than
 * lenient: its only pattern is the layer, its docblock already states the layer, and
 * `docs/CODING_STANDARDS.md` §8 (owner ruling 2026-08-12) forbids the near-duplicate a
 * `@pattern Presentational Component` tag beside it would be.
 *
 * Pure.
 *
 * @param component - The component to judge.
 * @returns True when the component must name a pattern.
 */
export function owesPatternEntry(component: RegisteredComponent): boolean {
    return (
        component.layer === 'design-system' ||
        component.refApis.length > 0 ||
        component.booleanSubtreeProps.length > 0 ||
        component.kind === 'orchestration'
    );
}

/**
 * The ids of every component obliged under the prose-derived clause 4 of {@link owesPatternEntry}.
 *
 * Pure.
 *
 * @param components - The catalogued components.
 * @returns The ids, in catalogue order.
 */
export function declaresOrchestration(components: readonly RegisteredComponent[]): readonly string[] {
    return components.filter((component) => component.kind === 'orchestration').map((component) => component.id);
}

/**
 * Pattern values that only restate the layer, normalized for comparison.
 *
 * ⛔ THIS IS THE ASSERTION THAT KEEPS THE REGISTER WORTH READING. A register in which every entry says
 * "Presentational Component" satisfies the letter of the rule, carries no information, and makes the rule
 * permanently unenforceable while appearing to be enforced — the exact cargo-cult outcome the amendment was
 * written to prevent. The layer is already a field; a tag that repeats it is not a second fact.
 *
 * ⚠️ ITS LIMIT, STATED SO NOBODY MISTAKES IT FOR MORE. This is a denylist of the restatements people
 * actually write, not a proof of substance: `@pattern Leaf` or `@pattern UI Component` would pass it. It
 * raises the floor and nothing more — the thing that catches a vacuous tag is review, and the thing that
 * catches a FALSE one (an `Adapter` that stopped adapting) is only review. Extend the list when a new
 * restatement is seen in the wild; do not try to grow it into a substance checker.
 */
const LAYER_RESTATEMENTS: ReadonlySet<string> = new Set([
    'component',
    'container',
    'container component',
    'function component',
    'hook',
    'orchestration',
    'orchestration component',
    'orchestrational',
    'orchestrator',
    'presentation component',
    'presentational',
    'presentational component',
    'pure component',
    'react component',
    'render component',
]);

/**
 * A pattern value reduced to the form {@link LAYER_RESTATEMENTS} is compared against.
 *
 * Markdown emphasis, trailing punctuation and case are stripped because the repository writes pattern names
 * three ways already (`**Adapter**`, `Adapter —`, `adapter`), and a denylist defeated by a pair of asterisks
 * is a denylist that stops the careless author and waves the careless-plus-bold one through.
 *
 * Pure.
 *
 * @param pattern - The raw `@pattern` text.
 * @returns The normalized head of the value.
 */
export function normalizePattern(pattern: string): string {
    const head = pattern.split(/[—:.(\n]/u)[0] ?? '';

    return head
        .replace(/[*_`]/gu, '')
        .replace(/[^\p{L}\p{N} ]/gu, ' ')
        .trim()
        .replace(/\s+/gu, ' ')
        .toLowerCase();
}

/**
 * Whether a `@pattern` value is a bare restatement of the component's layer rather than a register entry.
 *
 * Pure.
 *
 * @param pattern - The raw `@pattern` text.
 * @returns True when the value carries nothing the layer field does not.
 */
export function isLayerRestatement(pattern: string): boolean {
    return LAYER_RESTATEMENTS.has(normalizePattern(pattern));
}

/** One component that fails the register's rules, and why. */
export interface RegisterFinding {
    readonly id: string;
    /** Repo-relative path of the first leaf, so the message points somewhere. */
    readonly sourcePath: string;
    readonly reason: 'no-pattern-named' | 'pattern-only-restates-layer';
    /** The offending values, for `pattern-only-restates-layer`. */
    readonly evidence: readonly string[];
}

/**
 * Every component that owes a pattern entry and does not have a usable one.
 *
 * The two reasons are kept apart because their fixes are opposite: one author has written nothing and must
 * decide what the unit IS, the other has written a word that says nothing and must replace it. Collapsing
 * them into "missing pattern" would tell the second author to add the tag they already added.
 *
 * Pure.
 *
 * @param components - The catalogued components.
 * @returns The findings, in catalogue order.
 */
export function registerFindings(components: readonly RegisteredComponent[]): readonly RegisterFinding[] {
    const findings: RegisterFinding[] = [];

    for (const component of components) {
        if (!owesPatternEntry(component)) {
            continue;
        }

        const sourcePath = component.sourcePaths[0] ?? component.id;
        const usable = component.patterns.filter((pattern) => !isLayerRestatement(pattern));

        if (component.patterns.length === 0) {
            findings.push({ id: component.id, sourcePath, reason: 'no-pattern-named', evidence: [] });
        } else if (usable.length === 0) {
            findings.push({
                id: component.id,
                sourcePath,
                reason: 'pattern-only-restates-layer',
                evidence: component.patterns,
            });
        }
    }

    return findings;
}

/**
 * The ids of every component whose docblock states no layer at all.
 *
 * Silence here is what the scope predicate's first clause can be dodged with: a component that never says it
 * orchestrates is never asked what pattern it orchestrates WITH. So the count is ratcheted separately, and
 * the dodge costs the author a failing gate rather than nothing.
 *
 * Pure.
 *
 * @param components - The catalogued components.
 * @returns The ids, in catalogue order.
 */
export function layerUnstated(components: readonly RegisteredComponent[]): readonly string[] {
    return components.filter((component) => component.kind === 'unclassified').map((component) => component.id);
}

/**
 * The ids of every component any of whose leaves reaches for a ref API.
 *
 * Pure.
 *
 * @param components - The catalogued components.
 * @returns The ids, in catalogue order.
 */
export function refUsingComponents(components: readonly RegisteredComponent[]): readonly string[] {
    return components.filter((component) => component.refApis.length > 0).map((component) => component.id);
}

/** The app tree the ref rule governs — the same roots `docgen-components`' registry walks. */
const COMMISE_APPS_DIR = 'packages/apps/commise';

/** Directories that hold no authored source. */
const NOT_SOURCE = new Set(['node_modules', 'dist', 'build', '.next', '.expo', '.turbo', 'coverage']);

/**
 * The ref APIs a module can reach for.
 *
 * ⚠️ A COPY of `docgen-components`' own `REF_APIS`, and deliberately so: that list is private to the
 * generator, and importing a tool package into a guard to share four string literals would couple the gate to
 * the generator's internals for no benefit. The two are pinned to agree by
 * {@link refUsingModulesOutsideComponents}'s own suite, which asserts the union of what BOTH halves find
 * covers every ref-bearing module in the tree.
 */
const REF_APIS: ReadonlySet<string> = new Set(['createRef', 'forwardRef', 'useImperativeHandle', 'useRef']);

/** Every `.ts`/`.tsx` file under `dir`, repo-relative, in a stable order. */
function sourceFilesUnder(dir: string): readonly string[] {
    const found: string[] = [];

    for (const entry of readdirSync(path.join(repoRoot, dir), { withFileTypes: true }).sort((a, b) =>
        a.name.localeCompare(b.name),
    )) {
        const relative = `${dir}/${entry.name}`;

        if (entry.isDirectory()) {
            if (!NOT_SOURCE.has(entry.name)) {
                found.push(...sourceFilesUnder(relative));
            }
        } else if (/\.tsx?$/u.test(entry.name)) {
            found.push(relative);
        }
    }

    return found;
}

/**
 * Whether `relative` is a TEST rather than shipped source.
 *
 * ⛔ The ref rule governs what SHIPS. A `useRef` inside a test harness cannot reach a user, and several of
 * this repo's strongest ref tests must construct one deliberately — `useRecipeEditor.test.tsx` builds a
 * component that mutates a ref during render precisely to prove the discarded-render hazard it fixed. Asking
 * that file for a VERDICT would be asking a reproduction to justify the bug it reproduces, and the only way
 * to satisfy it is to add a register entry that means nothing. Entries that mean nothing are how a register
 * stops being read.
 *
 * ⚠️ This narrows discovery, so state what it costs: a ref introduced in a file matching this predicate is
 * invisible to both halves of the register. That is acceptable only because such a file is never imported by
 * shipped code — which is exactly what `packages/tools/eslint`'s test-file rules and the `*.test.ts(x)`
 * convention in CODING_STANDARDS §7 already guarantee.
 */
function isTestSource(relative: string): boolean {
    return relative.includes('/__tests__/') || /\.(?:test|spec)\.tsx?$/u.test(relative);
}

/** Whether the module at `relative` names a ref API as an IDENTIFIER — a comment mentioning one does not. */
function reachesForARefApi(relative: string): boolean {
    const source = ts.createSourceFile(
        relative,
        readFileSync(path.join(repoRoot, relative), 'utf8'),
        ts.ScriptTarget.Latest,
        true,
    );
    let reaches = false;

    const visit = (node: ts.Node): void => {
        if (ts.isIdentifier(node) && REF_APIS.has(node.text)) {
            reaches = true;
        }

        if (!reaches) {
            ts.forEachChild(node, visit);
        }
    };

    ts.forEachChild(source, visit);

    return reaches;
}

/**
 * Repo-relative paths of EVERY file under `packages/apps/commise/**` that reaches for a ref API — components
 * and non-components alike, read straight from the working tree rather than from the catalogue.
 *
 * ⛔ It PARSES rather than greps (`docs/CODING_STANDARDS.md` §16.3), performing the same identifier scan the
 * generator does, so both halves of the register answer the same question about the same tree. This is the
 * ONE reading that does not depend on the catalogue, which is what lets the suite notice if the catalogue
 * ever stops reporting a ref it used to.
 *
 * @returns The repo-relative paths, sorted.
 * @sideEffect Reads the working tree.
 */
export function refUsingFiles(): readonly string[] {
    return sourceFilesUnder(COMMISE_APPS_DIR)
        .filter((relative) => !isTestSource(relative) && reachesForARefApi(relative))
        .sort();
}

/**
 * Repo-relative paths of every module that reaches for a ref API and is NOT a source of any catalogued
 * component — the hooks and plain modules {@link refUsingComponents} structurally cannot see, because the
 * catalogue discovers components and a hook module declares none.
 *
 * @param components - The catalogued components, whose leaf source paths are the half already triaged.
 * @returns The repo-relative paths, sorted.
 * @sideEffect Reads the working tree.
 */
export function refUsingModulesOutsideComponents(components: readonly RegisteredComponent[]): readonly string[] {
    const componentSources = new Set(components.flatMap((component) => component.sourcePaths));

    return refUsingFiles().filter((relative) => !componentSources.has(relative));
}

/**
 * A JSDoc line that opens a tag, as `docgen-components/docblock.ts` matches one.
 *
 * ⚠️ A COPY, for the same reason as {@link REF_APIS} and with a STRONGER pin. The generator's reader is
 * private to a tool package whose barrel drags `react-docgen-typescript` and `@commise/ui` in behind it, and
 * this gate needs a few lines of it to read files the component catalogue cannot see — a hook declares no
 * component, so nothing catalogues it. The two are pinned by the suite's agreement assertion, which fires
 * {@link modulePatternsIn} at every catalogued leaf and requires each pattern it finds to appear in the
 * catalogue's own set for that component, so a drift in either reader is a failing test rather than a hole.
 */
const TAG_LINE = /^@([A-Za-z][\w-]*)[ \t]?(.*)$/u;

/**
 * The `@pattern` texts inside one raw JSDoc block.
 *
 * Pure.
 *
 * @param raw - The verbatim comment text including its delimiters.
 * @returns The tag texts, in source order.
 */
function patternsInDocblock(raw: string): readonly string[] {
    const lines = raw
        .replace(/^\/\*\*+/u, '')
        .replace(/\*+\/$/u, '')
        .split('\n')
        .map((line) => line.replace(/^\s*\* ?/u, ''));

    const patterns: string[][] = [];
    let open: string[] | undefined;
    let started = false;

    for (const line of lines) {
        const match = TAG_LINE.exec(line);

        if (match === null) {
            open?.push(line);
            continue;
        }

        const [, name = '', rest = ''] = match;

        // The `@module` header's remainder is the module's own summary sentence, and by house convention it
        // legitimately begins with an `@`-prefixed package name. It opens no tag.
        if (name === 'module' && !started) {
            open = undefined;
            started = true;
            continue;
        }

        started = true;
        open = name === 'pattern' ? [rest] : undefined;

        if (open !== undefined) {
            patterns.push(open);
        }
    }

    return patterns.map((tagLines) => tagLines.join('\n').trim());
}

/**
 * The `@pattern` values a module's own leading docblock names.
 *
 * ⛔ The house docblock dialect is why this cannot be `ts.getJSDocTags`. A file here opens with
 * `@module @commise/ui/dialog-focus — focus return.`, and every standard JSDoc parser — TypeScript's and
 * `comment-parser` alike, because both implement the same grammar — reads the SECOND `@` as a new tag;
 * `docgen-components/docblock.ts` measured that emptying 213 module docblocks. A reader that got it wrong
 * here would report "names no pattern" about a module that names one, which is the false red that gets a
 * gate deleted rather than fixed.
 *
 * The block is located by the COMPILER's leading comment ranges, not by a regex over the file
 * (`docs/CODING_STANDARDS.md` §16.3), and the search follows the generator's own host order: a `'use client'`
 * directive, then the first import — both orders occur in this repository. A block above the first real
 * DECLARATION is that declaration's own doc and is deliberately not read as the module's.
 *
 * Pure.
 *
 * @param source - The module's full source text.
 * @returns The `@pattern` tag texts, in source order, byte-for-byte as the generator records them.
 */
export function modulePatternsIn(source: string): readonly string[] {
    const file = ts.createSourceFile('module.ts', source, ts.ScriptTarget.Latest, true);
    const fullText = file.getFullText();

    for (const statement of file.statements) {
        const isDirective = ts.isExpressionStatement(statement) && ts.isStringLiteral(statement.expression);

        if (!isDirective && !ts.isImportDeclaration(statement)) {
            break;
        }

        const raw = (ts.getLeadingCommentRanges(fullText, statement.getFullStart()) ?? [])
            .map((range) => fullText.slice(range.pos, range.end))
            .filter((text) => text.startsWith('/**'))
            .at(-1);

        if (raw !== undefined) {
            return patternsInDocblock(raw);
        }
    }

    return [];
}

/**
 * The source text of every named module, keyed by its repo-relative path.
 *
 * Split out from {@link moduleRegisterFindings} so the verdict stays PURE and the suite can fire it at
 * modules the tree does not contain — the same shape every other predicate here uses.
 *
 * @param paths - Repo-relative paths.
 * @param root - Repo root; defaults to this checkout's.
 * @returns Path to source text.
 * @sideEffect Reads the working tree.
 */
export function readModuleSources(paths: readonly string[], root: string = repoRoot): Readonly<Record<string, string>> {
    return Object.fromEntries(paths.map((relative) => [relative, readFileSync(path.join(root, relative), 'utf8')]));
}

/**
 * Every module that owes a pattern entry and does not have a usable one.
 *
 * ⛔ THE OBLIGATION FOLLOWS THE REF, NOT THE FILE'S COMPONENT-NESS. `docs/CODING_STANDARDS.md` §11.2 clause 2
 * obliges a ref-using COMPONENT to name its pattern because "that permission is itself a pattern claim, made
 * here where it can be reviewed". Every word of that reasoning is about the REF; none of it is about being a
 * component. So a ref moved into a hook used to take its justification out of the unit entirely and leave it
 * as a `why` string in the guard, which no reader of the hook ever meets. Two reasons, and the same
 * {@link isLayerRestatement} rule the component half uses: `@pattern Hook` is exactly the layer restatement
 * that half rejects.
 *
 * Pure.
 *
 * @param sources - Repo-relative path to module source text, as {@link readModuleSources} returns.
 * @returns The findings, in the order the paths were given.
 */
export function moduleRegisterFindings(sources: Readonly<Record<string, string>>): readonly RegisterFinding[] {
    const findings: RegisterFinding[] = [];

    for (const [sourcePath, source] of Object.entries(sources)) {
        const patterns = modulePatternsIn(source);
        const usable = patterns.filter((pattern) => !isLayerRestatement(pattern));

        if (patterns.length === 0) {
            findings.push({ id: sourcePath, sourcePath, reason: 'no-pattern-named', evidence: [] });
        } else if (usable.length === 0) {
            findings.push({ id: sourcePath, sourcePath, reason: 'pattern-only-restates-layer', evidence: patterns });
        }
    }

    return findings;
}

/**
 * The layer words a component docblock uses, as `docgen-components/classify.ts` matches them.
 *
 * ⚠️ A COPY, pinned by use: {@link layerNamedOnlyInAPatternTag} runs over a tree whose `kind` the generator
 * derived with these exact expressions, so the two readings are compared on every run rather than trusted.
 */
const LAYER_WORDS = /\borchestrat(?:ion|ional|ing|es|or)\b|\bpresentational\b/iu;

/**
 * The ids of every component that names its layer ONLY inside a `@pattern` tag.
 *
 * ⛔ THE ONE PART OF THE UNSTATED-LAYER CENSUS A GUARD CAN CALL A DEFECT. `classify.ts` derives `kind` from
 * the docblock's PROSE — module summary plus component description — and never from tag text, so a component
 * whose tag reads `Orchestration container over the useRecipeEditor headless hook` is reported
 * `unclassified`: it sits outside {@link owesPatternEntry}'s fourth clause, and outside the pin that guards
 * that clause, while its own documentation says which layer it is. That is a CONTRADICTION rather than a
 * missing sentence, and it is nameable without guessing anything from code shape — which is why it is
 * enforced at 100% while the census around it is only counted.
 *
 * ⛔ Do NOT "fix" it by teaching the classifier to read tags. That was considered and is DISPROVED by this
 * repository's own vocabulary: `Humble Object — the pure render half of the orchestration/render split` sits
 * on a PRESENTATIONAL leaf and contains the word "orchestration", so a tag-reading classifier would file it
 * as orchestration — manufacturing exactly the wrong classification `classify.ts` refuses to guess at. The
 * tag names the PATTERN and the prose names the LAYER; this asserts they have not swapped jobs.
 *
 * Pure.
 *
 * @param components - The catalogued components.
 * @returns The ids, in catalogue order.
 */
export function layerNamedOnlyInAPatternTag(components: readonly RegisteredComponent[]): readonly string[] {
    return components
        .filter(
            (component) =>
                component.kind === 'unclassified' && component.patterns.some((pattern) => LAYER_WORDS.test(pattern)),
        )
        .map((component) => component.id);
}
