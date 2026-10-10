/**
 * @module @commise/test-utils/text-input-selection — React Native's `TextInput.setSelection` on react-native-web's DOM
 * input, for native suites that run under jsdom.
 *
 * The combobox calls `setSelection` when it takes a focus request (Change food, Find a food for this, and the trailing
 * add row after the last row is removed). react-native-web renders a DOM `<input>`, which has `setSelectionRange` and
 * no `setSelection`, so without this every such request throws. It is imported by each native setup file
 * (`mobile/tests/setup.native.ts`, `features/recipes/vitest.setup.native.ts`). `@commise/ui`'s combobox suite keeps its
 * own copy, because this package depends on `@commise/ui`.
 */

/**
 * Give `HTMLInputElement` a `setSelection` that moves the DOM selection, unless one already exists.
 *
 * @sideEffect Defines a method on `HTMLInputElement.prototype`.
 */
export function installTextInputSelection(): void {
    if ('setSelection' in HTMLInputElement.prototype) {
        return;
    }

    Object.defineProperty(HTMLInputElement.prototype, 'setSelection', {
        configurable: true,
        value(this: HTMLInputElement, start: number, end: number) {
            this.setSelectionRange(start, end);
        },
    });
}
