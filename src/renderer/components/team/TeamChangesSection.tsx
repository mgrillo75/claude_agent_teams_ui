import { memo, useMemo, useState } from 'react';

import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip';
import { classifyTaskChangeReviewability } from '@shared/utils/taskChangeReviewability';
import { deriveTaskDisplayId } from '@shared/utils/taskIdentity';
import { AlertTriangle, FileDiff, GitCompareArrows, Info, Loader2, RefreshCw } from 'lucide-react';

import { FileIcon } from './editor/FileIcon';
import { CollapsibleTeamSection } from './CollapsibleTeamSection';
import {
  getTeamChangeTaskTimeMs,
  TEAM_CHANGES_MAX_RENDERED_FILE_ROWS,
} from './teamChangesRequestPlan';
import { type TeamChangeSummaryState, useTeamChangesSummaries } from './useTeamChangesSummaries';

import type { FileChangeSummary, TaskChangeSetV2, TeamTaskWithKanban } from '@shared/types';

interface TeamChangesSectionProps {
  teamName: string;
  tasks: TeamTaskWithKanban[];
  onViewChanges: (taskId: string, filePath?: string) => void;
}

interface RenderedTeamChangeSummary {
  summary: TeamChangeSummaryState;
  task: TeamTaskWithKanban;
  visibleFiles: FileChangeSummary[];
  fileBudget: number;
}

function getChangeSetFiles(changeSet: TaskChangeSetV2 | null): FileChangeSummary[] {
  if (!Array.isArray(changeSet?.files)) {
    return [];
  }
  return changeSet.files.filter((file): file is FileChangeSummary =>
    Boolean(
      file &&
      typeof file === 'object' &&
      typeof (file as Partial<FileChangeSummary>).filePath === 'string'
    )
  );
}

function getChangeSetWarnings(changeSet: TaskChangeSetV2): string[] {
  return Array.isArray(changeSet.warnings)
    ? changeSet.warnings.filter((warning): warning is string => typeof warning === 'string')
    : [];
}

function getTaskChangeContributors(
  task: TeamTaskWithKanban,
  changeSet: TaskChangeSetV2 | null
): string[] {
  const names = new Set<string>();
  const contributors = Array.isArray(changeSet?.scope?.contributors)
    ? changeSet.scope.contributors
    : [];
  for (const contributor of contributors) {
    const memberName =
      contributor && typeof contributor.memberName === 'string' ? contributor.memberName : '';
    if (memberName) names.add(memberName);
  }
  const memberNames = Array.isArray(changeSet?.scope?.memberNames)
    ? changeSet.scope.memberNames
    : [];
  for (const name of memberNames) {
    if (typeof name === 'string' && name) names.add(name);
  }
  if (
    typeof changeSet?.scope?.primaryMemberName === 'string' &&
    changeSet.scope.primaryMemberName
  ) {
    names.add(changeSet.scope.primaryMemberName);
  }
  for (const file of getChangeSetFiles(changeSet)) {
    const fileMemberNames = Array.isArray(file.ledgerSummary?.memberNames)
      ? file.ledgerSummary.memberNames
      : [];
    for (const name of fileMemberNames) {
      if (typeof name === 'string' && name) names.add(name);
    }
  }
  if (names.size === 0 && task.owner) {
    names.add(task.owner);
  }
  return [...names];
}

function getVisibleFileName(file: FileChangeSummary): string {
  const value = getVisibleFilePath(file);
  return value.split(/[\\/]/).pop() ?? value;
}

function getVisibleFilePath(file: FileChangeSummary): string {
  return typeof file.relativePath === 'string' && file.relativePath.trim() !== ''
    ? file.relativePath
    : file.filePath;
}

function getTaskSummaryBadge(changeSet: TaskChangeSetV2 | null): string | undefined {
  if (!changeSet) return undefined;
  const reviewability = classifyTaskChangeReviewability(changeSet).reviewability;
  if (changeSet.totalFiles > 0) return `${changeSet.totalFiles} files`;
  if (reviewability === 'attention_required') return 'attention';
  if (reviewability === 'diagnostic_only') return 'no safe diff';
  return undefined;
}

function getTaskChangeDiagnosticMessages(changeSet: TaskChangeSetV2): string[] {
  const status = classifyTaskChangeReviewability(changeSet);
  if (status.reviewability === 'unknown' || status.reviewability === 'none') {
    return [];
  }
  const messages =
    status.diagnostics.length > 0
      ? status.diagnostics.map((diagnostic) => diagnostic.message)
      : getChangeSetWarnings(changeSet);
  return [...new Set(messages.filter((message) => message.trim().length > 0))];
}

