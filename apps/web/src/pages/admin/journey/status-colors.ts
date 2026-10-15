import type { StatusColor } from '../../../types/domain';

/**
 * Swatch fills for the `statuses.color` palette tokens (ADR-0026).
 *
 * Tokens, not hex: the API stores one of `STATUS_COLORS`, so this is purely
 * presentation. Tailwind's default palette is available alongside the theme's
 * own tokens (theme.css never resets `--color-*`), and every class is written
 * out in full so Tailwind's scanner finds it. A `Record` keyed on the token
 * type means a token added to `STATUS_COLORS` fails the type-check here
 * instead of rendering an empty swatch.
 */
export const STATUS_SWATCH_CLASS: Record<StatusColor, string> = {
  gray: 'bg-gray-400',
  blue: 'bg-blue-500',
  teal: 'bg-teal-500',
  green: 'bg-green-600',
  lime: 'bg-lime-500',
  amber: 'bg-amber-400',
  orange: 'bg-orange-500',
  red: 'bg-red-500',
  pink: 'bg-pink-500',
  purple: 'bg-purple-500',
  indigo: 'bg-indigo-500',
};

/** "amber" → "Amber", for swatch labels. */
export function colorLabel(color: StatusColor): string {
  return color.charAt(0).toUpperCase() + color.slice(1);
}
