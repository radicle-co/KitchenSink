/**
 * The emulators the Android lanes boot, by lane, and the console port a serial names. One module so the adapter, the hosts and
 * the usage watcher read the same table.
 */

/** The lanes' emulators, by lane. Never `emulator-5554`: that one is the owner's. */
export const ANDROID_LANE_SERIALS = [
    'emulator-5556',
    'emulator-5558',
    'emulator-5560',
    'emulator-5562',
    'emulator-5564',
    'emulator-5566',
    'emulator-5568',
    'emulator-5570',
] as const;

/**
 * The emulator console port a serial names.
 *
 * @param serial - Such as `emulator-5556`.
 * @returns Such as `5556`.
 */
export const consolePort = (serial: string): string => serial.replace(/^emulator-/u, '');