export const TeamChangesSection = memo(function TeamChangesSection({
  teamName,
  tasks,
  onViewChanges,
}: TeamChangesSectionProps): React.JSX.Element {
  const [sectionOpen, setSectionOpen] = useState(false);
  const { summariesByTaskId, stats, loading, refreshing, error, refresh } = useTeamChangesSummaries(
    {
      teamName,
      tasks,
      sectionOpen,
    }
  );
  const taskMap = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks]);

  const visibleSummaries = useMemo(() => {
    return Object.values(summariesByTaskId)
      .map((summary) => ({ summary, task: taskMap.get(summary.taskId) }))
      .filter((entry): entry is { summary: TeamChangeSummaryState; task: TeamTaskWithKanban } => {
        const changeSet = entry.summary.changeSet;
        return (
          Boolean(entry.task) &&
          (Boolean(entry.summary.error) ||
            getChangeSetFiles(changeSet).length > 0 ||
            (changeSet ? getTaskChangeDiagnosticMessages(changeSet).length > 0 : false))
        );
      })
      .sort((a, b) => getTeamChangeTaskTimeMs(b.task) - getTeamChangeTaskTimeMs(a.task));
  }, [summariesByTaskId, taskMap]);

  const totalFiles = visibleSummaries.reduce(
    (sum, entry) => sum + getChangeSetFiles(entry.summary.changeSet).length,
    0
  );
  const hiddenFileRows = Math.max(0, totalFiles - TEAM_CHANGES_MAX_RENDERED_FILE_ROWS);
  const badge = totalFiles > 0 ? totalFiles : visibleSummaries.length || undefined;
  const renderedSummaries = useMemo(() => {
    const entries: RenderedTeamChangeSummary[] = [];
    let remainingFileRows = TEAM_CHANGES_MAX_RENDERED_FILE_ROWS;
    for (const entry of visibleSummaries) {
      const files = getChangeSetFiles(entry.summary.changeSet);
      const fileBudget = Math.max(0, remainingFileRows);
      const visibleFiles = files.slice(0, fileBudget);
      entries.push({ ...entry, visibleFiles, fileBudget });
      remainingFileRows -= visibleFiles.length;
    }
    return entries;
  }, [visibleSummaries]);

  return (
    <CollapsibleTeamSection
      sectionId="changes"
      title="Changes"
      icon={<FileDiff size={14} />}
      badge={badge}
      defaultOpen={false}
      onOpenChange={setSectionOpen}
      headerExtra={
        loading && !sectionOpen ? (
          <Loader2
            size={12}
            className="pointer-events-none animate-spin text-[var(--color-text-muted)]"
          />
        ) : sectionOpen ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="pointer-events-auto rounded p-1 text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-section-hover)] hover:text-[var(--color-text)] disabled:opacity-50"
                onClick={(event) => {
                  event.stopPropagation();
                  refresh();
                }}
                disabled={loading || refreshing}
                aria-label="Refresh team changes"
              >
                <RefreshCw
                  size={12}
                  className={loading || refreshing ? 'animate-spin' : undefined}
                />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">Refresh</TooltipContent>
          </Tooltip>
        ) : null
      }
      contentClassName="pl-2.5"
    >
      {visibleSummaries.length > 0 ? (
        <div className="space-y-2">
          <div className="max-h-[360px] space-y-2 overflow-y-auto pr-1">
            {renderedSummaries.map(({ summary, task, visibleFiles, fileBudget }) => {
              const changeSet = summary.changeSet;
              const files = getChangeSetFiles(changeSet);
              const reviewability = changeSet
                ? classifyTaskChangeReviewability(changeSet).reviewability
                : 'unknown';
              const contributors = getTaskChangeContributors(task, changeSet);
              const contributorLabel =
                contributors.length > 0 ? contributors.slice(0, 3).join(', ') : 'Unassigned';
              const extraContributors = Math.max(0, contributors.length - 3);
              const badgeText = getTaskSummaryBadge(changeSet);
              const diagnosticMessages = changeSet
                ? getTaskChangeDiagnosticMessages(changeSet)
                : [];

              if (visibleFiles.length === 0 && !summary.error && diagnosticMessages.length === 0) {
                return null;
              }

              return (
                <div
                  key={summary.taskId}
                  className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg-secondary)]"
                >
                  <button
                    type="button"
                    className="flex w-full min-w-0 items-center gap-2 rounded-t-md px-2 py-1.5 text-left transition-colors hover:bg-[var(--color-surface-raised)]"
                    onClick={() => onViewChanges(task.id)}
                  >
                    <span className="shrink-0 font-mono text-[10px] text-[var(--color-text-muted)]">
                      #{deriveTaskDisplayId(task.id)}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-xs font-medium text-[var(--color-text)]">
                      {task.subject}
                    </span>
                    <span
                      className="hidden max-w-[180px] shrink-0 truncate text-[10px] text-[var(--color-text-muted)] sm:inline"
                      title={contributors.join(', ')}
                    >
                      {contributorLabel}
                      {extraContributors > 0 ? ` +${extraContributors}` : ''}
                    </span>
                    {badgeText ? (
                      <span className="shrink-0 rounded bg-[var(--color-bg-tertiary)] px-1.5 py-0.5 text-[10px] text-[var(--color-text-muted)]">
                        {badgeText}
                      </span>
                    ) : null}
                  </button>

                  {summary.error ? (
                    <div className="flex items-center gap-2 border-t border-[var(--color-border)] px-2 py-1.5 text-xs text-red-400">
                      <AlertTriangle size={13} className="shrink-0" />
                      <span className="min-w-0 truncate">{summary.error}</span>
                    </div>
                  ) : null}

                  {diagnosticMessages.length ? (
                    <div className="space-y-1 border-t border-[var(--color-border)] px-2 py-1.5">
                      {diagnosticMessages.slice(0, 2).map((message) => (
                        <div
                          key={message}
                          className={`flex items-center gap-2 text-xs ${
                            reviewability === 'attention_required'
                              ? 'text-[var(--step-warning-text)]'
                              : 'text-[var(--color-text-muted)]'
                          }`}
                        >
                          {reviewability === 'attention_required' ? (
                            <AlertTriangle size={13} className="shrink-0" />
                          ) : (
                            <Info size={13} className="shrink-0" />
                          )}
                          <span className="min-w-0 truncate">{message}</span>
                        </div>
                      ))}
                    </div>
                  ) : null}

                  {visibleFiles.length > 0 ? (
                    <div className="border-t border-[var(--color-border)] py-0.5">
                      {visibleFiles.map((file) => (
                        <div
                          key={`${summary.taskId}:${file.filePath}`}
                          className="group flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs transition-colors hover:bg-[var(--color-surface-raised)]"
                        >
                          <FileIcon fileName={getVisibleFileName(file)} className="size-3.5" />
                          <button
                            type="button"
                            className="min-w-0 flex-1 truncate text-left font-mono text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text)]"
                            onClick={() => onViewChanges(task.id, file.filePath)}
                            title={getVisibleFilePath(file)}
                          >
                            {getVisibleFilePath(file)}
                          </button>
                          <span className="flex shrink-0 items-center gap-1.5">
                            {file.linesAdded > 0 ? (
                              <span className="text-emerald-400">+{file.linesAdded}</span>
                            ) : null}
                            {file.linesRemoved > 0 ? (
                              <span className="text-red-400">-{file.linesRemoved}</span>
                            ) : null}
                          </span>
                          <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button
                                  type="button"
                                  className="rounded p-1 text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-border-emphasis)] hover:text-[var(--color-text)]"
                                  onClick={() => onViewChanges(task.id, file.filePath)}
                                  aria-label="Review diff"
                                >
                                  <GitCompareArrows size={13} />
                                </button>
                              </TooltipTrigger>
                              <TooltipContent side="top">Review diff</TooltipContent>
                            </Tooltip>
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : null}

                  {files.length > visibleFiles.length && fileBudget > 0 ? (
                    <div className="border-t border-[var(--color-border)] px-2 py-1.5 text-xs text-[var(--color-text-muted)]">
                      {files.length - visibleFiles.length} more files
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-2 text-[10px] text-[var(--color-text-muted)]">
            {loading || refreshing ? (
              <span className="inline-flex items-center gap-1">
                <Loader2 size={11} className="animate-spin" />
                Refreshing
              </span>
            ) : null}
            {error ? <span className="text-red-400">Refresh failed: {error}</span> : null}
            {hiddenFileRows > 0 ? <span>{hiddenFileRows} file rows hidden</span> : null}
            {stats.deferredCount > 0 ? (
              <span>{stats.deferredCount} tasks deferred this pass</span>
            ) : null}
          </div>
        </div>
      ) : loading || refreshing ? (
        <div className="flex items-center gap-2 py-2 text-xs text-[var(--color-text-muted)]">
          <Loader2 size={14} className="animate-spin" />
          {loading ? 'Loading changes...' : 'Refreshing changes...'}
        </div>
      ) : error ? (
        <p className="text-xs text-red-400">{error}</p>
      ) : (
        <div className="space-y-1 py-1">
          <p className="text-xs text-[var(--color-text-muted)]">No file changes recorded</p>
          {stats.eligibleCount > 0 ? (
            <p className="text-[10px] text-[var(--color-text-muted)]">
              Scanned {stats.requestedCount} of {stats.eligibleCount} candidate tasks
            </p>
          ) : null}
        </div>
      )}
    </CollapsibleTeamSection>
  );
});

TeamChangesSection.displayName = 'TeamChangesSection';
