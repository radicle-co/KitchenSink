/**
 * A container that PAINTS a surface and HOLDS controls states that surface (`componentFixes.md` §10): `<Surface tone>`,
 * or on web the tone's classes (`surfaceToneClass`). Otherwise the controls inside read the page's surface, so a focus
 * ring gaps in canvas around a control on paper, and a press shows nothing on a muted card.
 *
 * The rule, read with the TypeScript parser (never by component name; a control is found by its ATTRIBUTES):
 *  - WEB: a JSX element whose `className` carries a bare `bg-paper`, `bg-paper-overlay` or `bg-surface-muted` token, and
 *    which has a descendant JSX element in the same file with `onClick`, `onPress`, `href` or `onValueChange` (the
 *    attributes of a control that wears our press and focus recipes), is a violation. A `bg-*` behind a variant (`hover:bg-surface-muted`, a press) is not a surface.
 *  - NATIVE: a JSX element whose `style` paints `backgroundColor` from `colors.paper`, `colors.paperOverlay` or
 *    `colors.surfaceMuted`, with such a descendant, is a violation.
 *
 * A `className` that names a same-file `const` (`className={CARD}`, `${BASE}`, `ROWS[kind]`) is followed to the constant's
 * strings, to a fixed depth, because this codebase holds its class lists in constants.
 *
 * Known gap, stated and not hidden: the controls must be in the SAME FILE as the container. A container whose children are
 * passed in from another file (`{children}`) is not seen; those are the callers' containers, and the recipe is the fix
 * at the call site. `ui/src/surfaceTone/` is exempt: it is where the tone classes are written.
 *
 * ⛔ NO BASELINE AND NO ALLOW-LIST. SCOPE: `packages/apps/**` TypeScript minus tests and fixtures (`appSources.ts`).
 *
 * @pattern Fitness Function over the source of every app
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { appSourceModules, classTokensOf, parseModule } from './appSources.js';
import { repoRoot } from './serviceSources.js';

/** The directory that writes the tone classes, and so contains a bare `bg-paper`. */
const EXEMPT_DIRECTORY = 'packages/apps/commise/ui/src/surfaceTone/';

/** The attributes that make a descendant a control. */
const CONTROL_ATTRIBUTES = new Set(['onClick', 'onPress', 'href', 'onValueChange']);

/** The web background tokens that paint a surface. */
const SURFACE_CLASSES = new Set(['bg-paper', 'bg-paper-overlay', 'bg-surface-muted']);

/** The native colour roles that paint a surface. */
const SURFACE_ROLES = new Set(['paper', 'paperOverlay', 'surfaceMuted']);

/** The same-file `const` initialisers by name: where a `className={CARD}` finds the string it names. */
function constantsOf(file: ts.SourceFile): ReadonlyMap<string, ts.Expression> {
    const found = new Map<string, ts.Expression>();

    const walk = (node: ts.Node): void => {
        if (
            ts.isVariableDeclaration(node) &&
            ts.isIdentifier(node.name) &&
            node.initializer !== undefined &&
            (ts.isVariableDeclarationList(node.parent) ? (node.parent.flags & ts.NodeFlags.Const) !== 0 : false)
        ) {
            found.set(node.name.text, node.initializer);
        }

        ts.forEachChild(node, walk);
    };

    walk(file);

    return found;
}

/**
 * The strings an expression can contribute to a class list, and the source of every expression read to get them: its own
 * string-like nodes, plus those of any same-file `const` it names (an identifier, `RECORD[key]` or `RECORD.key`), followed
 * to a fixed depth. Reading a whole constant is deliberately generous: a constant that holds a surface anywhere in it is
 * read as painting one, and the fix is to state it. Pure.
 */
