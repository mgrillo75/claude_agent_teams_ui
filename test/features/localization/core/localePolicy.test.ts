import {
  extractPrimaryLocaleSubtag,
  normalizeAppLocalePreference,
  resolveAppLocale,
} from '@features/localization/core/domain/localePolicy';
import { describe, expect, it } from 'vitest';

describe('localePolicy', () => {
  it('normalizes unsupported preferences to system', () => {
    expect(normalizeAppLocalePreference('uk')).toBe('system');
    expect(normalizeAppLocalePreference(null)).toBe('system');
    expect(normalizeAppLocalePreference('en')).toBe('en');
    expect(normalizeAppLocalePreference('ru')).toBe('ru');
  });

  it('extracts the primary locale subtag', () => {
    expect(extractPrimaryLocaleSubtag('en-US')).toBe('en');
    expect(extractPrimaryLocaleSubtag('EN_us')).toBe('en');
    expect(extractPrimaryLocaleSubtag('')).toBeNull();
  });

  it('resolves system locale to supported primary locale', () => {
    expect(resolveAppLocale({ preference: 'system', systemLocale: 'en-US' })).toBe('en');
    expect(resolveAppLocale({ preference: 'system', systemLocale: 'ru-RU' })).toBe('ru');
  });

  it('falls back when the system locale is not supported yet', () => {
    expect(resolveAppLocale({ preference: 'system', systemLocale: 'uk-UA' })).toBe('en');
  });
});
