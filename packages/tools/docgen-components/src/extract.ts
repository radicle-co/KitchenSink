/**
 * @module @kitchensink/docgen-components/extract — the ADAPTER over the two upstreams, and the only module
 * that knows either one's vocabulary.
 *
 * ## Why `react-docgen-typescript`, and what was rejected
 *
 * The requirement is AUTO-generation: the documentation must be a function of the source, so it cannot rot
 * away from the code the way a hand-written artifact does.
 *
 *  - **Storybook** — rejected outright. A story is HAND-WRITTEN, so a component without one is undocumented
 *    and nobody finds out; and this repository ships web AND React Native leaves, which would need two
 *    Storybook installations to render one component.
 *  - **TypeDoc** — rejected. It documents a module's exported API, which for `const Button: FC<ButtonProps>`
 *    is one const of one type. A prop table, its per-prop JSDoc, and above all the DESTRUCTURING DEFAULTS
 *    (`variant = 'primary'`) are not in TypeDoc's model at all — and the defaults are the half of a prop
 *    contract a reader cannot recover from the type.
 *  - **`react-docgen` (Babel)** — rejected. It reads JS/JSX ASTs; TypeScript types are recovered heuristically
 *    and generics, unions and imported prop interfaces degrade.
 *  - **The TypeScript compiler API, hand-rolled** — rejected under the library-first rule. Resolving
 *    `FC<Props>` to a prop table, following an imported prop interface, and recovering a destructuring
 *    default is precisely what `react-docgen-typescript` already does, and reimplementing it would be a
 *    reinvention with a test suite bolted on.
 *
 * `react-docgen-typescript` is what Storybook itself uses for TypeScript prop tables, has no runtime
 * dependencies, and drives the real TypeScript checker — so a union resolves to its members and a prop
 * imported from a sibling contract module resolves to that module. Measured against this tree: 0 props of
 * 958 degraded to `any`.
 *
 * ## The two things the library does NOT do, and why this module does them
 *
 *  1. **It reports no MODULE docblock.** This repository puts the substantive documentation in the file's
 *     `@module` header. `docblock.ts` recovers it from the same program.
 *  2. **It cannot see a ZERO-PROP component.** It derives a component from its props parameter, so
 *     `export default function LocaleLoading(): React.JSX.Element` yields nothing — measured, 8 such files
 *     in `@commise/web` alone. Dropping them silently would make the catalogue lie about coverage, so a
 *     compiler-API fallback adds them with an empty prop list and `detectedBy: 'compiler-fallback'`, which
 *     keeps the gap VISIBLE in the artifact rather than in nobody's head.
 *
 * ONE `ts.Program` per package serves both the library and the fallback (`parseWithProgramProvider`), so the
 * sources are parsed once and the two halves can never disagree about what the file says.
 *
 * @sideEffect Reads TypeScript sources and each package's `tsconfig.json` from disk.
 */
import { existsSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';

import { withCompilerOptions } from 'react-docgen-typescript';
import type { ComponentDoc, PropItem } from 'react-docgen-typescript';
import ts from 'typescript';

import { DocgenError } from './errors.js';
import { readLeadingDocblock, readModuleDocblock } from './docblock.js';
import { layerSignalsOf } from './classify.js';
import type { ComponentImplementation, DocTag, DocumentedProp } from './model.js';
import type { Platform } from './config.js';

/** The ref APIs CLAUDE.md calls near-forbidden. Their presence is evidence a reviewer should see. */
const REF_APIS = ['createRef', 'forwardRef', 'useImperativeHandle', 'useRef'] as const;

/** Everything the extractor needs about one package. */
export interface ExtractionInput {
    /** Absolute repository root — every emitted path is relative to it, so the artifact is checkout-portable. */
    readonly repoRoot: string;
    /** Absolute package root. */
    readonly packageDir: string;
    readonly compilerOptions: ts.CompilerOptions;
    /** Absolute paths of the `.tsx` files to document. */
    readonly files: readonly string[];
}

/**
 * Read a package's `tsconfig.json` into compiler options.
 *
 * Per-package rather than one repo-wide set, because each package carries its own `jsx` mode and `paths`.
 * A wrong `paths` map silently resolves an aliased prop type to `any`, which looks like documentation and is
 * not — hence the hard failure when the file is missing rather than a default-options fallback.
 *
 * @param packageDir - Absolute package root holding `tsconfig.json`.
 * @returns The parsed compiler options.
 * @throws DocgenError When the file is absent or unreadable.
 * @sideEffect Reads the filesystem.
 */
export function loadCompilerOptions(packageDir: string): ts.CompilerOptions {
    const configPath = resolve(packageDir, 'tsconfig.json');
    const read = ts.readConfigFile(configPath, ts.sys.readFile);

    if (read.error !== undefined) {
        throw new DocgenError(
            `cannot read ${configPath}: ${ts.flattenDiagnosticMessageText(read.error.messageText, ' ')}`,
        );
    }

    return ts.parseJsonConfigFileContent(read.config, ts.sys, packageDir).options;
}

/**
 * The platform a leaf renders on, from its filename.
 *
 * `docs/CODING_STANDARDS.md` §14 makes `.native.tsx` the ONLY platform suffix, so the filename is the whole
 * answer — never the directory, which would misread a `.native.tsx` sitting beside its web sibling.
 *
 * @param filePath - Any path.
 * @returns `native` for a `.native.tsx` leaf, `web` otherwise.
 */
export function platformOf(filePath: string): Platform {
    return filePath.endsWith('.native.tsx') ? 'native' : 'web';
}

/**
 * Repo-relative POSIX path.
 *
 * @param repoRoot - Absolute repository root.
 * @param filePath - Absolute path.
 * @returns The relative path with forward slashes.
 */
function repoRelative(repoRoot: string, filePath: string): string {
    return relative(repoRoot, filePath).replaceAll('\\', '/');
}

/**
 * Recover an absolute path from the CWD-RELATIVE one `react-docgen-typescript` reports for a prop's
 * declaring file.
 *
 * ⚠️ This is not defensive tidying. The library's `trimFileName` rewrites every declaring-file path to
 * `path.relative(dirname(process.cwd()), file)` — walking up from the process's working directory until it
 * finds a common ancestor — with no option to pass a root. So the SAME source tree yields DIFFERENT strings
 * depending on where the command was run from, and committed generated output whose bytes depend on the
 * caller's shell is output whose regenerate-and-diff guard fails for a reason that has nothing to do with
 * the code. Inverting the trim restores a path that depends only on the repository.
 *
 * The inversion is the trim's own loop run backwards: try each ancestor of `from` as the base until a
 * candidate exists on disk. A path that resolves nowhere is returned unchanged rather than guessed at.
 *
 * @param trimmed - The path as the library reported it.
 * @param from - The directory to walk up from (the process working directory).
 * @returns An absolute path when one can be recovered, else the input unchanged.
 * @sideEffect Probes the filesystem for the candidate paths.
 */
export function resolveTrimmedPath(trimmed: string, from: string): string {
    if (isAbsolute(trimmed)) {
        return trimmed;
    }

    let parent = from;

    for (;;) {
        const candidate = resolve(dirname(parent), trimmed);

        if (existsSync(candidate)) {
            return candidate;
        }

        const next = dirname(parent);

        if (next === parent) {
            return trimmed;
        }

        parent = next;
    }
}

/**
 * Project one library prop onto the domain shape.
 *
 * @param repoRoot - Absolute repository root.
 * @param prop - The library's prop record.
 * @returns The domain prop.
 */
function toDocumentedProp(repoRoot: string, prop: PropItem): DocumentedProp {
    const unionMembers = prop.type.value;
    const typeDetail =
        Array.isArray(unionMembers) && unionMembers.every((member) => typeof member?.value === 'string')
            ? unionMembers.map((member) => String(member.value))
            : null;

    return {
        name: prop.name,
        type: prop.type.name,
        typeDetail,
        required: prop.required,
        defaultValue: prop.defaultValue === null ? null : String(prop.defaultValue.value),
        description: prop.description.trim(),
        declaredIn:
            prop.parent === undefined
                ? null
                : repoRelative(repoRoot, resolveTrimmedPath(prop.parent.fileName, process.cwd())),
    };
}

/**
 * The ref APIs a source file references, sorted.
 *
 * @param source - The parsed source file.
 * @returns The distinct ref API names used.
 */
function refApisIn(source: ts.SourceFile): readonly string[] {
    const found = new Set<string>();

    const visit = (node: ts.Node): void => {
        if (ts.isIdentifier(node) && (REF_APIS as readonly string[]).includes(node.text)) {
            found.add(node.text);
        }

        ts.forEachChild(node, visit);
    };

    visit(source);

    return [...found].sort();
}

/** True when the node's subtree contains a JSX element or fragment. */
function containsJsx(node: ts.Node): boolean {
    if (
        ts.isJsxElement(node) ||
        ts.isJsxSelfClosingElement(node) ||
        ts.isJsxFragment(node) ||
        ts.isJsxExpression(node)
    ) {
        return true;
    }

    return ts.forEachChild(node, (child) => (containsJsx(child) ? true : undefined)) === true;
}

/**
 * Boolean props used as the TEST of a conditional whose BOTH branches render JSX — the shape CLAUDE.md
 * names: a boolean prop that switches which subtree is rendered, rather than deriving a display detail.
 *
 * ⚠️ This is a CANDIDATE detector, not a verdict, which is why the finding it feeds is `review`. Selecting
 * between two subtrees can be legitimate display derivation (an empty state versus a list); what it cannot be
 * is invisible. The converse error — missing a switch expressed some other way — is accepted: a rule that
 * fires only on a shape it can actually see is worth more than one that guesses.
 *
 * @param declaration - The component's declaration node.
 * @param booleanPropNames - Names of the component's boolean props.
 * @returns The subset used as a subtree-selecting test, sorted.
 */
function booleanPropsSelectingSubtree(
    declaration: ts.Node | undefined,
    booleanPropNames: readonly string[],
): readonly string[] {
    if (declaration === undefined || booleanPropNames.length === 0) {
        return [];
    }

    const names = new Set(booleanPropNames);
    const hits = new Set<string>();

    const testReferences = (test: ts.Expression): readonly string[] => {
        const referenced: string[] = [];

        const visit = (node: ts.Node): void => {
            if (ts.isIdentifier(node) && names.has(node.text)) {
                referenced.push(node.text);
            }

            ts.forEachChild(node, visit);
        };

        visit(test);

        return referenced;
    };

    const visit = (node: ts.Node): void => {
        if (ts.isConditionalExpression(node) && containsJsx(node.whenTrue) && containsJsx(node.whenFalse)) {
            for (const name of testReferences(node.condition)) {
                hits.add(name);
            }
        }

        if (
            ts.isIfStatement(node) &&
            node.elseStatement !== undefined &&
            containsJsx(node.thenStatement) &&
            containsJsx(node.elseStatement)
        ) {
            for (const name of testReferences(node.expression)) {
                hits.add(name);
            }
        }

        ts.forEachChild(node, visit);
    };

    visit(declaration);

    return [...hits].sort();
}

/** A component-shaped export found by the compiler. This list is AUTHORITATIVE — see {@link exportedComponents}. */
interface ExportedComponent {
    readonly name: string;
    readonly exportKind: 'named' | 'default';
    readonly declaration: ts.Node;
    readonly tags: readonly DocTag[];
    readonly description: string;
}

/** One top-level declaration, before export status is known. */
interface LocalDeclaration {
    /** The node whose subtree is searched for JSX and for subtree-selecting conditionals. */
    readonly declaration: ts.Node;
    /** The node the JSDoc attaches to (the whole statement, not the initializer). */
    readonly docHost: ts.Node;
}

/**
 * PascalCase in React's sense: an initial capital followed by a lowercase letter or digit.
 *
 * The trailing character matters. A bare `/^[A-Z]/` also admits SCREAMING_SNAKE constants — `STAR_PATH`, an
 * SVG path string, sits beside a component in this tree — and a catalogue that lists a string constant as a
 * component is not documentation.
 */
const COMPONENT_NAME = /^[A-Z][a-z0-9]/;

/**
 * WHAT IS A COMPONENT IN THIS FILE — the authoritative answer, and the reason it is not the library's.
 *
 * `react-docgen-typescript` answers a different question. Its last resort is "any export that has a JSDoc
 * description and a name", which over this tree returned `generateMetadata`, `generateStaticParams`,
 * `useHomeNudge`, `useOncePerSessionNudge`, `pressScaleClassName` and `enterTransitionClassName` as
 * components — a metadata function, two hooks and two class-name helpers. It ALSO names a default export
 * after its FILE, so every Next.js route arrived as `page`, `error` or `layout`: 26 components with no
 * usable identity, and four called `page` in one catalogue.
 *
 * So the compiler decides WHICH exports are components and WHAT they are called, and the library is used for
 * what it is genuinely better at — resolving a props type into a documented prop table.
 *
 * The name test is React's own rule (a lowercase JSX tag is a DOM element, so a component identifier is
 * capitalised). The SHAPE test is a union of three signals, and every one was added because a real component
 * in this tree was lost without it — found by the per-file coverage assertion in
 * `tests/generatedOutput.integration.test.ts`, not by any fixture, because a fixture can only contain shapes
 * somebody already thought of:
 *
 *  1. **JSX in the subtree** — the ordinary leaf.
 *  2. **The library recognised it** — `RecipeCard` and `Wizard` are Compound Components exported as
 *     `Object.assign(RecipeCardRoot, { Header, Body, … })`, and `IngredientStatusPoller` is an `FC` that
 *     returns `null` on every path. Neither has JSX in the exported declaration's own subtree.
 *  3. **The single default export of a file that contains JSX** — `App.tsx` exports
 *     `sentryInitialized ? Sentry.wrap(App) : App`, a conditional over two call results.
 *
 * ⛔ The name test is NOT loosened to `/^[A-Z]/` to make signal 3 unnecessary: that admits SCREAMING_SNAKE
 * constants, and a catalogue listing an SVG path string as a component is worse than one missing a wrapper.
 *
 * ⛔ A FOURTH signal — "the declaration is annotated `FC` / `ComponentType`" — was written, and then DELETED
 * after mutation testing: removing it changed nothing anywhere in the tree, because every component it would
 * have caught is already caught by signal 2. An untested branch that no input reaches is not robustness, it
 * is code nobody can prove is right. If a propless, undocumented `FC` that renders `null` ever lands, the
 * per-file coverage assertion fails by name and the signal comes back with a case that exercises it.
 *
 * All three export spellings are handled, because all three occur: an `export` modifier, an `export { … }`
 * clause naming a local, and `export default <identifier>`.
 *
 * @param source - The parsed source file.
 * @param libraryNames - Component names `react-docgen-typescript` reported for this file.
 * @returns Every exported component-shaped declaration, in source order.
 */
function exportedComponents(source: ts.SourceFile, libraryNames: ReadonlySet<string>): readonly ExportedComponent[] {
    const locals = new Map<string, LocalDeclaration>();
    const exported = new Map<string, 'named' | 'default'>();

    for (const statement of source.statements) {
        const modifiers = ts.canHaveModifiers(statement) ? (ts.getModifiers(statement) ?? []) : [];
        const hasExport = modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
        const hasDefault = modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword);

        if (ts.isFunctionDeclaration(statement) && statement.name !== undefined) {
            locals.set(statement.name.text, { declaration: statement, docHost: statement });

            if (hasExport) {
                exported.set(statement.name.text, hasDefault ? 'default' : 'named');
            }

            continue;
        }

        if (ts.isVariableStatement(statement)) {
            for (const declaration of statement.declarationList.declarations) {
                if (ts.isIdentifier(declaration.name) && declaration.initializer !== undefined) {
                    locals.set(declaration.name.text, {
                        declaration: declaration.initializer,
                        docHost: statement,
                    });

                    if (hasExport) {
                        exported.set(declaration.name.text, 'named');
                    }
                }
            }

            continue;
        }

        // `export { Foo, Bar as Baz }` — a local declared above is exported here, possibly under a new name.
        if (ts.isExportDeclaration(statement) && statement.exportClause !== undefined) {
            if (ts.isNamedExports(statement.exportClause)) {
                for (const specifier of statement.exportClause.elements) {
                    exported.set((specifier.propertyName ?? specifier.name).text, 'named');
                }
            }

            continue;
        }

        // `export default Foo` — the identifier names a local declared above.
        if (ts.isExportAssignment(statement) && ts.isIdentifier(statement.expression)) {
            exported.set(statement.expression.text, 'default');
        }
    }

    const defaultExports = [...exported].filter(([, kind]) => kind === 'default');
    const fileHasJsx = containsJsx(source);

    const found: ExportedComponent[] = [];

    for (const [name, exportKind] of exported) {
        const local = locals.get(name);

        if (local === undefined || !COMPONENT_NAME.test(name)) {
            continue;
        }

        const isComponent =
            containsJsx(local.declaration) ||
            libraryNames.has(name) ||
            (exportKind === 'default' && defaultExports.length === 1 && fileHasJsx);

        if (!isComponent) {
            continue;
        }

        const docblock = readLeadingDocblock(source, local.docHost);
        found.push({
            name,
            exportKind,
            declaration: local.declaration,
            tags: docblock.tags,
            description: docblock.text,
        });
    }

    return found;
}

