import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { api } from '@renderer/api';
import { useStore } from '@renderer/store';
import { resolveTaskChangePresenceFromResult } from '@renderer/utils/taskChangePresence';

import { withTeamChangesLoadTimeout } from './teamChangesLoadTimeout';
import {
  buildTeamChangeRequestPlan,
  buildTeamChangesTasksFingerprint,
} from './teamChangesRequestPlan';

import type {
  TaskChangePresenceState,
  TaskChangeSetV2,
  TeamTaskChangeSummaryItem,
  TeamTaskWithKanban,
} from '@shared/types';

const TEAM_CHANGES_AUTO_REFRESH_MS = 30_000;
const TEAM_CHANGES_ERROR_AUTO_RETRY_COOLDOWN_MS = 120_000;

export interface TeamChangeSummaryState {
  taskId: string;
  changeSet: TaskChangeSetV2 | null;
  error?: string;
}

export interface TeamChangeStats {
  eligibleCount: number;
  requestedCount: number;
  deferredCount: number;
}

interface TeamChangesLoadOptions {
  forceFresh?: boolean;
  showSpinner?: boolean;
  preserveOnError?: boolean;
}

interface UseTeamChangesSummariesInput {
  teamName: string;
  tasks: TeamTaskWithKanban[];
  sectionOpen: boolean;
}

interface UseTeamChangesSummariesResult {
  summariesByTaskId: Record<string, TeamChangeSummaryState>;
  stats: TeamChangeStats;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  refresh: () => void;
}

function normalizeTeamChangeSummaryItem(item: unknown): TeamTaskChangeSummaryItem | null {
  if (!item || typeof item !== 'object') {
    return null;
  }

  const candidate = item as Partial<TeamTaskChangeSummaryItem>;
  const taskId = typeof candidate.taskId === 'string' ? candidate.taskId.trim() : '';
  if (!taskId) {
    return null;
  }

  const changeSet =
    candidate.changeSet &&
    typeof candidate.changeSet === 'object' &&
    !Array.isArray(candidate.changeSet)
      ? candidate.changeSet
      : null;
  const error = typeof candidate.error === 'string' ? candidate.error : undefined;
  return {
    taskId,
    changeSet,
    ...(error ? { error } : {}),
  };
}

function getSafeResponseItems(response: unknown): TeamTaskChangeSummaryItem[] {
  if (
    !response ||
    typeof response !== 'object' ||
    !Array.isArray((response as { items?: unknown }).items)
  ) {
    throw new Error('Team changes response was malformed.');
  }
  return (response as { items: unknown[] }).items
    .map(normalizeTeamChangeSummaryItem)
    .filter((item): item is TeamTaskChangeSummaryItem => item !== null);
}

function hasSafeFileSummaries(changeSet: TaskChangeSetV2): boolean {
  return changeSet.files.every(
    (file) =>
      file &&
      typeof file === 'object' &&
      typeof file.filePath === 'string' &&
      file.filePath.trim().length > 0
  );
}

function isMinimalPresenceChangeSet(changeSet: TaskChangeSetV2): boolean {
  return Boolean(
    Array.isArray(changeSet.files) &&
    hasSafeFileSummaries(changeSet) &&
    Array.isArray(changeSet.warnings) &&
    Number.isFinite(changeSet.totalFiles) &&
    Number(changeSet.totalFiles) >= 0 &&
    typeof changeSet.computedAt === 'string' &&
    changeSet.computedAt.trim().length > 0 &&
    changeSet.scope &&
    typeof changeSet.scope === 'object' &&
    !Array.isArray(changeSet.scope)
  );
}

function resolveCacheablePresenceFromChangeSet(
  changeSet: TaskChangeSetV2
): Exclude<TaskChangePresenceState, 'unknown'> | null {
  if (!isMinimalPresenceChangeSet(changeSet)) {
    return null;
  }

  const nextPresence = resolveTaskChangePresenceFromResult(changeSet);
  if (nextPresence === 'has_changes' || nextPresence === 'needs_attention') {
    return nextPresence;
  }
  if (
    nextPresence === 'no_changes' &&
    (changeSet.confidence === 'high' || changeSet.confidence === 'medium')
  ) {
    return nextPresence;
  }
  return null;
}