function classListOf(
    expression: ts.Node,
    constants: ReadonlyMap<string, ts.Expression>,
): { readonly strings: readonly string[]; readonly sources: readonly string[] } {
    const strings: string[] = [];
    const sources: string[] = [expression.getText()];
    const seen = new Set<string>();

    const walk = (node: ts.Node, depth: number): void => {
        if (
            ts.isStringLiteralLike(node) ||
            ts.isTemplateHead(node) ||
            ts.isTemplateMiddle(node) ||
            ts.isTemplateTail(node)
        ) {
            strings.push(node.text);
        }

        if (ts.isIdentifier(node) && depth < MAX_CONSTANT_DEPTH && !seen.has(node.text)) {
            const initializer = constants.get(node.text);

            if (initializer !== undefined) {
                seen.add(node.text);
                sources.push(initializer.getText());
                walk(initializer, depth + 1);
            }
        }

        ts.forEachChild(node, (child) => {
            walk(child, depth);
        });
    };

    walk(expression, 0);

    return { strings, sources };
}

/** How many constants deep a `className` is followed (`OUTER` -> `INNER` -> a literal). */
const MAX_CONSTANT_DEPTH = 4;

/** The attribute of a JSX opening element, by name. */
function attributeOf(opening: ts.JsxOpeningLikeElement, name: string): ts.JsxAttribute | undefined {
    return opening.attributes.properties.find(
        (property): property is ts.JsxAttribute => ts.isJsxAttribute(property) && property.name.getText() === name,
    );
}

/** Whether a surface painted by a web `className` is stated: the tone's classes (or a `Surface`) are there. */
function paintsWebSurface(opening: ts.JsxOpeningLikeElement, constants: ReadonlyMap<string, ts.Expression>): boolean {
    const className = attributeOf(opening, 'className');

    if (className === undefined) {
        return false;
    }

    const { strings, sources } = classListOf(className, constants);
    // `${surfaceToneClass('paper')}` states the tone; the literal tokens around it are not a bare `bg-paper`.
    const statesTone = sources.some((source) => /surfaceToneClass|SURFACE_TONE_CLASS/u.test(source));

    return (
        !statesTone && strings.some((text) => classTokensOf(text, false).some((token) => SURFACE_CLASSES.has(token)))
    );
}

/** Whether a native `style` paints a surface role as a background. */
function paintsNativeSurface(opening: ts.JsxOpeningLikeElement): boolean {
    const style = attributeOf(opening, 'style');

    if (style === undefined) {
        return false;
    }

    let painted = false;

    const walk = (node: ts.Node): void => {
        if (
            ts.isPropertyAssignment(node) &&
            node.name.getText() === 'backgroundColor' &&
            /\bcolors\.(\w+)\b/u.test(node.initializer.getText())
        ) {
            const role = /\bcolors\.(\w+)\b/u.exec(node.initializer.getText())?.[1];

            painted ||= role !== undefined && SURFACE_ROLES.has(role);
        }

        ts.forEachChild(node, walk);
    };

    walk(style);

    return painted;
}

/**
 * Whether a web `className` states a tone AND draws an offset focus ring on the same element. The ring's gap is read from
 * `--cm-surface`, and an element that states a tone sets its OWN `--cm-surface`, so the gap would be the card's fill and
 * not what the card sits on. The ring belongs on an element outside the one that states the tone.
 */
function statesToneAndRing(opening: ts.JsxOpeningLikeElement, constants: ReadonlyMap<string, ts.Expression>): boolean {
    const className = attributeOf(opening, 'className');

    if (className === undefined) {
        return false;
    }

    const { sources } = classListOf(className, constants);

    return (
        sources.some((source) => /surfaceToneClass|SURFACE_TONE_CLASS/u.test(source)) &&
        sources.some((source) => /FOCUS_RING_CLASS\.(?:offset|within)\b/u.test(source))
    );
}

/** Whether any JSX element under `element` (not counting its own attributes) carries a control attribute. */
function holdsControl(element: ts.JsxElement): boolean {
    let held = false;

    const walk = (node: ts.Node): void => {
        if (ts.isJsxAttribute(node) && CONTROL_ATTRIBUTES.has(node.name.getText())) {
            held = true;
        }

        ts.forEachChild(node, walk);
    };

    element.children.forEach(walk);

    return held;
}