/**
 * Extract every component leaf in a set of files.
 *
 * @param input - Repo root, package root, compiler options and the files to read.
 * @returns One implementation record per component leaf, ordered by source path then component name.
 * @sideEffect Reads the given sources through a TypeScript program.
 */
export function extractImplementations(input: ExtractionInput): readonly ComponentImplementation[] {
    const { repoRoot, files, compilerOptions } = input;

    if (files.length === 0) {
        return [];
    }

    const program = ts.createProgram([...files], compilerOptions);
    const parser = withCompilerOptions(compilerOptions, {
        savePropValueAsString: true,
        shouldExtractLiteralValuesFromEnum: true,
        shouldRemoveUndefinedFromOptional: true,
        // A component's OWN contract is what this documents. Everything a React element type contributes —
        // the whole DOM/SVG event surface — is React's documentation, and inlining it buried 487 of 1,127
        // props under `ReactEventHandler<SVGSVGElement>` noise in one package alone. A prop declared in a
        // workspace package resolves through its symlink to a real source path, so shared contracts stay.
        propFilter: (prop) => (prop.parent === undefined ? true : !prop.parent.fileName.includes('node_modules')),
    });

    const parsed: readonly ComponentDoc[] = parser.parseWithProgramProvider([...files], () => program);
    const byFile = new Map<string, ComponentDoc[]>();

    for (const doc of parsed) {
        const bucket = byFile.get(doc.filePath) ?? [];
        bucket.push(doc);
        byFile.set(doc.filePath, bucket);
    }

    const implementations: ComponentImplementation[] = [];

    for (const file of files) {
        const source = program.getSourceFile(file);

        if (source === undefined) {
            throw new DocgenError(`TypeScript did not load ${file}; check the package's tsconfig include globs`);
        }

        const moduleDocblock = readModuleDocblock(source);
        const usesRefApi = refApisIn(source);
        const documented = byFile.get(file) ?? [];
        const declarations = exportedComponents(source, new Set(documented.map((doc) => doc.displayName)));

        // Match each library result to the component the compiler found. A result naming a component the
        // compiler did not identify is DISCARDED — see `exportedComponents` for what those turned out to be.
        const byName = new Map(documented.map((doc) => [doc.displayName, doc]));
        const namedComponents = new Set(declarations.map((entry) => entry.name));
        const defaultExports = declarations.filter((entry) => entry.exportKind === 'default');
        // A default export is named after its FILE by the library, so it never matches by name. When the file
        // has exactly one, the unmatched result is unambiguously its.
        const unmatched = documented.filter((doc) => !namedComponents.has(doc.displayName));
        const forDefaultExport = defaultExports.length === 1 && unmatched.length === 1 ? unmatched[0] : undefined;

        for (const declaration of declarations) {
            const doc =
                byName.get(declaration.name) ?? (declaration.exportKind === 'default' ? forDefaultExport : undefined);
            const props = Object.values(doc?.props ?? {})
                .map((prop) => toDocumentedProp(repoRoot, prop))
                .sort((left, right) => left.name.localeCompare(right.name));
            const libraryTags: readonly DocTag[] = Object.entries(doc?.tags ?? {}).map(([name, text]) => ({
                name,
                text: String(text).trim(),
            }));
            const description = doc === undefined ? declaration.description : doc.description.trim();
            const booleanProps = props.filter((prop) => prop.type === 'boolean').map((prop) => prop.name);

            implementations.push({
                name: declaration.name,
                platform: platformOf(file),
                sourcePath: repoRelative(repoRoot, file),
                dir: repoRelative(repoRoot, dirname(file)),
                moduleDoc: moduleDocblock.text,
                moduleTags: moduleDocblock.tags,
                description,
                tags: doc === undefined ? declaration.tags : libraryTags,
                detectedBy: doc === undefined ? 'compiler-fallback' : 'react-docgen-typescript',
                exportKind: declaration.exportKind,
                props,
                usesRefApi,
                booleanPropsSelectingSubtree: booleanPropsSelectingSubtree(declaration.declaration, booleanProps),
                docSignals: layerSignalsOf(`${moduleDocblock.text}\n${description}`),
            });
        }
    }

    return implementations.sort(
        (left, right) => left.sourcePath.localeCompare(right.sourcePath) || left.name.localeCompare(right.name),
    );
}
