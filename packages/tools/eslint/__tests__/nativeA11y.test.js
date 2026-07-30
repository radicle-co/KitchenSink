/**
 * `RuleTester` coverage for {@link accessibilityStateNeedsAriaSibling} — the guard against the systemic
 * react-native-web defect described in that rule's own JSDoc (#123): `accessibilityState` reaches the device but
 * is projected to NO DOM attribute, so every key of it is silent on the web build unless an `aria-*` sibling (or,
 * for `disabled`, the `disabled` prop) is carried alongside.
 *
 * The suite is organised around the two things that make this rule easy to get wrong:
 *
 *  1. **The sibling is per-KEY, and for `selected`/`disabled` there is more than one legitimate answer.**
 *     `selected` is satisfied by `aria-selected` (option/tab/row/gridcell-family roles) OR `aria-pressed` (a
 *     `role="button"` toggle); `disabled` is satisfied by `aria-disabled` OR the plain `disabled` prop, which
 *     react-native-web already derives `aria-disabled` from. Every branch is covered, and a WRONG sibling
 *     (`selected` + `aria-checked`) is asserted to still fail — otherwise "has some aria prop" would pass.
 *  2. **It must stay quiet on shapes it cannot statically read** rather than guess. Non-literal values,
 *     conditionals, computed keys, object spreads and a `{...props}` spread on the element itself are all
 *     asserted VALID, and the crash-resistance cases (destructuring/spread shapes that crash the equivalent
 *     upstream rule — FormidableLabs/eslint-plugin-react-native-a11y issues #146 and #169) are pinned here.
 */
import { describe, it } from 'vitest';
import { RuleTester } from 'eslint';
import tseslint from 'typescript-eslint';

import { accessibilityStateNeedsAriaSibling } from '../nativeA11y.js';

// ESLint's `RuleTester` drives itself through `describe`/`it`, which vitest provides as imports rather than as
// globals in this package — hand them over explicitly so each case reports as its own test.
RuleTester.describe = describe;
RuleTester.it = it;

/**
 * The accepted-sibling wording, spelled out independently of the rule so the message a developer actually reads
 * is pinned here rather than derived from the implementation. `RuleTester` requires every placeholder in a
 * `messageId`'s template to be supplied, so cases that care only about WHICH key was reported route through
 * {@link missing} while the five per-key cases below spell the pairing out in full.
 */
const EXPECTED = {
    checked: '`aria-checked`',
    selected:
        '`aria-selected` (on an option/tab/row/gridcell-family role) or `aria-pressed` (on a `role="button"` toggle)',
    expanded: '`aria-expanded`',
    busy: '`aria-busy`',
    disabled: '`aria-disabled` or the `disabled` prop',
};

/**
 * One expected report for `key`.
 *
 * @param {keyof typeof EXPECTED} key
 * @returns {{ messageId: string, data: { key: string, expected: string } }}
 */
const missing = (key) => ({ messageId: 'missingSibling', data: { key, expected: EXPECTED[key] } });

const ruleTester = new RuleTester({
    languageOptions: {
        parser: tseslint.parser,
        parserOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            ecmaFeatures: { jsx: true },
        },
    },
});