/**
 * The 1-based line and the surface of every container that paints a surface, holds a control and states nothing. Pure.
 *
 * @param fileName - The module's name.
 * @param source - Its text.
 */
export function unstatedSurfaces(
    fileName: string,
    source: string,
): readonly { readonly line: number; readonly found: string }[] {
    const file = parseModule(fileName, source);
    const constants = constantsOf(file);
    const found: { line: number; found: string }[] = [];

    const visit = (node: ts.Node): void => {
        if (
            (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) &&
            statesToneAndRing(ts.isJsxElement(node) ? node.openingElement : node, constants)
        ) {
            const opening = ts.isJsxElement(node) ? node.openingElement : node;

            found.push({
                line: file.getLineAndCharacterOfPosition(opening.getStart(file)).line + 1,
                found: `${opening.tagName.getText()} (states a tone and rings its own focus)`,
            });
        }

        if (ts.isJsxElement(node)) {
            const opening = node.openingElement;
            const web = paintsWebSurface(opening, constants);
            const native = paintsNativeSurface(opening);

            if ((web || native) && holdsControl(node)) {
                found.push({
                    line: file.getLineAndCharacterOfPosition(opening.getStart(file)).line + 1,
                    found: opening.tagName.getText(),
                });
            }
        }

        ts.forEachChild(node, visit);
    };

    visit(file);

    return found;
}

