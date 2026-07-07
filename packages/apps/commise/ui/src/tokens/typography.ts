export const fonts = {
    display: '"Playfair Display", Georgia, serif',
    body: 'Inter, system-ui, sans-serif',
    mono: '"JetBrains Mono", monospace',
} as const;

export const fontSizes = {
    'display-xl': '3rem',
    'display-lg': '2.25rem',
    'display-md': '1.75rem',
    'heading-lg': '1.5rem',
    'heading-md': '1.25rem',
    'heading-sm': '1.125rem',
    'body-lg': '1.125rem',
    'body-md': '1rem',
    'body-sm': '0.875rem',
    caption: '0.75rem',
    overline: '0.6875rem',
} as const;

export const lineHeights = {
    heading: '1.2',
    body: '1.5',
    caption: '1.4',
} as const;

export const fontWeights = {
    normal: '400',
    medium: '500',
    semibold: '600',
    bold: '700',
} as const;

export type Fonts = typeof fonts;
export type FontSizes = typeof fontSizes;
export type LineHeights = typeof lineHeights;
export type FontWeights = typeof fontWeights;
