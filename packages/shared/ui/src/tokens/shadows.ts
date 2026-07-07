export const shadows = {
    sm: '0 1px 3px rgba(45,52,54,0.04)',
    md: '0 4px 6px -1px rgba(45,52,54,0.07)',
    lg: '0 10px 15px -3px rgba(45,52,54,0.08)',
    xl: '0 20px 25px -5px rgba(45,52,54,0.09)',
    glow: '0 0 32px rgba(61,139,133,0.25)',
} as const;

export type Shadows = typeof shadows;
