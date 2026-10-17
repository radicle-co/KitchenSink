/**
 * The body face reaches a rendered native Text (`docs/design/uiOverhaul/buildSpec.md` §1.5; blueprint slice 1 step 7).
 *
 * A `Text` styled with the `body` type role must render in Inter's REGISTERED regular face and carry no `fontWeight`:
 * React Native resolves `fontFamily` to one registered face, and a weight beside it is what lets Android substitute a
 * synthesised or system bold. The registration half (that `App.tsx` actually loads the face) is
 * `tests/theme/fonts.test.ts`; this is the render half, under react-native-web.
 *
 * Mutation lens: point the body role at a CSS stack, at another weight's face, or add a `fontWeight`, and a row fails.
 */
import { nativeTokens } from '@commise/ui/native';
import { cleanup, render, screen } from '@testing-library/react';
import { Text } from 'react-native';
import { afterEach, describe, expect, it } from 'vitest';

afterEach(cleanup);

describe('the body type role on a native Text', () => {
    it('renders in Inter_400Regular', () => {
        render(<Text style={nativeTokens.type.body}>Two cups of flour</Text>);

        const style = getComputedStyle(screen.getByText('Two cups of flour'));

        expect(style.fontFamily).toBe('Inter_400Regular');
        expect(style.fontSize).toBe('16px');
        expect(style.lineHeight).toBe('24px');
    });

    it('sets no font weight beside the face', () => {
        expect(nativeTokens.type.body).not.toHaveProperty('fontWeight');
    });

    it('renders a card title in the semibold face, not a weight on the regular one', () => {
        render(<Text style={nativeTokens.type.cardTitle}>Weeknight pasta</Text>);

        expect(getComputedStyle(screen.getByText('Weeknight pasta')).fontFamily).toBe('Inter_600SemiBold');
    });
});
