import { describe, expect, it } from 'vitest';

import {
  getVisibleTeamProviderModels,
  isAnthropicSonnetTeamModel,
} from '@renderer/utils/teamModelCatalog';

describe('teamModelCatalog', () => {
  it('filters UI-disabled Codex models from provider badge lists', () => {
    expect(
      getVisibleTeamProviderModels('codex', [
        'gpt-5.4',
        'gpt-5.4-mini',
        'gpt-5.3-codex',
        'gpt-5.3-codex-spark',
        'gpt-5.2',
        'gpt-5.2-codex',
        'gpt-5.1-codex-mini',
        'gpt-5.1-codex-max',
      ])
    ).toEqual([
      'gpt-5.4',
      'gpt-5.4-mini',
      'gpt-5.3-codex',
      'gpt-5.2',
      'gpt-5.1-codex-max',
    ]);
  });

  it('adds curated Anthropic Opus 4.7 badges when the runtime list only reports legacy Opus variants', () => {
    expect(
      getVisibleTeamProviderModels('anthropic', [
        'claude-haiku-4-5-20251001',
        'claude-opus-4-6',
        'claude-opus-4-6[1m]',
        'claude-sonnet-4-6',
        'claude-sonnet-4-6[1m]',
      ])
    ).toEqual([
      'claude-haiku-4-5-20251001',
      'claude-opus-4-7',
      'claude-opus-4-7[1m]',
      'claude-opus-4-6',
      'claude-opus-4-6[1m]',
      'claude-sonnet-4-6',
      'claude-sonnet-4-6[1m]',
    ]);
  });

  it('detects Sonnet aliases with or without 1M suffix', () => {
    expect(isAnthropicSonnetTeamModel('sonnet')).toBe(true);
    expect(isAnthropicSonnetTeamModel('sonnet[1m]')).toBe(true);
    expect(isAnthropicSonnetTeamModel('claude-sonnet-4-6')).toBe(true);
    expect(isAnthropicSonnetTeamModel('claude-sonnet-4-6[1m]')).toBe(true);
    expect(isAnthropicSonnetTeamModel('opus')).toBe(false);
    expect(isAnthropicSonnetTeamModel('haiku')).toBe(false);
  });
});
