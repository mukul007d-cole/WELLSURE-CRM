import type { FieldConfig } from './config.js';

/**
 * Turning export text into the typed values Falcon stores. Every function is
 * pure and returns either a value or a reason it could not, so the report can
 * name exactly what was dropped and why.
 */

export type Normalized = { ok: true; value: unknown } | { ok: false; reason: string };

/** Strips quotes, spaces and punctuation a spreadsheet adds to a number. */
export function normalizePhone(raw: string | undefined): string | null {
  if (raw === undefined) return null;
  const digits = raw.replace(/[^\d+]/g, '');
  return digits.replace(/\D/g, '') === '' ? null : digits;
}

/** The comparable form of a phone: its last ten digits. */
export function phoneKey(phone: string | null): string | null {
  if (phone === null) return null;
  const digits = phone.replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : null;
}

export function normalizeEmail(raw: string | undefined): string | null {
  const value = raw?.trim().toLowerCase() ?? '';
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? value : null;
}

export function nameKey(raw: string | null | undefined): string | null {
  const value = (raw ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  return value === '' ? null : value;
}

export function gstKey(raw: string | undefined): string | null {
  const value = (raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return value.length === 15 ? value : null;
}

/** "[a, b]" or "a" → ["a", "b"] / ["a"]; "[]" → []. */
export function listValues(raw: string): string[] {
  const trimmed = raw.trim();
  const inner = trimmed.startsWith('[') && trimmed.endsWith(']') ? trimmed.slice(1, -1) : trimmed;
  return inner
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '');
}

const sourceDateTime = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2})(?::(\d{2}))?)?/;

/**
 * "2026-07-03 15:58:13" in the source's local time → a Date. `offset` is the
 * source's UTC offset ("+05:30"), from the config, never assumed.
 */
export function parseSourceDateTime(raw: string | undefined, offset: string): Date | null {
  const match = sourceDateTime.exec(raw?.trim() ?? '');
  if (match === null) return null;
  const date = new Date(`${match[1]}T${match[2] ?? '00:00'}:${match[3] ?? '00'}${offset}`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function normalizeFieldValue(field: FieldConfig, raw: string, offset: string): Normalized {
  const value = raw.trim();
  switch (field.type) {
    case 'number': {
      const parsed = Number(value.replace(/,/g, ''));
      return Number.isFinite(parsed)
        ? { ok: true, value: parsed }
        : { ok: false, reason: 'not a number' };
    }
    case 'date': {
      const match = sourceDateTime.exec(value);
      return match === null ? { ok: false, reason: 'not a date' } : { ok: true, value: match[1] };
    }
    case 'datetime': {
      const date = parseSourceDateTime(value, offset);
      return date === null
        ? { ok: false, reason: 'not a date-time' }
        : { ok: true, value: date.toISOString() };
    }
    case 'boolean': {
      const lowered = value.toLowerCase();
      if (['true', 'yes', '1'].includes(lowered)) return { ok: true, value: true };
      if (['false', 'no', '0'].includes(lowered)) return { ok: true, value: false };
      return { ok: false, reason: 'not yes/no' };
    }
    case 'select': {
      const values = listValues(value);
      if (values.length === 0) return { ok: true, value: null };
      if (values.length > 1) return { ok: false, reason: 'several values for a single choice' };
      const option = matchOption(field.options ?? [], values[0]!);
      return option === null
        ? { ok: false, reason: 'not one of the options' }
        : { ok: true, value: option };
    }
    case 'multi_select': {
      const values = listValues(value);
      const options = values.map((item) => matchOption(field.options ?? [], item));
      if (options.some((option) => option === null))
        return { ok: false, reason: 'not one of the options' };
      return { ok: true, value: [...new Set(options as string[])] };
    }
    case 'email': {
      const email = normalizeEmail(value);
      return email === null ? { ok: false, reason: 'not an email' } : { ok: true, value: email };
    }
    case 'phone': {
      const phone = normalizePhone(value);
      return phone === null ? { ok: false, reason: 'not a phone' } : { ok: true, value: phone };
    }
    case 'json':
      try {
        return { ok: true, value: JSON.parse(value) as unknown };
      } catch {
        return { ok: false, reason: 'not JSON' };
      }
    default:
      // A bracketed single value from a dropdown export is still plain text.
      return { ok: true, value: /^\[[^\]]*\]$/.test(value) ? listValues(value).join(', ') : value };
  }
}

/** Case- and space-insensitive option match, returning the configured spelling. */
export function matchOption(options: readonly string[], raw: string): string | null {
  const wanted = raw.replace(/\s+/g, ' ').trim().toLowerCase();
  return (
    options.find((option) => option.replace(/\s+/g, ' ').trim().toLowerCase() === wanted) ?? null
  );
}

export interface RemarkLine {
  at: Date | null;
  text: string;
  actorName: string | null;
}

/** `<timestamp> :- <text> (<actor>)`, `<br/>`-separated. */
export function parseRemarks(raw: string | undefined, offset: string): RemarkLine[] {
  if (raw === undefined) return [];
  return raw
    .split(/<br\s*\/?>/i)
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .map((line) => {
      const match =
        /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\s*:-\s*([\s\S]*?)(?:\s*\(([^()]*)\))?\s*$/.exec(
          line,
        );
      if (match === null) return { at: null, text: decodeEntities(line), actorName: null };
      return {
        at: parseSourceDateTime(match[1], offset),
        text: decodeEntities(match[2] ?? '').trim(),
        actorName: match[3]?.trim() || null,
      };
    })
    .filter((line) => line.text !== '');
}

function decodeEntities(text: string): string {
  return text
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'");
}