export function useTeamChangesSummaries({
  teamName,
  tasks,
  sectionOpen,
}: UseTeamChangesSummariesInput): UseTeamChangesSummariesResult {
  const recordTaskChangePresence = useStore((s) => s.recordTaskChangePresence);
  const setSelectedTeamTaskChangePresence = useStore((s) => s.setSelectedTeamTaskChangePresence);
  const [summariesByTaskId, setSummariesByTaskId] = useState<
    Record<string, TeamChangeSummaryState>
  >({});
  const [stats, setStats] = useState<TeamChangeStats>({
    eligibleCount: 0,
    requestedCount: 0,
    deferredCount: 0,
  });
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [queuedRefreshTick, setQueuedRefreshTick] = useState(0);
  const hasLoadedRef = useRef(false);
  const mountedRef = useRef(true);
  const requestSeqRef = useRef(0);
  const activeRequestSeqRef = useRef<number | null>(null);
  const queuedRefreshOptionsRef = useRef<TeamChangesLoadOptions | null>(null);
  const autoRefreshBlockedUntilRef = useRef(0);
  const sectionOpenRef = useRef(sectionOpen);
  const unknownScanCursorRef = useRef(0);
  const lastRequestedTasksFingerprintRef = useRef<string | null>(null);
  const tasksFingerprint = useMemo(
    () => (sectionOpen ? buildTeamChangesTasksFingerprint(tasks) : ''),
    [sectionOpen, tasks]
  );
  sectionOpenRef.current = sectionOpen;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestSeqRef.current += 1;
      activeRequestSeqRef.current = null;
      queuedRefreshOptionsRef.current = null;
      autoRefreshBlockedUntilRef.current = 0;
      hasLoadedRef.current = false;
      unknownScanCursorRef.current = 0;
      lastRequestedTasksFingerprintRef.current = null;
    };
  }, []);

  const loadSummaries = useCallback(
    async ({
      forceFresh = false,
      showSpinner = false,
      preserveOnError = true,
    }: TeamChangesLoadOptions = {}): Promise<void> => {
      if (forceFresh) {
        autoRefreshBlockedUntilRef.current = 0;
      } else if (autoRefreshBlockedUntilRef.current > Date.now()) {
        return;
      }

      if (activeRequestSeqRef.current !== null || queuedRefreshOptionsRef.current !== null) {
        const previous = queuedRefreshOptionsRef.current;
        queuedRefreshOptionsRef.current = {
          forceFresh: Boolean(previous?.forceFresh || forceFresh),
          showSpinner: Boolean(previous?.showSpinner || showSpinner),
          preserveOnError: previous
            ? Boolean(previous.preserveOnError && preserveOnError)
            : preserveOnError,
        };
        if (activeRequestSeqRef.current === null && sectionOpenRef.current) {
          setQueuedRefreshTick((value) => value + 1);
        }
        return;
      }

      const plan = buildTeamChangeRequestPlan(tasks, unknownScanCursorRef.current, forceFresh);
      unknownScanCursorRef.current = plan.nextUnknownScanCursor;
      const requestSeq = requestSeqRef.current + 1;
      requestSeqRef.current = requestSeq;
      setStats({
        eligibleCount: plan.eligibleCount,
        requestedCount: plan.requestedCount,
        deferredCount: plan.deferredCount,
      });
      setError(null);

      if (plan.requests.length === 0) {
        setSummariesByTaskId({});
        autoRefreshBlockedUntilRef.current = 0;
        setLoading(false);
        setRefreshing(false);
        return;
      }

      if (showSpinner) {
        setLoading(true);
      } else {
        setRefreshing(true);
      }
      activeRequestSeqRef.current = requestSeq;

      try {
        const response = await withTeamChangesLoadTimeout(
          api.review.getTeamTaskChangeSummaries(teamName, plan.requests)
        );
        if (!mountedRef.current || requestSeqRef.current !== requestSeq) {
          return;
        }
        if (queuedRefreshOptionsRef.current !== null) {
          return;
        }
        autoRefreshBlockedUntilRef.current = 0;
        const responseItems = getSafeResponseItems(response);

        const currentTaskIds = new Set(tasks.map((task) => task.id));
        for (const item of responseItems) {
          const changeSet = item.changeSet;
          const options = plan.requestOptionsByTaskId.get(item.taskId);
          if (!changeSet || !options) continue;

          const nextPresence = resolveCacheablePresenceFromChangeSet(changeSet);
          if (!nextPresence) continue;
          recordTaskChangePresence(teamName, item.taskId, options, nextPresence);
          setSelectedTeamTaskChangePresence(teamName, item.taskId, nextPresence);
        }

        setSummariesByTaskId((previous) => {
          const next: Record<string, TeamChangeSummaryState> = {};
          for (const [taskId, summary] of Object.entries(previous)) {
            if (currentTaskIds.has(taskId) && plan.eligibleTaskIds.has(taskId)) {
              next[taskId] = summary;
            }
          }
          for (const item of responseItems) {
            const options = plan.requestOptionsByTaskId.get(item.taskId);
            if (!options) continue;
            next[item.taskId] = {
              taskId: item.taskId,
              changeSet: item.changeSet,
              error: item.error,
            };
          }
          return next;
        });
      } catch (err) {
        if (!mountedRef.current || requestSeqRef.current !== requestSeq) {
          return;
        }
        queuedRefreshOptionsRef.current = null;
        autoRefreshBlockedUntilRef.current = Date.now() + TEAM_CHANGES_ERROR_AUTO_RETRY_COOLDOWN_MS;
        if (!preserveOnError) {
          setSummariesByTaskId({});
        }
        setError(err instanceof Error ? err.message : 'Failed to load team changes');
      } finally {
        if (mountedRef.current) {
          const hasQueuedRefresh = queuedRefreshOptionsRef.current !== null;
          if (activeRequestSeqRef.current === requestSeq) {
            activeRequestSeqRef.current = null;
          }
          if (hasQueuedRefresh && activeRequestSeqRef.current === null && sectionOpenRef.current) {
            setQueuedRefreshTick((value) => value + 1);
          }
          const shouldStopIndicators =
            requestSeqRef.current === requestSeq ||
            (!hasQueuedRefresh && activeRequestSeqRef.current === null);
          if (shouldStopIndicators) {
            setLoading(false);
            setRefreshing(false);
          }
        }
      }
    },
    [recordTaskChangePresence, setSelectedTeamTaskChangePresence, tasks, teamName]
  );

  useEffect(() => {
    hasLoadedRef.current = false;
    requestSeqRef.current += 1;
    activeRequestSeqRef.current = null;
    queuedRefreshOptionsRef.current = null;
    autoRefreshBlockedUntilRef.current = 0;
    unknownScanCursorRef.current = 0;
    lastRequestedTasksFingerprintRef.current = null;
    setSummariesByTaskId({});
    setError(null);
    setStats({ eligibleCount: 0, requestedCount: 0, deferredCount: 0 });
  }, [teamName]);

  useEffect(() => {
    if (!sectionOpen) {
      requestSeqRef.current += 1;
      activeRequestSeqRef.current = null;
      queuedRefreshOptionsRef.current = null;
      autoRefreshBlockedUntilRef.current = 0;
      hasLoadedRef.current = false;
      lastRequestedTasksFingerprintRef.current = null;
      setSummariesByTaskId({});
      setError(null);
      setStats({ eligibleCount: 0, requestedCount: 0, deferredCount: 0 });
      setLoading(false);
      setRefreshing(false);
    }
  }, [sectionOpen]);

  useEffect(() => {
    if (!sectionOpen || hasLoadedRef.current) {
      return;
    }
    hasLoadedRef.current = true;
    lastRequestedTasksFingerprintRef.current = tasksFingerprint;
    void loadSummaries({ showSpinner: true, preserveOnError: false });
  }, [loadSummaries, sectionOpen, tasksFingerprint]);

  useEffect(() => {
    if (!sectionOpen || !hasLoadedRef.current) {
      return;
    }
    if (lastRequestedTasksFingerprintRef.current === tasksFingerprint) {
      return;
    }
    lastRequestedTasksFingerprintRef.current = tasksFingerprint;
    void loadSummaries({ showSpinner: false, preserveOnError: true });
  }, [loadSummaries, sectionOpen, tasksFingerprint]);

  useEffect(() => {
    if (!sectionOpen || activeRequestSeqRef.current !== null) {
      return;
    }
    const options = queuedRefreshOptionsRef.current;
    if (!options) {
      return;
    }
    queuedRefreshOptionsRef.current = null;
    void loadSummaries(options);
  }, [loadSummaries, queuedRefreshTick, sectionOpen]);

  useEffect(() => {
    if (!sectionOpen) {
      return;
    }

    const timer = window.setInterval(() => {
      if (activeRequestSeqRef.current !== null || queuedRefreshOptionsRef.current !== null) {
        return;
      }
      void loadSummaries({ showSpinner: false, preserveOnError: true });
    }, TEAM_CHANGES_AUTO_REFRESH_MS);

    return () => {
      window.clearInterval(timer);
    };
  }, [loadSummaries, sectionOpen]);

  const refresh = useCallback(() => {
    void loadSummaries({ forceFresh: true, showSpinner: true, preserveOnError: false });
  }, [loadSummaries]);

  return {
    summariesByTaskId,
    stats,
    loading,
    refreshing,
    error,
    refresh,
  };
}
