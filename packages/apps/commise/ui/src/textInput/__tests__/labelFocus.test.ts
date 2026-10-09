import { describe, expect, it, vi } from 'vitest';

import { focusLabelledField, registerLabelledField } from '../labelFocus.native.js';

/**
 * The label registry (`labelFocus.native.ts`): a pressed native `FieldLabel` focuses the field mounted under the id it
 * names, and a field's late cleanup never removes the field that replaced it under the same id.
 */
describe('labelFocus (native)', () => {
    it('focuses the field registered under the id, and nothing else', () => {
        const name = { focus: vi.fn() };
        const other = { focus: vi.fn() };
        const offName = registerLabelledField('name', name);
        const offOther = registerLabelledField('other', other);

        focusLabelledField('name');

        expect(name.focus).toHaveBeenCalledTimes(1);
        expect(other.focus).not.toHaveBeenCalled();
        offName();
        offOther();
    });

    it('does nothing for an id with no mounted field', () => {
        const gone = { focus: vi.fn() };
        registerLabelledField('gone', gone)();

        expect(() => focusLabelledField('gone')).not.toThrow();
        expect(gone.focus).not.toHaveBeenCalled();
    });

    it("keeps a remounted field when its predecessor's cleanup runs late", () => {
        const before = { focus: vi.fn() };
        const after = { focus: vi.fn() };
        const offBefore = registerLabelledField('field', before);
        const offAfter = registerLabelledField('field', after);

        offBefore();
        focusLabelledField('field');

        expect(after.focus).toHaveBeenCalledTimes(1);
        expect(before.focus).not.toHaveBeenCalled();
        offAfter();
    });
});
