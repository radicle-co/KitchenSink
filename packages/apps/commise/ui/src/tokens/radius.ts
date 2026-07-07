export const radius = {
    sm: '0.375rem',
    md: '0.75rem',
    lg: '1.25rem',
    xl: '1.75rem',
    full: '9999px',
} as const;

export type Radius = typeof radius;
