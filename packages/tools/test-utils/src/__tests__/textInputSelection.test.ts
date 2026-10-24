import { afterEach, describe, expect, it } from 'vitest';

import { installTextInputSelection } from '../textInputSelection.js';

interface NativeSelection {
    setSelection(start: number, end: number): void;
}

afterEach(() => {
    Reflect.deleteProperty(HTMLInputElement.prototype, 'setSelection');
});

describe('installTextInputSelection', () => {
    it('gives a DOM input the native TextInput selection method, which moves the DOM selection', () => {
        installTextInputSelection();
        const input = document.createElement('input');
        input.value = 'black pepper';

        (input as HTMLInputElement & NativeSelection).setSelection(6, 12);

        expect([input.selectionStart, input.selectionEnd]).toEqual([6, 12]);
    });

    it('leaves a selection method that already exists in place', () => {
        const existing = (): void => undefined;
        Object.defineProperty(HTMLInputElement.prototype, 'setSelection', { configurable: true, value: existing });

        installTextInputSelection();

        expect((HTMLInputElement.prototype as HTMLInputElement & NativeSelection).setSelection).toBe(existing);
    });
});
