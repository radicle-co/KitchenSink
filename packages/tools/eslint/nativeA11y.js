/**
 * @module @kitchensink/eslint/nativeA11y — custom lint rules for the React Native / react-native-web
 * accessibility-parity invariants this repo enforces but no published plugin covers.
 *
 * **Why this is hand-rolled (library-first was checked first, per CLAUDE.md).** The obvious candidate,
 * `eslint-plugin-react-native-a11y`, does NOT cover this and its maintainers declined to: issue #152 ("Support
 * for web-inspired a11y props") was closed `not_planned` in June 2024, its whole `lib/` contains zero references
 * to `aria-`, and its one `accessibilityState` rule (`has-valid-accessibility-state`) validates only the SHAPE
 * (that keys are in the known set and values are boolean/`'mixed'`) — `accessibilityState={{ checked: true }}`
 * with no sibling is listed under "Succeed" in its own docs. It is also unusable here regardless: it peer-caps at
 * `eslint: ^8`, ships CommonJS with no flat-config export, and is ~21 months without a commit. Nothing else in
 * the ecosystem covers it either — `eslint-plugin-jsx-a11y` keys off DOM elements and ARIA roles and never sees
 * an RN prop; `eslint-plugin-react-native`, `@react-native/eslint-plugin` and `eslint-plugin-expo` ship no
 * accessibility rules at all; react-native-web publishes no plugin. So there is nothing to configure, and this is
 * ~80 lines we own.
 */

/**
 * The `accessibilityState` keys React Native defines, mapped to the props that make each one observable on the
 * react-native-web build. `undefined` entries are impossible by construction — every key has at least one.
 *
 * The pairings are per-key AND, for two of them, role-dependent, which is the whole subtlety:
 *
 *  - `checked` → `aria-checked` (valid on `checkbox`/`radio`/`menuitemcheckbox`).
 *  - `selected` → `aria-selected` ONLY on `option`/`tab`/`row`/`gridcell`-family roles; on a `role="button"`
 *    toggle the correct attribute is `aria-pressed`. Both are accepted because the rule does not know the role's
 *    ARIA family (`accessibilityRole` may be computed), and accepting the union is far better than demanding the
 *    wrong one.
 *  - `expanded` → `aria-expanded`.
 *  - `busy` → `aria-busy`.
 *  - `disabled` → `aria-disabled`, OR the plain `disabled` prop, which react-native-web already derives
 *    `aria-disabled` from (`createDOMProps`: `disabled = ariaDisabled || accessibilityDisabled`). A site passing
 *    `disabled` therefore needs nothing extra.
 */
const SIBLINGS_BY_KEY = {
    checked: ['aria-checked'],
    selected: ['aria-selected', 'aria-pressed'],
    expanded: ['aria-expanded'],
    busy: ['aria-busy'],
    disabled: ['aria-disabled', 'disabled'],
};

/** Human-readable rendering of the accepted siblings, for the report message. */
const EXPECTED_BY_KEY = {
    checked: '`aria-checked`',
    selected:
        '`aria-selected` (on an option/tab/row/gridcell-family role) or `aria-pressed` (on a `role="button"` toggle)',
    expanded: '`aria-expanded`',
    busy: '`aria-busy`',
    disabled: '`aria-disabled` or the `disabled` prop',
};

/**
 * Reads the statically-known name of a JSX attribute, or `undefined` for a namespaced name
 * (`<a xlink:href>`) which cannot collide with any prop this rule cares about.
 *
 * @param {import('estree-jsx').JSXAttribute} attribute
 * @returns {string | undefined}
 */
function attributeName(attribute) {
    return attribute.name.type === 'JSXIdentifier' ? attribute.name.name : undefined;
}

/**
 * Reads the statically-known key name of an object property, or `undefined` when it cannot be read: a computed
 * key (`{ [k]: true }`), or a spread (`{ ...state }`). Both are deliberately unknowable rather than guessed.
 *
 * @param {import('estree').Property | import('estree').SpreadElement} property
 * @returns {string | undefined}
 */
function propertyKeyName(property) {
    if (property.type !== 'Property' || property.computed) {
        return undefined;
    }

    if (property.key.type === 'Identifier') {
        return property.key.name;
    }

    return property.key.type === 'Literal' && typeof property.key.value === 'string' ? property.key.value : undefined;
}

