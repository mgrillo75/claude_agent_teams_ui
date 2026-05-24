import { useEffect, useMemo, useState } from 'react';

import { useAppTranslation } from '@features/localization/renderer';
import { isElectronMode } from '@renderer/api';
import { formatProviderStatusText } from '@renderer/components/runtime/providerConnectionUi';
import { createLoadingMultimodelCliStatus } from '@renderer/store/slices/cliInstallerSlice';
import { filterMainScreenCliProviders } from '@renderer/utils/geminiUiFreeze';
import { CLI_PROVIDER_STATUS_DEFERRED_MESSAGE } from '@shared/types/cliInstaller';
import { AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';

import { ProviderBrandLogo } from './ProviderBrandLogo';

import type { CliInstallationStatus, CliProviderId, CliProviderStatus } from '@shared/types';

interface ProviderActivityState {
  provider: CliProviderStatus;
  loading: boolean;
  error: boolean;
}

interface ProviderActivityStatusStripProps {
  readonly cliStatus: CliInstallationStatus | null | undefined;
  readonly sourceCliStatus?: CliInstallationStatus | null;
  readonly cliStatusLoading: boolean;
  readonly cliProviderStatusLoading: Partial<Record<CliProviderId, boolean>>;
  readonly multimodelEnabled: boolean;
  readonly codexSnapshotPending?: boolean;
  readonly providerIds?: readonly CliProviderId[];
  readonly className?: string;
  readonly label?: string | null;
}

function isProviderCardLoading(provider: CliProviderStatus, providerLoading: boolean): boolean {
  return (
    providerLoading ||
    (!provider.authenticated &&
      (provider.statusMessage === 'Checking...' ||
        provider.statusMessage === CLI_PROVIDER_STATUS_DEFERRED_MESSAGE) &&
      provider.models.length === 0 &&
      provider.backend == null)
  );
}

function shouldMaskCodexNegativeBootstrapState(
  sourceProvider: CliProviderStatus | null,
  mergedProvider: CliProviderStatus
): boolean {
  return (
    sourceProvider?.providerId === 'codex' &&
    sourceProvider.statusMessage === 'Checking...' &&
    mergedProvider.providerId === 'codex' &&
    mergedProvider.connection?.codex?.launchReadinessState === 'missing_auth' &&
    mergedProvider.connection.codex.login.status === 'idle'
  );
}

function getActivityToneStyles(tone: 'loading' | 'checked' | 'error'): {
  borderColor: string;
  backgroundColor: string;
  textColor: string;
  statusColor: string;
} {
  switch (tone) {
    case 'checked':
      return {
        borderColor: 'rgba(34, 197, 94, 0.22)',
        backgroundColor: 'rgba(34, 197, 94, 0.08)',
        textColor: '#dcfce7',
        statusColor: '#86efac',
      };
    case 'error':
      return {
        borderColor: 'rgba(239, 68, 68, 0.28)',
        backgroundColor: 'rgba(239, 68, 68, 0.08)',
        textColor: '#fee2e2',
        statusColor: '#fca5a5',
      };
    case 'loading':
    default:
      return {
        borderColor: 'var(--color-border-emphasis)',
        backgroundColor: 'rgba(255, 255, 255, 0.03)',
        textColor: 'var(--color-text-secondary)',
        statusColor: 'var(--color-text-muted)',
      };
  }
}

function areProviderIdListsEqual(nextIds: CliProviderId[], prevIds: CliProviderId[]): boolean {
  return nextIds.length === prevIds.length && nextIds.every((id, index) => prevIds[index] === id);
}

function useProviderActivityDisplay({
  cliStatus,
  sourceCliStatus,
  cliStatusLoading,
  cliProviderStatusLoading,
  multimodelEnabled,
  codexSnapshotPending = false,
  providerIds,
}: Pick<
  ProviderActivityStatusStripProps,
  | 'cliStatus'
  | 'sourceCliStatus'
  | 'cliStatusLoading'
  | 'cliProviderStatusLoading'
  | 'multimodelEnabled'
  | 'codexSnapshotPending'
  | 'providerIds'
>): {
  displayProviderIds: CliProviderId[];
  providerStateMap: Map<CliProviderId, ProviderActivityState>;
  shouldRender: boolean;
} {
  const [cycleProviderIds, setCycleProviderIds] = useState<CliProviderId[]>([]);
  const renderCliStatus = useMemo(
    () =>
      !cliStatus && cliStatusLoading && multimodelEnabled
        ? createLoadingMultimodelCliStatus()
        : (cliStatus ?? null),
    [cliStatus, cliStatusLoading, multimodelEnabled]
  );
  const sourceStatus = sourceCliStatus ?? renderCliStatus;
  const providerIdSet = useMemo(
    () => (providerIds ? new Set<CliProviderId>(providerIds) : null),
    [providerIds]
  );
  const sourceProviderMap = useMemo(
    () =>
      new Map((sourceStatus?.providers ?? []).map((provider) => [provider.providerId, provider])),
    [sourceStatus?.providers]
  );

  const providerStates = useMemo<ProviderActivityState[]>(() => {
    const visibleProviders = filterMainScreenCliProviders(renderCliStatus?.providers ?? []).filter(
      (provider) => !providerIdSet || providerIdSet.has(provider.providerId)
    );

    return visibleProviders.map((provider) => {
      const sourceProvider = sourceProviderMap.get(provider.providerId) ?? null;
      const loading =
        isProviderCardLoading(provider, cliProviderStatusLoading[provider.providerId] === true) ||
        (provider.providerId === 'codex' && codexSnapshotPending) ||
        shouldMaskCodexNegativeBootstrapState(sourceProvider, provider);

      return {
        provider,
        loading,
        error: !loading && provider.verificationState === 'error',
      };
    });
  }, [
    cliProviderStatusLoading,
    codexSnapshotPending,
    providerIdSet,
    renderCliStatus?.providers,
    sourceProviderMap,
  ]);

  const visibleProviderIds = useMemo(
    () => providerStates.map((state) => state.provider.providerId),
    [providerStates]
  );
  const loadingProviderIds = useMemo(
    () => providerStates.filter((state) => state.loading).map((state) => state.provider.providerId),
    [providerStates]
  );
  const errorProviderIds = useMemo(
    () => providerStates.filter((state) => state.error).map((state) => state.provider.providerId),
    [providerStates]
  );
  const providerStateMap = useMemo(
    () => new Map(providerStates.map((state) => [state.provider.providerId, state])),
    [providerStates]
  );

  useEffect(() => {
    setCycleProviderIds((previousIds) => {
      const visiblePreviousIds = previousIds.filter((providerId) =>
        visibleProviderIds.includes(providerId)
      );

      if (loadingProviderIds.length > 0) {
        const nextIds = [...visiblePreviousIds];
        for (const providerId of loadingProviderIds) {
          if (!nextIds.includes(providerId)) {
            nextIds.push(providerId);
          }
        }

        return areProviderIdListsEqual(nextIds, previousIds) ? previousIds : nextIds;
      }

      if (errorProviderIds.length > 0) {
        return areProviderIdListsEqual(errorProviderIds, previousIds)
          ? previousIds
          : errorProviderIds;
      }

      return previousIds.length === 0 ? previousIds : [];
    });
  }, [errorProviderIds, loadingProviderIds, visibleProviderIds]);

  const displayProviderIds = useMemo(() => {
    if (loadingProviderIds.length > 0) {
      const activeCycleIds = (
        cycleProviderIds.length > 0 ? cycleProviderIds : loadingProviderIds
      ).filter((providerId) => providerStateMap.has(providerId));
      return Array.from(new Set([...activeCycleIds, ...errorProviderIds]));
    }

    if (errorProviderIds.length > 0) {
      return errorProviderIds;
    }

    return [];
  }, [cycleProviderIds, errorProviderIds, loadingProviderIds, providerStateMap]);

  return {
    displayProviderIds,
    providerStateMap,
    shouldRender:
      isElectronMode() &&
      multimodelEnabled &&
      renderCliStatus?.flavor === 'agent_teams_orchestrator' &&
      renderCliStatus.installed &&
      displayProviderIds.length > 0,
  };
}

export const ProviderActivityStatusStrip = ({
  cliStatus,
  sourceCliStatus,
  cliStatusLoading,
  cliProviderStatusLoading,
  multimodelEnabled,
  codexSnapshotPending = false,
  providerIds,
  className = '',
  label,
}: ProviderActivityStatusStripProps): React.JSX.Element | null => {
  const { t } = useAppTranslation('settings');
  const effectiveLabel = label ?? t('providerRuntime.connectionUi.status.providerActivity');
  const { displayProviderIds, providerStateMap, shouldRender } = useProviderActivityDisplay({
    cliStatus,
    sourceCliStatus,
    cliStatusLoading,
    cliProviderStatusLoading,
    multimodelEnabled,
    codexSnapshotPending,
    providerIds,
  });

  if (!shouldRender) {
    return null;
  }

  return (
    <div className={`flex min-w-0 flex-wrap items-center gap-2 ${className}`.trim()}>
      {effectiveLabel ? (
        <span
          className="shrink-0 text-[11px] font-medium uppercase tracking-[0.08em]"
          style={{ color: 'var(--color-text-muted)' }}
        >
          {effectiveLabel}
        </span>
      ) : null}
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
        {displayProviderIds.map((providerId) => {
          const providerState = providerStateMap.get(providerId);
          if (!providerState) {
            return null;
          }

          const tone = providerState.loading
            ? 'loading'
            : providerState.error
              ? 'error'
              : 'checked';
          const styles = getActivityToneStyles(tone);
          const statusText =
            tone === 'loading'
              ? t('providerRuntime.connectionUi.status.checking')
              : tone === 'error'
                ? formatProviderStatusText(providerState.provider, t)
                : t('providerRuntime.connectionUi.status.checked');

          return (
            <div
              key={providerId}
              data-testid={`provider-activity-status-${providerId}`}
              className="flex min-w-0 items-center gap-1.5 rounded-md border px-2 py-1 text-[11px]"
              style={{
                borderColor: styles.borderColor,
                backgroundColor: styles.backgroundColor,
                color: styles.textColor,
              }}
            >
              {tone === 'loading' ? (
                <Loader2
                  className="size-3 shrink-0 animate-spin"
                  style={{ color: styles.statusColor }}
                />
              ) : tone === 'error' ? (
                <AlertTriangle className="size-3 shrink-0" style={{ color: styles.statusColor }} />
              ) : (
                <CheckCircle2 className="size-3 shrink-0" style={{ color: styles.statusColor }} />
              )}
              <ProviderBrandLogo providerId={providerId} className="size-3.5 shrink-0" />
              <span className="shrink-0 font-medium" style={{ color: styles.textColor }}>
                {providerState.provider.displayName}
              </span>
              <span
                className="max-w-[280px] truncate"
                style={{ color: styles.statusColor }}
                title={statusText}
              >
                {statusText}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};
