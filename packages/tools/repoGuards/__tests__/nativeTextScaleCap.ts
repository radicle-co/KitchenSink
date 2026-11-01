/**
 * Every React Native text in a native source file that grows with the system's text size without limit (ADR-0080 §8:
 * the cap is 2×), read with the TypeScript parser. The detector behind `nativeTextScaleCapRatchet.test.ts`.
 *
 * A React Native `Text` (directly, through a namespace import, or as `Animated.Text`) or `TextInput`, or a Tamagui text
 * that is not the design system's (Tamagui's own `Text`, or a `styled()` over it), is capped only by
 * `maxFontSizeMultiplier={FONT_SCALE_CAP}`; a number, `allowFontScaling={false}` and a spread are not trusted. The
 * design system's `Text` (`@commise/ui/text`, or `text/Text.native` inside the design system), and a Tamagui `styled()`
 * over it, carries the cap itself and is not counted, unless it sets its own `maxFontSizeMultiplier` or
 * `allowFontScaling`, which overrides that cap; then it is held to the same rule as any other text.
 *
 * React Native passes text attributes down to nested text (`TextAttributes::apply`), so a text inside a capped text is
 * part of that run and is not counted on its own, unless it sets its own `maxFontSizeMultiplier` or `allowFontScaling`,
 * which overrides the inherited value. A text inside an uncapped text is counted once, at the outer text. Any other
 * element between them starts a new run.
 *
 * @pattern Specification — a pure predicate over a parsed source file
 */
import ts from 'typescript';

import { parseModule } from './appSources.js';
import { isReactNative, localsOf, valueBindingsOf } from './moduleBindings.js';
import { isTamaguiStyledCall, tamaguiElementKinds, tamaguiStyledNames, type StyledKindsOf } from './tamaguiElements.js';

/** Where the design system's cap is imported from: its package subpath, or its file inside the package. */
function isCapModule(specifier: string): boolean {
    return specifier === '@commise/ui/font-scale-cap' || /(?:^|\/)text\/fontScaleCap(?:\.js)?$/u.test(specifier);
}

/** Where the design system's capped `Text` is imported from: its package subpath, or its file inside the package. */
function isDesignTextModule(specifier: string): boolean {
    return specifier === '@commise/ui/text' || /(?:^|\/)text\/Text\.native(?:\.js)?$/u.test(specifier);
}

/**
 * The local names bound to the design system's `Text`, and every local Tamagui `styled()` over one, to any depth. A
 * `styled` that is not Tamagui's does not carry the cap, so it is not followed.
 */
function designTextsOf(file: ts.SourceFile): ReadonlySet<string> {
    const names = new Set(localsOf(valueBindingsOf(file, isDesignTextModule), 'Text'));
    const styledNames = tamaguiStyledNames(file);
    let grew = true;

    while (grew) {
        grew = false;
        file.forEachChild((statement) => {
            if (!ts.isVariableStatement(statement)) {
                return;
            }

            for (const declaration of statement.declarationList.declarations) {
                const init = declaration.initializer;

                if (
                    ts.isIdentifier(declaration.name) &&
                    !names.has(declaration.name.text) &&
                    init !== undefined &&
                    isTamaguiStyledCall(init, styledNames) &&
                    init.arguments[0] !== undefined &&
                    ts.isIdentifier(init.arguments[0]) &&
                    names.has(init.arguments[0].text)
                ) {
                    names.add(declaration.name.text);
                    grew = true;
                }
            }
        });
    }

    return names;
}

interface TextBindings {
    /** The local names of the design system's `FONT_SCALE_CAP`, by import: a local constant of that name is not it. */
    readonly caps: ReadonlySet<string>;
    readonly designTexts: ReadonlySet<string>;
    readonly texts: ReadonlySet<string>;
    readonly inputs: ReadonlySet<string>;
    readonly animated: ReadonlySet<string>;
    readonly namespaces: ReadonlySet<string>;
    readonly tamagui: ReadonlyMap<string, string>;
}

function isReactNativeText(tag: ts.JsxTagNameExpression, b: TextBindings): boolean {
    if (ts.isIdentifier(tag)) {
        return b.texts.has(tag.text) || b.inputs.has(tag.text);
    }

    if (!ts.isPropertyAccessExpression(tag) || !ts.isIdentifier(tag.expression)) {
        return false;
    }

    const owner = tag.expression.text;
    const member = tag.name.text;

    return (
        (b.namespaces.has(owner) && (member === 'Text' || member === 'TextInput')) ||
        (b.animated.has(owner) && member === 'Text')
    );
}