/**
 * Flags a JSX element that passes an `accessibilityState` key with no prop that projects it to the DOM.
 *
 * **The defect.** On react-native-web, `accessibilityState` reaches NO DOM attribute. Verified against the
 * installed 0.20.0: `modules/forwardedProps/index.js` allowlists every literal `aria-*` prop but has no entry
 * for `accessibilityState`, and its only consumer anywhere in `dist/` is `AccessibilityUtil/isDisabled`, which
 * reads `props.disabled` and the LEGACY `accessibilityStates` ARRAY — never the modern object. This is not a bug
 * awaiting a patch: RNW removed `accessibilityState` in 0.18 and deprecated the whole `accessibility*` family in
 * 0.19 in favour of `aria-*`/`role`, and it is still absent on master. So `accessibilityState={{ checked: true }}`
 * renders a control with no state attribute at all — announced on device, silent on the web build. This repo
 * enforces web/native accessibility parity, so every such site is a real defect.
 *
 * **The fix the rule asks for is ADDITIVE.** The `accessibilityState` object stays: React Native reverse-maps
 * `aria-checked`/`selected`/`busy`/`expanded`/`disabled` back into it (`Pressable.js`/`View.js`:
 * `checked: ariaChecked ?? accessibilityState?.checked`), so the dual form is correct on both platforms — and
 * `aria-pressed` is NOT reverse-mapped, so for a `role="button"` toggle the object form is load-bearing for the
 * device and must not be replaced.
 *
 * **Not auto-fixable, deliberately.** Two of the five keys have more than one legitimate answer and the choice is
 * not syntactically decidable: `selected` needs `aria-pressed` on a button but `aria-selected` on a tab, and for
 * `disabled` the two answers are not equivalent — on RNW the `disabled` prop also emits the native `disabled`
 * attribute and `tabIndex={-1}`, so "fixing" an `aria-disabled` site into a `disabled` one silently removes the
 * control from the tab order. A fixer would have to guess, and a wrong ARIA attribute is worse than a missing one.
 *
 * **Quiet over wrong.** The rule reports only what it can read statically, and bails without complaint on every
 * shape it cannot: a non-object value (`accessibilityState={state}`), a conditional
 * (`accessibilityState={inert ? { disabled: true } : undefined}` — the object may not apply at all), a computed
 * key, an object spread's unknown keys, and any element carrying a `{...props}` spread (which could be supplying
 * the sibling). It also ignores keys outside the known set — validating the key SET belongs to a different rule.
 * The cost of that stance is a documented blind spot: a conditional `accessibilityState` escapes the rule. It is
 * the right trade — a false positive here would be un-silenceable without the blanket disables this repo bans.
 *
 * @type {import('eslint').Rule.RuleModule}
 */
export const accessibilityStateNeedsAriaSibling = {
    meta: {
        type: 'problem',
        docs: {
            description:
                'Require the DOM-observable sibling prop for every `accessibilityState` key, since react-native-web projects `accessibilityState` to no attribute.',
        },
        schema: [],
        messages: {
            missingSibling:
                '`accessibilityState.{{key}}` is announced on device but reaches NO DOM attribute — react-native-web projects `accessibilityState` for nothing. Add {{expected}} alongside it, and KEEP the object form (React Native reverse-maps the ARIA prop back into `accessibilityState`).',
        },
    },

    create(context) {
        return {
            JSXOpeningElement(node) {
                const attributes = node.attributes;

                // A spread could be supplying the sibling from anywhere — say nothing rather than guess.
                if (attributes.some((attribute) => attribute.type === 'JSXSpreadAttribute')) {
                    return;
                }

                const state = attributes.find(
                    (attribute) =>
                        attribute.type === 'JSXAttribute' && attributeName(attribute) === 'accessibilityState',
                );

                if (state === undefined) {
                    return;
                }

                // Only an inline object literal exposes its keys. Anything else (a variable, a call, a
                // conditional, a malformed string/array) is unreadable here; upstream's shape rule owns the
                // malformed cases.
                const value = state.value;

                if (
                    value === null ||
                    value.type !== 'JSXExpressionContainer' ||
                    value.expression.type !== 'ObjectExpression'
                ) {
                    return;
                }

                const present = new Set(
                    attributes.flatMap((attribute) => {
                        const name = attribute.type === 'JSXAttribute' ? attributeName(attribute) : undefined;

                        return name === undefined ? [] : [name];
                    }),
                );

                for (const property of value.expression.properties) {
                    const key = propertyKeyName(property);
                    const siblings = key === undefined ? undefined : SIBLINGS_BY_KEY[key];

                    if (siblings === undefined || siblings.some((sibling) => present.has(sibling))) {
                        continue;
                    }

                    context.report({
                        node: property,
                        messageId: 'missingSibling',
                        data: { key, expected: EXPECTED_BY_KEY[key] },
                    });
                }
            },
        };
    },
};

/**
 * The flat-config plugin object carrying this package's custom native-accessibility rules.
 *
 * @type {import('eslint').ESLint.Plugin}
 */
export const nativeA11yPlugin = {
    rules: {
        'accessibility-state-needs-aria-sibling': accessibilityStateNeedsAriaSibling,
    },
};
