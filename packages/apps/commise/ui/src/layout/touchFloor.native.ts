/**
 * @module @commise/ui/layout — the native touch floor, once: the smallest tap target a control may have (§1.6).
 */
import { Platform } from 'react-native';

/**
 * The touch floor: 44 pt on iOS (Apple HIG), 48 dp on Android (Material) — "every 44 is 48 dp there". A control drawn
 * smaller carries the floor on a transparent hit frame around it.
 *
 * @returns The side of the smallest tap target, in points.
 * @sideEffect Reads the platform.
 */
export const touchFloor = (): number => (Platform.OS === 'android' ? 48 : 44);