describe('the unstated surface reader', () => {
    const cases: readonly { readonly shape: string; readonly source: string; readonly found: readonly string[] }[] = [
        {
            shape: 'a paper card holding a button',
            source: `const a = <div className="rounded-lg bg-paper p-4"><button onClick={go}>Go</button></div>;`,
            found: ['div'],
        },
        {
            shape: 'a muted row holding a link',
            source: `const a = <section className="bg-surface-muted"><a href="/x">x</a></section>;`,
            found: ['section'],
        },
        {
            shape: 'a template className with a bare token',
            source: 'const a = <div className={`p-4 bg-paper-overlay ${x}`}><Button onPress={go}>Go</Button></div>;',
            found: ['div'],
        },
        {
            shape: 'a native card painting colors.paper around a pressable',
            source: `const a = <View style={[styles.card, { backgroundColor: colors.paper }]}><Pressable onPress={go} /></View>;`,
            found: ['View'],
        },
        {
            shape: 'a native card painting theme.colors.surfaceMuted around a pressable',
            source: `const a = <View style={{ backgroundColor: theme.colors.surfaceMuted }}><Pressable onPress={set} /></View>;`,
            found: ['View'],
        },
        {
            shape: 'a controls-holding container nested in a painted one',
            source: `const a = <div className="bg-paper"><p>text</p><div><button onClick={go}>Go</button></div></div>;`,
            found: ['div'],
        },
        {
            shape: 'a className held in a same-file constant',
            source: `const CARD = 'rounded-lg bg-paper p-4';\nconst a = <div className={CARD}><button onClick={go}>Go</button></div>;`,
            found: ['div'],
        },
        {
            shape: 'a className built from a same-file constant in a template',
            source: 'const BASE = \'p-4 bg-surface-muted\';\nconst a = <section className={`flex ${BASE}`}><a href="/x">x</a></section>;',
            found: ['section'],
        },
        {
            shape: 'a className built from a constant through another constant',
            source: `const INNER = 'bg-paper-overlay';\nconst OUTER = \`p-2 \${INNER}\`;\nconst a = <div className={OUTER}><button onClick={go}>Go</button></div>;`,
            found: ['div'],
        },
        {
            shape: 'a className constant that states its tone with the recipe',
            source: "const CARD = `rounded-lg ${surfaceToneClass('paper')} p-4`;\nconst a = <div className={CARD}><button onClick={go}>Go</button></div>;",
            found: [],
        },
        {
            shape: 'a className constant that paints nothing',
            source: `const ROW = 'flex gap-2';\nconst a = <div className={ROW}><button onClick={go}>Go</button></div>;`,
            found: [],
        },
        {
            shape: 'an element that states a tone and draws its own offset focus ring',
            source: "const a = <div className={`${surfaceToneClass('paper')} ${FOCUS_RING_CLASS.within}`}>text</div>;",
            found: ['div (states a tone and rings its own focus)'],
        },
        {
            shape: 'a tone and a ring held in constants on one element',
            source: "const T = surfaceToneClass('muted');\nconst R = FOCUS_RING_CLASS.offset;\nconst a = <button className={`${T} ${R}`}>x</button>;",
            found: ['button (states a tone and rings its own focus)'],
        },
        {
            shape: 'a tone on the parent and the ring on the child',
            source: 'const a = <div className={surfaceToneClass(\'paper\')}><a href="/x" className={FOCUS_RING_CLASS.offset}>x</a></div>;',
            found: [],
        },
        {
            shape: 'a paper card that states its tone with the recipe',
            source: "const a = <div className={`p-4 ${surfaceToneClass('paper')}`}><button onClick={go}>Go</button></div>;",
            found: [],
        },
        {
            shape: 'a Surface',
            source: `const a = <Surface tone="paper"><button onClick={go}>Go</button></Surface>;`,
            found: [],
        },
        {
            shape: 'a paper card holding only a native input (no recipe-wearing control)',
            source: `const a = <label className="bg-paper"><input type="radio" onChange={pick} /></label>;`,
            found: [],
        },
        {
            shape: 'a paper card holding only text',
            source: `const a = <div className="bg-paper"><p>just words</p></div>;`,
            found: [],
        },
        {
            shape: 'a press fill behind a variant',
            source: `const a = <div className="hover:bg-surface-muted"><button onClick={go}>Go</button></div>;`,
            found: [],
        },
        {
            shape: 'a painted element that is itself the control',
            source: `const a = <button className="bg-paper" onClick={go}>Go</button>;`,
            found: [],
        },
        {
            shape: 'a native card painting the canvas, which is the default',
            source: `const a = <View style={{ backgroundColor: colors.canvas }}><Pressable onPress={go} /></View>;`,
            found: [],
        },
        {
            shape: 'a surface named in a comment',
            source: `// <div className="bg-paper"><button onClick={go} /></div>\nconst a = 1;`,
            found: [],
        },
    ];

    for (const { shape, source, found } of cases) {
        it(`reads ${shape}`, () => {
            expect(unstatedSurfaces('fixture.tsx', source).map((hit) => hit.found)).toEqual(found);
        });
    }
});

describe('apps state every surface that holds a control', () => {
    const modules = appSourceModules().filter((file) => !file.startsWith(EXEMPT_DIRECTORY));

    it('reads the design system, the features and both apps (a vacuous pass would hide the rule)', () => {
        expect(modules).toContain('packages/apps/commise/ui/src/refreshNotice/RefreshNotice.tsx');
        expect(modules).toContain('packages/apps/commise/ui/src/refreshNotice/RefreshNotice.native.tsx');
        expect(modules).toContain('packages/apps/commise/features/recipes/src/editor/ResumeNotice.tsx');
        expect(modules).toContain('packages/apps/commise/features/recipes/src/editor/ResumeNotice.native.tsx');
        expect(modules).not.toContain(`${EXEMPT_DIRECTORY}surfaceToneClass.ts`);
    });

    it('lets no container paint paper, a sheet or a muted fill around a control without stating it', () => {
        const offenders = modules.flatMap((file) =>
            unstatedSurfaces(file, readFileSync(path.join(repoRoot, file), 'utf8')).map(
                (hit) => `${file}:${String(hit.line)}  <${hit.found}>`,
            ),
        );

        expect(offenders).toEqual([]);
    });
});