ruleTester.run('accessibility-state-needs-aria-sibling', accessibilityStateNeedsAriaSibling, {
    valid: [
        // ── one satisfied sibling per key ────────────────────────────────────────────────────────────────
        { code: '<Pressable accessibilityState={{ checked: isChecked }} aria-checked={isChecked} />' },
        { code: '<Pressable accessibilityState={{ expanded: open }} aria-expanded={open} />' },
        { code: '<Pressable accessibilityState={{ busy: saving }} aria-busy={saving} />' },
        // The `|| undefined` shape this repo uses for `busy` still counts: the attribute is present.
        { code: '<Pressable accessibilityState={{ busy: saving }} aria-busy={saving || undefined} />' },

        // ── `selected` — BOTH legitimate answers ─────────────────────────────────────────────────────────
        // `aria-selected` for the option/tab/row/gridcell family.
        { code: '<Pressable accessibilityRole="tab" accessibilityState={{ selected: on }} aria-selected={on} />' },
        // `aria-pressed` for a `role="button"` toggle — ARIA does not define `aria-selected` there.
        { code: '<Pressable accessibilityRole="button" accessibilityState={{ selected: on }} aria-pressed={on} />' },

        // ── `disabled` — BOTH legitimate answers ─────────────────────────────────────────────────────────
        // react-native-web derives `aria-disabled` from the `disabled` PROP, so this needs nothing extra.
        { code: '<Pressable accessibilityState={{ disabled: busy }} disabled={busy} />' },
        // A bare `disabled` (implicit `true`) counts too.
        { code: '<Pressable accessibilityState={{ disabled: true }} disabled />' },
        // The explicit attribute is equally acceptable.
        { code: '<Pressable accessibilityState={{ disabled: busy }} aria-disabled={busy} />' },

        // ── several keys, all satisfied ──────────────────────────────────────────────────────────────────
        {
            code: '<Pressable accessibilityState={{ disabled: busy, busy }} aria-busy={busy || undefined} disabled={busy} />',
        },
        {
            code: '<Pressable accessibilityState={{ checked: c, disabled: d }} aria-checked={c} aria-disabled={d} />',
        },

        // ── shorthand properties resolve to their key name ───────────────────────────────────────────────
        { code: '<Pressable accessibilityState={{ checked }} aria-checked={checked} />' },

        // ── nothing to say ───────────────────────────────────────────────────────────────────────────────
        { code: '<Pressable accessibilityRole="button" accessibilityLabel="Save" />' },
        { code: '<View />' },

        // ── keys this rule does not own ──────────────────────────────────────────────────────────────────
        // Validating the KEY SET is a different concern (upstream's `has-valid-accessibility-state`); an
        // unknown key has no ARIA sibling to demand, so it is silently ignored rather than double-reported.
        { code: '<Pressable accessibilityState={{ somethingElse: true }} />' },
        { code: '<Pressable accessibilityState={{ mixed: true, checked: c }} aria-checked={c} />' },

        // ── QUIET over WRONG: shapes that cannot be read statically ──────────────────────────────────────
        // A value that is not an object literal — the keys are unknowable.
        { code: '<Pressable accessibilityState={state} />' },
        { code: '<Pressable accessibilityState={buildState(props)} />' },
        // A conditional: the object may not be applied at all, so which keys are live is unknowable.
        { code: '<Pressable accessibilityState={inert ? { disabled: true } : undefined} />' },
        { code: '<Pressable accessibilityState={a ? { checked: 1 } : { busy: 1 }} />' },
        // A malformed value — upstream's shape rule reports these; demanding a sibling would be noise.
        { code: '<Pressable accessibilityState="disabled" />' },
        { code: '<Pressable accessibilityState={["disabled"]} />' },
        { code: '<Pressable accessibilityState={null} />' },
        { code: '<Pressable accessibilityState />' },
        // A COMPUTED key: the name is unknowable.
        { code: '<Pressable accessibilityState={{ [key]: true }} />' },
        { code: '<Pressable accessibilityState={{ [`che` + `cked`]: true }} />' },
        // An object SPREAD contributes unknown keys — those are ignored (crash-resistance: the equivalent
        // upstream rule throws on these shapes, issues #146 and #169).
        { code: '<Pressable accessibilityState={{ ...state }} />' },
        { code: '<Pressable accessibilityState={{ ...state, ...other }} />' },
        { code: '<Pressable accessibilityState={{ ...rest, checked: c }} aria-checked={c} />' },
        // A `{...props}` spread on the ELEMENT could be carrying the sibling, so the whole element is skipped.
        { code: '<Pressable {...props} accessibilityState={{ checked: c }} />' },
        { code: '<Pressable accessibilityState={{ selected: s }} {...rest} />' },
        // Namespaced / member-expression JSX names must not throw.
        { code: '<Wizard.Trigger accessibilityState={{ expanded: open }} aria-expanded={open} />' },
    ],

    invalid: [
        // ── one missing sibling per key ──────────────────────────────────────────────────────────────────
        {
            code: '<Pressable accessibilityRole="checkbox" accessibilityState={{ checked: isChecked }} />',
            errors: [{ messageId: 'missingSibling', data: { key: 'checked', expected: '`aria-checked`' } }],
        },
        {
            code: '<Pressable accessibilityState={{ expanded: open }} />',
            errors: [{ messageId: 'missingSibling', data: { key: 'expanded', expected: '`aria-expanded`' } }],
        },
        {
            code: '<Pressable accessibilityState={{ busy: saving }} disabled={saving} />',
            errors: [{ messageId: 'missingSibling', data: { key: 'busy', expected: '`aria-busy`' } }],
        },
        {
            code: '<Pressable accessibilityState={{ selected: on }} />',
            errors: [
                {
                    messageId: 'missingSibling',
                    data: {
                        key: 'selected',
                        expected:
                            '`aria-selected` (on an option/tab/row/gridcell-family role) or `aria-pressed` (on a `role="button"` toggle)',
                    },
                },
            ],
        },
        {
            code: '<Pressable accessibilityState={{ disabled: true }} />',
            errors: [
                {
                    messageId: 'missingSibling',
                    data: { key: 'disabled', expected: '`aria-disabled` or the `disabled` prop' },
                },
            ],
        },

        // ── the WRONG sibling does not satisfy the key ───────────────────────────────────────────────────
        // Mutation guard: "the element has some aria-* prop" must NOT be what makes a case pass.
        {
            code: '<Pressable accessibilityState={{ selected: on }} aria-checked={on} />',
            errors: [missing('selected')],
        },
        {
            code: '<Pressable accessibilityState={{ checked: c }} aria-pressed={c} />',
            errors: [missing('checked')],
        },
        {
            code: '<Pressable accessibilityState={{ busy: b }} aria-expanded={b} />',
            errors: [missing('busy')],
        },
        // `aria-pressed` is NOT `aria-disabled`, and the `disabled` prop is the only other way in.
        {
            code: '<Pressable accessibilityState={{ disabled: d }} aria-pressed={d} />',
            errors: [missing('disabled')],
        },

        // ── one report PER missing key, and satisfied keys stay quiet ────────────────────────────────────
        {
            code: '<Pressable accessibilityState={{ checked: c, expanded: e }} />',
            errors: [missing('checked'), missing('expanded')],
        },
        {
            // The `disabled` half is satisfied by the prop; only `busy` is missing. This is the exact shape of
            // five real sites the #123 sweep repaired.
            code: '<Pressable accessibilityState={{ busy: isBusy, disabled: isBusy }} disabled={isBusy} />',
            errors: [missing('busy')],
        },

        // ── shorthand ────────────────────────────────────────────────────────────────────────────────────
        {
            code: '<Pressable accessibilityState={{ checked }} />',
            errors: [missing('checked')],
        },

        // ── an object spread does not excuse the keys written explicitly beside it ───────────────────────
        {
            code: '<Pressable accessibilityState={{ ...rest, checked: c }} />',
            errors: [missing('checked')],
        },

        // ── the real regression: the Wizard overflow trigger, as it stood before the sweep ───────────────
        {
            code: '<Pressable accessibilityRole="button" accessibilityLabel={m.actionsMenu} accessibilityState={{ expanded: open }} onPress={onPress} style={styles.menuTrigger} />',
            errors: [missing('expanded')],
        },
    ],
});
