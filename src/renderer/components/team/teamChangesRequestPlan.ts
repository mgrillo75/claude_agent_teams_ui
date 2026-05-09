import {
  buildTaskChangeRequestOptions,
  canDisplayTaskChangesForOptions,
} from '@renderer/utils/taskChangeRequest';

import type {
  TaskChangeRequestOptions,
  TeamTaskChangeSummaryRequest,
  TeamTaskWithKanban,
} from '@shared/types';

export const TEAM_CHANGES_MAX_REQUESTS = 120;
export const TEAM_CHANGES_UNKNOWN_SCAN_LIMIT = 32;
export const TEAM_CHANGES_MAX_RENDERED_FILE_ROWS = 300;

interface TeamChangeCandidate {
  task: TeamTaskWithKanban;
  options: TaskChangeRequestOptions;
  priority: number;
}

export interface TeamChangeRequestPlan {
  requests: TeamTaskChangeSummaryRequest[];
  requestOptionsByTaskId: Map<string, TaskChangeRequestOptions>;
  eligibleTaskIds: Set<string>;
  eligibleCount: number;
  requestedCount: number;
  deferredCount: number;
  nextUnknownScanCursor: number;
}

export function getTeamChangeTaskTimeMs(task: TeamTaskWithKanban): number {
  const value = task.updatedAt ?? task.createdAt;
  if (!value) return 0;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function compareCandidateRecency(a: TeamChangeCandidate, b: TeamChangeCandidate): number {
  const priorityDelta = a.priority - b.priority;
  if (priorityDelta !== 0) return priorityDelta;
  return getTeamChangeTaskTimeMs(b.task) - getTeamChangeTaskTimeMs(a.task);
}

function rotateCandidates<T>(items: T[], cursor: number): T[] {
  if (items.length === 0) return items;
  const start = cursor % items.length;
  if (start === 0) return items;
  return [...items.slice(start), ...items.slice(0, start)];
}

function hasTaskChangeScanEvidence(task: TeamTaskWithKanban): boolean {
  if ((task.workIntervals?.length ?? 0) > 0 || (task.reviewIntervals?.length ?? 0) > 0) {
    return true;
  }
  return (
    task.historyEvents?.some((event) => {
      if (event.type === 'task_created') {
        return false;
      }
      return event.type === 'status_changed' || event.type.startsWith('review_');
    }) ?? false
  );
}

function getRelevantHistoryEvents(task: TeamTaskWithKanban): { type: string; timestamp: string }[] {
  return (
    task.historyEvents
      ?.filter((event) => event.type === 'status_changed' || event.type.startsWith('review_'))
      .map((event) => ({
        type: event.type,
        timestamp: event.timestamp,
      })) ?? []
  );
}

export function buildTeamChangeRequestPlan(
  tasks: TeamTaskWithKanban[],
  unknownScanCursor: number,
  forceFresh: boolean
): TeamChangeRequestPlan {
  const primary: TeamChangeCandidate[] = [];
  const active: TeamChangeCandidate[] = [];
  const unknown: TeamChangeCandidate[] = [];
  const seenTaskIds = new Set<string>();

  for (const task of tasks) {
    if (!task.id || task.status === 'deleted' || seenTaskIds.has(task.id)) {
      continue;
    }
    seenTaskIds.add(task.id);

    const options = buildTaskChangeRequestOptions(task, { summaryOnly: true });
    const presence = task.changePresence ?? 'unknown';
    const canDisplay = canDisplayTaskChangesForOptions(options);
    const shouldScanUnknown =
      presence === 'unknown' && (canDisplay || hasTaskChangeScanEvidence(task));
    if (
      !canDisplay &&
      presence !== 'has_changes' &&
      presence !== 'needs_attention' &&
      !shouldScanUnknown
    ) {
      continue;
    }

    if (presence === 'has_changes') {
      primary.push({ task, options, priority: 0 });
      continue;
    }
    if (presence === 'needs_attention') {
      primary.push({ task, options, priority: 1 });
      continue;
    }
    if (options.stateBucket === 'active' && options.status === 'in_progress') {
      active.push({ task, options, priority: 2 });
      continue;
    }
    if (shouldScanUnknown) {
      unknown.push({ task, options, priority: 3 });
    }
  }

  primary.sort(compareCandidateRecency);
  active.sort(compareCandidateRecency);
  unknown.sort(compareCandidateRecency);

  const eligibleTaskIds = new Set(
    [...primary, ...active, ...unknown].map((candidate) => candidate.task.id)
  );
  const unknownWindow = rotateCandidates(unknown, unknownScanCursor).slice(
    0,
    TEAM_CHANGES_UNKNOWN_SCAN_LIMIT
  );
  const selected = [...primary, ...active, ...unknownWindow].slice(0, TEAM_CHANGES_MAX_REQUESTS);
  const requestOptionsByTaskId = new Map<string, TaskChangeRequestOptions>();
  const requests = selected.map((candidate) => {
    const options = {
      ...candidate.options,
      summaryOnly: true,
      forceFresh: forceFresh ? true : candidate.options.forceFresh,
    };
    requestOptionsByTaskId.set(candidate.task.id, options);
    return {
      taskId: candidate.task.id,
      options,
    };
  });
  const eligibleCount = primary.length + active.length + unknown.length;
  const nextUnknownScanCursor =
    unknown.length > 0
      ? (unknownScanCursor + Math.min(TEAM_CHANGES_UNKNOWN_SCAN_LIMIT, unknown.length)) %
        unknown.length
      : 0;

  return {
    requests,
    requestOptionsByTaskId,
    eligibleTaskIds,
    eligibleCount,
    requestedCount: requests.length,
    deferredCount: Math.max(0, eligibleCount - requests.length),
    nextUnknownScanCursor,
  };
}

export function buildTeamChangesTasksFingerprint(tasks: TeamTaskWithKanban[]): string {
  return JSON.stringify(
    tasks
      .map((task) => ({
        id: task.id,
        status: task.status,
        owner: task.owner ?? '',
        updatedAt: task.updatedAt ?? '',
        changePresence: task.changePresence ?? 'unknown',
        reviewState: task.reviewState ?? '',
        kanbanColumn: task.kanbanColumn ?? '',
        workIntervals:
          task.workIntervals?.map((interval) => ({
            startedAt: interval.startedAt,
            completedAt: interval.completedAt ?? '',
          })) ?? [],
        reviewIntervals:
          task.reviewIntervals?.map((interval) => ({
            reviewer: interval.reviewer,
            startedAt: interval.startedAt,
            completedAt: interval.completedAt ?? '',
          })) ?? [],
        historyEvents: getRelevantHistoryEvents(task),
      }))
      .sort((a, b) => a.id.localeCompare(b.id))
  );
}
