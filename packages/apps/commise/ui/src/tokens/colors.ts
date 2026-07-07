export const palette = {
    seafoam: '#3D8B85',
    'seafoam-light': '#5BA8A0',
    coral: '#E8917A',
    sky: '#8ECAE6',
    sand: '#FAF6F0',
    'ocean-dark': '#2A6B65',
    charcoal: '#2D3436',
    slate: '#636E72',
    mist: '#B2BEC3',
    pearl: '#F5F5F5',
    white: '#FFFFFF',
    success: '#4CAF7C',
    warning: '#F5B041',
    error: '#E17055',
    premium: '#D4A574',
} as const;

export const semantic = {
    background: palette.sand,
    foreground: palette.charcoal,
    card: palette.white,
    primary: palette['seafoam-light'],
    secondary: palette.coral,
    muted: palette.pearl,
    accent: palette.sky,
    destructive: palette.error,
    border: 'rgba(178, 190, 195, 0.3)',
    ring: palette['seafoam-light'],
} as const;

export const chart = {
    calories: palette['seafoam-light'],
    protein: palette['seafoam-light'],
    carbs: palette.sky,
    fat: palette.coral,
    fiber: palette.success,
} as const;

export type Palette = typeof palette;
export type Semantic = typeof semantic;
export type Chart = typeof chart;