function isDesignText(tag: ts.JsxTagNameExpression, b: TextBindings): boolean {
    return ts.isIdentifier(tag) && b.designTexts.has(tag.text);
}

/** A text that grows with the system's text size unless it is capped: React Native's, or a Tamagui text not the design system's. */
function isScalingText(tag: ts.JsxTagNameExpression, b: TextBindings): boolean {
    return isReactNativeText(tag, b) || (b.tamagui.get(tag.getText()) === 'text' && !isDesignText(tag, b));
}

function attribute(attributes: ts.JsxAttributes, name: string): ts.JsxAttribute | undefined {
    return attributes.properties.find(
        (property): property is ts.JsxAttribute => ts.isJsxAttribute(property) && property.name.getText() === name,
    );
}

function capped(attributes: ts.JsxAttributes, caps: ReadonlySet<string>): boolean {
    const cap = attribute(attributes, 'maxFontSizeMultiplier')?.initializer;

    return (
        cap !== undefined &&
        ts.isJsxExpression(cap) &&
        cap.expression !== undefined &&
        ts.isIdentifier(cap.expression) &&
        caps.has(cap.expression.text)
    );
}

/** Whether a text sets its own scaling, which overrides what it would inherit. */
function setsOwnScaling(attributes: ts.JsxAttributes): boolean {
    return (
        attribute(attributes, 'maxFontSizeMultiplier') !== undefined ||
        attribute(attributes, 'allowFontScaling') !== undefined
    );
}

/** The opening element of a JSX element, or `undefined` for any other node. */
function openingOf(node: ts.Node): ts.JsxOpeningElement | ts.JsxSelfClosingElement | undefined {
    if (ts.isJsxElement(node)) {
        return node.openingElement;
    }

    return ts.isJsxSelfClosingElement(node) ? node : undefined;
}

/** Where a text sits: in no text, in a capped run, or in an uncapped run already counted at its root. */
type Run = 'none' | 'capped' | 'uncapped';

/**
 * The 1-based lines of every uncapped React Native text that is not inside another text. Pure.
 *
 * @param source - The module's source.
 * @param fileName - Its path, for the parser.
 * @param styledKindsOf - The kind of each name a design-system subpath exports as a Tamagui styled component.
 * @returns The lines, in source order.
 */
export function uncappedTexts(source: string, fileName: string, styledKindsOf: StyledKindsOf): readonly number[] {
    const file = parseModule(fileName, source);
    const rn = valueBindingsOf(file, isReactNative);
    const bindings: TextBindings = {
        caps: localsOf(valueBindingsOf(file, isCapModule), 'FONT_SCALE_CAP'),
        designTexts: designTextsOf(file),
        texts: localsOf(rn, 'Text'),
        inputs: localsOf(rn, 'TextInput'),
        animated: localsOf(rn, 'Animated'),
        namespaces: new Set(rn.namespaces),
        tamagui: tamaguiElementKinds(file, styledKindsOf),
    };
    const lines: number[] = [];

    const visit = (node: ts.Node, run: Run): void => {
        const opening = openingOf(node);

        if (opening === undefined) {
            ts.forEachChild(node, (child) => {
                visit(child, run);
            });

            return;
        }

        const tag = opening.tagName;
        let inner: Run = 'none';

        // The design system's Text carries the cap unless it sets its own scaling, which overrides it like any text's.
        if (isDesignText(tag, bindings) && !setsOwnScaling(opening.attributes)) {
            inner = 'capped';
        } else if (isDesignText(tag, bindings) || isScalingText(tag, bindings)) {
            const ownCap = capped(opening.attributes, bindings.caps);
            const inheritsCap = run === 'capped' && !setsOwnScaling(opening.attributes);
            const counted = run === 'uncapped' && !ownCap;

            if (!ownCap && !inheritsCap && !counted) {
                lines.push(file.getLineAndCharacterOfPosition(opening.getStart(file)).line + 1);
            }

            inner = ownCap || inheritsCap ? 'capped' : 'uncapped';
        }

        // An attribute's JSX is not inside this element's text run; only its children are.
        for (const property of opening.attributes.properties) {
            visit(property, 'none');
        }

        if (ts.isJsxElement(node)) {
            for (const child of node.children) {
                visit(child, inner);
            }
        }
    };

    visit(file, 'none');

    return lines;
}
