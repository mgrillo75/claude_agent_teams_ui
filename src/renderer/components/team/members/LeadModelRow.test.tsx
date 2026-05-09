import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

import { getTeamColorSet } from '@renderer/constants/teamColors';
import { resolveTeamLeadColorName } from '@shared/utils/teamMemberColors';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@renderer/components/common/ProviderBrandLogo', () => ({
  ProviderBrandLogo: () => React.createElement('span', { 'data-testid': 'provider-logo' }),
}));

vi.mock('@renderer/components/team/dialogs/EffortLevelSelector', () => ({
  EffortLevelSelector: () => React.createElement('div', null, 'effort-selector'),
}));

vi.mock('@renderer/components/team/dialogs/LimitContextCheckbox', () => ({
  LimitContextCheckbox: () => React.createElement('div', null, 'limit-context'),
}));

vi.mock('@renderer/components/team/dialogs/TeamModelSelector', () => ({
  getProviderScopedTeamModelLabel: (_providerId: string, model: string) => model || 'Default',
  getTeamProviderLabel: (providerId: string) => providerId,
  TeamModelSelector: () => React.createElement('div', null, 'team-model-selector'),
}));

vi.mock('@renderer/components/ui/checkbox', () => ({
  Checkbox: ({
    checked,
    onCheckedChange,
    ...props
  }: {
    checked?: boolean;
    onCheckedChange?: (value: boolean) => void;
  }) =>
    React.createElement('input', {
      ...props,
      checked,
      type: 'checkbox',
      onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
        onCheckedChange?.(event.target.checked),
    }),
}));

vi.mock('@renderer/components/ui/label', () => ({
  Label: ({
    children,
    ...props
  }: React.LabelHTMLAttributes<HTMLLabelElement> & { children: React.ReactNode }) =>
    React.createElement('label', props, children),
}));

vi.mock('@renderer/hooks/useTheme', () => ({
  useTheme: () => ({ isLight: false }),
}));

vi.mock('@renderer/utils/teamModelCatalog', () => ({
  isAnthropicHaikuTeamModel: () => false,
  isAnthropicSonnetTeamModel: (model: string | undefined) =>
    model === 'sonnet' || model === 'claude-sonnet-4-6' || model === 'sonnet[1m]',
}));

vi.mock('../../ui/button', () => ({
  Button: ({
    children,
    className,
    onClick,
    disabled,
    'aria-label': ariaLabel,
  }: {
    children: React.ReactNode;
    className?: string;
    onClick?: React.MouseEventHandler<HTMLButtonElement>;
    disabled?: boolean;
    'aria-label'?: string;
  }) =>
    React.createElement(
      'button',
      { className, disabled, onClick, type: 'button', 'aria-label': ariaLabel },
      children
    ),
}));

import { ANTHROPIC_LONG_CONTEXT_PRICING_URL, LeadModelRow } from './LeadModelRow';

function renderLeadModelRow(overrides: Partial<React.ComponentProps<typeof LeadModelRow>> = {}): {
  host: HTMLDivElement;
  root: ReturnType<typeof createRoot>;
} {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);

  act(() => {
    root.render(
      React.createElement(LeadModelRow, {
        providerId: 'anthropic',
        model: 'opus',
        effort: 'medium',
        limitContext: false,
        onProviderChange: () => undefined,
        onModelChange: () => undefined,
        onEffortChange: () => undefined,
        onLimitContextChange: () => undefined,
        syncModelsWithTeammates: true,
        onSyncModelsWithTeammatesChange: () => undefined,
        ...overrides,
      })
    );
  });

  return { host, root };
}

describe('LeadModelRow', () => {
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('uses the canonical team-lead color for the preview stripe', () => {
    const { host, root } = renderLeadModelRow();

    const stripe = host.querySelector('[aria-hidden="true"]');
    const expectedBorder = getTeamColorSet(resolveTeamLeadColorName()).border;

    expect(host.textContent).toContain('lead');
    expect(host.textContent).toContain('Team Lead');
    expect(stripe?.getAttribute('style')).toContain(expectedBorder);

    act(() => {
      root.unmount();
    });
  });

  it('warns that unchecked 200K limit can put Sonnet on Anthropic Extra Usage', () => {
    const { host, root } = renderLeadModelRow({
      providerId: 'anthropic',
      model: 'sonnet',
      limitContext: false,
    });

    expect(host.textContent).toContain('Sonnet with 1M context can use Anthropic Extra Usage');
    expect(host.textContent).toContain('Requests over 200K input tokens');
    const docsLink = host.querySelector(`a[href="${ANTHROPIC_LONG_CONTEXT_PRICING_URL}"]`);

    expect(docsLink?.textContent).toContain('Anthropic pricing docs');
    expect(docsLink?.getAttribute('target')).toBe('_blank');
    expect(docsLink?.getAttribute('rel')).toBe('noreferrer');

    act(() => {
      root.unmount();
    });
  });

  it('does not show the Sonnet Extra Usage warning when 200K limit is enabled', () => {
    const { host, root } = renderLeadModelRow({
      providerId: 'anthropic',
      model: 'sonnet',
      limitContext: true,
    });

    expect(host.textContent).not.toContain('Anthropic Extra Usage');

    act(() => {
      root.unmount();
    });
  });
});
