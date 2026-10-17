/**
 * The detector the design-system adapter guards share (`reactNativeValueUses.ts`), over shapes the tree has never held:
 * a guard that passes because its detector cannot see a shape proves nothing.
 */
import { describe, expect, it } from 'vitest';

import { reactNativeValueUses } from './reactNativeValueUses.js';

describe('reactNativeValueUses', () => {
    it.each([
        ['a named value import', "import { Modal } from 'react-native';", 'Modal', 1],
        ['a renamed value import', "import { View, Modal as NativeModal } from 'react-native';", 'Modal', 1],
        ['a namespace member', "import * as RN from 'react-native';\nconst x = <RN.Modal visible />;", 'Modal', 1],
        ['an inline type-only specifier', "import { type Modal } from 'react-native';", 'Modal', 0],
        ['a type-only import', "import type { Modal, ModalProps } from 'react-native';", 'Modal', 0],
        ['the adapter', "import { Modal } from '@commise/ui/modal';", 'Modal', 0],
        ['another React Native import', "import { View, Text } from 'react-native';", 'Modal', 0],
        ['a namespace that never reads it', "import * as RN from 'react-native';\nconst x = <RN.View />;", 'Modal', 0],
        ['an import named like it from elsewhere', "import { Modal } from 'some-library';", 'Modal', 0],
        ['a TextInput value import', "import { Text, TextInput } from 'react-native';", 'TextInput', 1],
        ['a TextInput type import for a ref', "import { type TextInput } from 'react-native';", 'TextInput', 0],
        [
            'a TextInput namespace member',
            "import * as RN from 'react-native';\nconst x = <RN.TextInput />;",
            'TextInput',
            1,
        ],
        ['Text, which only shares a prefix', "import { Text } from 'react-native';", 'TextInput', 0],
        ['the text-input adapter', "import { TextInput } from '@commise/ui/text-input';", 'TextInput', 0],
    ])('%s counts %i', (_, source, exportName, count) => {
        expect(reactNativeValueUses(source, 'probe.tsx', exportName)).toHaveLength(count);
    });
});
