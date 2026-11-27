/** With no navigator above, a screen's foot report goes nowhere and does not throw. */
import { renderHook } from '@testing-library/react';
import { useContext } from 'react';
import { describe, expect, it } from 'vitest';

import { ReportPageFootContext } from '../reportPageFootContext.js';

describe('ReportPageFootContext', () => {
    it('defaults to a reporter that accepts a height without throwing', () => {
        const { result } = renderHook(() => useContext(ReportPageFootContext));

        expect(() => {
            result.current(90);
        }).not.toThrow();
    });
});
