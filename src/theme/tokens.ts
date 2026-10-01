export const theme = {
  colors: {
    orange: '#FC4C02',
    orangeDark: '#D43D02',
    ink: '#12151A',
    inkSoft: '#4A5157',
    muted: '#8A9299',
    line: '#E4E7EA',
    surface: '#FFFFFF',
    surfaceAlt: '#F5F7F8',
    success: '#1BB55C',
    danger: '#DC2F2F',
    white: '#FFFFFF',
    overlay: 'rgba(10, 12, 15, 0.82)',
  },
  sport: {
    run: '#FC4C02',
    ride: '#1B7FFF',
    hike: '#8B5E34',
    walk: '#5B8C42',
  },
  space: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 },
  radius: { sm: 6, md: 10, lg: 16, pill: 999 },
} as const;

export type Theme = typeof theme;
export type SportType = keyof typeof theme.sport;
