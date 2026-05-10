import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { TooltipProvider } from '@renderer/components/ui/tooltip';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TEAM_CHANGES_LOAD_TIMEOUT_MS } from '../teamChangesLoadTimeout';
import { TeamChangesSection } from '../TeamChangesSection';
import { type TeamChangeSummaryState, useTeamChangesSummaries } from '../useTeamChangesSummaries';

import type {
  TaskChangeSetV2,
  TeamTaskChangeSummariesResponse,
  TeamTaskWithKanban,
} from '@shared/types';

const hoisted = vi.hoisted(() => ({
  getTeamTaskChangeSummaries: vi.fn(),
  recordTaskChangePresence: vi.fn(),
  setSelectedTeamTaskChangePresence: vi.fn(),
}));

vi.mock('@renderer/api', () => ({
  api: {
    review: {
      getTeamTaskChangeSummaries: hoisted.getTeamTaskChangeSummaries,
    },
  },
}));

vi.mock('@renderer/store', () => ({
  useStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      recordTaskChangePresence: hoisted.recordTaskChangePresence,
      setSelectedTeamTaskChangePresence: hoisted.setSelectedTeamTaskChangePresence,
    }),
}));

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function task(overrides: Partial<TeamTaskWithKanban> = {}): TeamTaskWithKanban {
  return {
    id: 'task-1',
    subject: 'Task 1',
    status: 'completed',
    owner: 'alice',
    createdAt: '2026-05-10T10:00:00.000Z',
    updatedAt: '2026-05-10T10:00:00.000Z',
    changePresence: 'unknown',
    ...overrides,
  };
}

function changeSet(taskId = 'task-1'): TaskChangeSetV2 {
  return {
    teamName: 'team-a',
    taskId,
    files: [],
    totalFiles: 0,
    totalLinesAdded: 0,
    totalLinesRemoved: 0,
    confidence: 'high',
    computedAt: '2026-05-10T10:00:00.000Z',
    scope: {
      taskId,
      memberName: 'alice',
      startLine: 0,
      endLine: 0,
      startTimestamp: '2026-05-10T10:00:00.000Z',
      endTimestamp: '2026-05-10T10:01:00.000Z',
      toolUseIds: [],
      filePaths: [],
      confidence: { tier: 1, label: 'high', reason: 'test' },
    },
    warnings: [],
  };
}

function fileChange(
  overrides: Partial<TaskChangeSetV2['files'][number]> = {}
): TaskChangeSetV2['files'][number] {
  return {
    filePath: '/repo/src/app.ts',
    relativePath: 'src/app.ts',
    snippets: [],
    linesAdded: 1,
    linesRemoved: 0,
    isNewFile: false,
    ...overrides,
  };
}

function response(summary: TaskChangeSetV2 = changeSet()): TeamTaskChangeSummariesResponse {
  return {
    teamName: 'team-a',
    computedAt: '2026-05-10T10:00:01.000Z',
    items: [{ taskId: 'task-1', changeSet: summary }],
  };
}

function malformedLegacyChangeSet(): TaskChangeSetV2 {
  return {
    ...changeSet(),
    files: undefined,
    scope: undefined,
    totalFiles: 1,
    warnings: ['legacy warning'],
  } as unknown as TaskChangeSetV2;
}

function malformedResponse(): TeamTaskChangeSummariesResponse {
  return {
    teamName: 'team-a',
    computedAt: '2026-05-10T10:00:01.000Z',
    items: undefined,
  } as unknown as TeamTaskChangeSummariesResponse;
}

function malformedItemResponse(): TeamTaskChangeSummariesResponse {
  return {
    teamName: 'team-a',
    computedAt: '2026-05-10T10:00:01.000Z',
    items: [
      {
        taskId: ' task-1 ',
        changeSet: 'not-a-change-set',
        error: { message: 'not a string' },
      },
    ],
  } as unknown as TeamTaskChangeSummariesResponse;
}

function incompleteChangeSetResponse(): TeamTaskChangeSummariesResponse {
  return {
    teamName: 'team-a',
    computedAt: '2026-05-10T10:00:01.000Z',
    items: [
      {
        taskId: 'task-1',
        changeSet: {
          teamName: 'team-a',
          taskId: 'task-1',
          files: [],
          warnings: [],
          confidence: 'high',
        },
      },
    ],
  } as unknown as TeamTaskChangeSummariesResponse;
}

function lowConfidenceFileResponse(): TeamTaskChangeSummariesResponse {
  return response({
    ...changeSet(),
    confidence: 'low',
    files: [fileChange()],
    totalFiles: 1,
    totalLinesAdded: 1,
  });
}

function invalidFileSummaryResponse(): TeamTaskChangeSummariesResponse {
  return response({
    ...changeSet(),
    confidence: 'low',
    files: [{} as TaskChangeSetV2['files'][number]],
    totalFiles: 1,
    totalLinesAdded: 1,
  });
}

interface HookSnapshot {
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  summariesByTaskId: Record<string, TeamChangeSummaryState>;
}

const HookHarness = ({
  tasks,
  onSnapshot,
}: {
  tasks: TeamTaskWithKanban[];
  onSnapshot: (snapshot: HookSnapshot) => void;
}): null => {
  const state = useTeamChangesSummaries({
    teamName: 'team-a',
    tasks,
    sectionOpen: true,
  });
  React.useEffect(() => {
    onSnapshot({
      loading: state.loading,
      refreshing: state.refreshing,
      error: state.error,
      summariesByTaskId: state.summariesByTaskId,
    });
  }, [onSnapshot, state.error, state.loading, state.refreshing, state.summariesByTaskId]);
  return null;
};

describe('useTeamChangesSummaries', () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount();
      });
    }
    container?.remove();
    container = null;
    root = null;
    vi.clearAllMocks();
  });

  it('does not keep initial loading stuck when tasks change during an active request', async () => {
    const first = createDeferred<TeamTaskChangeSummariesResponse>();
    const second = createDeferred<TeamTaskChangeSummariesResponse>();
    hoisted.getTeamTaskChangeSummaries
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    const snapshots: HookSnapshot[] = [];
    const onSnapshot = (snapshot: HookSnapshot): void => {
      snapshots.push(snapshot);
    };
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(React.createElement(HookHarness, { tasks: [task()], onSnapshot }));
    });

    expect(snapshots.at(-1)?.loading).toBe(true);

    await act(async () => {
      root?.render(
        React.createElement(HookHarness, {
          tasks: [task({ updatedAt: '2026-05-10T10:00:02.000Z' })],
          onSnapshot,
        })
      );
    });

    await act(async () => {
      first.resolve(response());
      await first.promise;
    });

    expect(hoisted.getTeamTaskChangeSummaries).toHaveBeenCalledTimes(2);
    expect(snapshots.at(-1)?.loading).toBe(false);
    expect(snapshots.at(-1)?.refreshing).toBe(true);
  });

  it('does not cache a stale active response when a newer task snapshot is queued', async () => {
    const first = createDeferred<TeamTaskChangeSummariesResponse>();
    const second = createDeferred<TeamTaskChangeSummariesResponse>();
    hoisted.getTeamTaskChangeSummaries
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    const snapshots: HookSnapshot[] = [];
    const onSnapshot = (snapshot: HookSnapshot): void => {
      snapshots.push(snapshot);
    };
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(React.createElement(HookHarness, { tasks: [task()], onSnapshot }));
    });

    await act(async () => {
      root?.render(
        React.createElement(HookHarness, {
          tasks: [task({ updatedAt: '2026-05-10T10:00:02.000Z' })],
          onSnapshot,
        })
      );
    });

    await act(async () => {
      first.resolve(
        response({
          ...changeSet(),
          files: [fileChange({ filePath: '/repo/src/stale.ts', relativePath: 'src/stale.ts' })],
          totalFiles: 1,
          totalLinesAdded: 1,
        })
      );
      await first.promise;
    });

    expect(hoisted.getTeamTaskChangeSummaries).toHaveBeenCalledTimes(2);
    expect(hoisted.recordTaskChangePresence).not.toHaveBeenCalled();
    expect(snapshots.at(-1)?.summariesByTaskId).toEqual({});

    await act(async () => {
      second.resolve(response());
      await second.promise;
    });

    expect(hoisted.recordTaskChangePresence).toHaveBeenCalledWith(
      'team-a',
      'task-1',
      expect.any(Object),
      'no_changes'
    );
    expect(hoisted.setSelectedTeamTaskChangePresence).toHaveBeenCalledWith(
      'team-a',
      'task-1',
      'no_changes'
    );
  });

  it('retries the initial load after React StrictMode effect remount replay', async () => {
    const first = createDeferred<TeamTaskChangeSummariesResponse>();
    const second = createDeferred<TeamTaskChangeSummariesResponse>();
    hoisted.getTeamTaskChangeSummaries
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    const snapshots: HookSnapshot[] = [];
    const onSnapshot = (snapshot: HookSnapshot): void => {
      snapshots.push(snapshot);
    };
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        React.createElement(
          React.StrictMode,
          null,
          React.createElement(HookHarness, { tasks: [task()], onSnapshot })
        )
      );
    });

    expect(hoisted.getTeamTaskChangeSummaries).toHaveBeenCalledTimes(2);

    await act(async () => {
      first.resolve(response());
      await first.promise;
    });

    expect(snapshots.at(-1)?.loading).toBe(true);

    await act(async () => {
      second.resolve(response());
      await second.promise;
    });

    expect(snapshots.at(-1)?.loading).toBe(false);
    expect(snapshots.at(-1)?.summariesByTaskId['task-1']?.changeSet?.taskId).toBe('task-1');
  });

  it('clears initial loading and reports an error when the batch request times out', async () => {
    vi.useFakeTimers();
    try {
      hoisted.getTeamTaskChangeSummaries.mockReturnValue(new Promise(() => undefined));

      const snapshots: HookSnapshot[] = [];
      const onSnapshot = (snapshot: HookSnapshot): void => {
        snapshots.push(snapshot);
      };
      container = document.createElement('div');
      document.body.appendChild(container);
      root = createRoot(container);

      await act(async () => {
        root?.render(React.createElement(HookHarness, { tasks: [task()], onSnapshot }));
      });

      expect(snapshots.at(-1)?.loading).toBe(true);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(TEAM_CHANGES_LOAD_TIMEOUT_MS);
      });

      expect(snapshots.at(-1)?.loading).toBe(false);
      expect(snapshots.at(-1)?.refreshing).toBe(false);
      expect(snapshots.at(-1)?.error).toBe('Team changes request timed out. Refresh to try again.');
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not immediately run a queued refresh after a request failure', async () => {
    const first = createDeferred<TeamTaskChangeSummariesResponse>();
    hoisted.getTeamTaskChangeSummaries.mockReturnValue(first.promise);

    const snapshots: HookSnapshot[] = [];
    const onSnapshot = (snapshot: HookSnapshot): void => {
      snapshots.push(snapshot);
    };
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(React.createElement(HookHarness, { tasks: [task()], onSnapshot }));
    });

    await act(async () => {
      root?.render(
        React.createElement(HookHarness, {
          tasks: [task({ updatedAt: '2026-05-10T10:00:02.000Z' })],
          onSnapshot,
        })
      );
    });

    await act(async () => {
      first.reject(new Error('boom'));
      await first.promise.catch(() => undefined);
      await Promise.resolve();
    });

    expect(hoisted.getTeamTaskChangeSummaries).toHaveBeenCalledTimes(1);
    expect(snapshots.at(-1)?.loading).toBe(false);
    expect(snapshots.at(-1)?.refreshing).toBe(false);
    expect(snapshots.at(-1)?.error).toBe('boom');
  });

  it('clears loading and reports an error for a malformed batch response', async () => {
    hoisted.getTeamTaskChangeSummaries.mockResolvedValue(malformedResponse());

    const snapshots: HookSnapshot[] = [];
    const onSnapshot = (snapshot: HookSnapshot): void => {
      snapshots.push(snapshot);
    };
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(React.createElement(HookHarness, { tasks: [task()], onSnapshot }));
      await Promise.resolve();
    });

    expect(snapshots.at(-1)?.loading).toBe(false);
    expect(snapshots.at(-1)?.refreshing).toBe(false);
    expect(snapshots.at(-1)?.error).toBe('Team changes response was malformed.');
    expect(snapshots.at(-1)?.summariesByTaskId).toEqual({});
  });

  it('normalizes malformed batch response items before storing summaries', async () => {
    hoisted.getTeamTaskChangeSummaries.mockResolvedValue(malformedItemResponse());

    const snapshots: HookSnapshot[] = [];
    const onSnapshot = (snapshot: HookSnapshot): void => {
      snapshots.push(snapshot);
    };
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(React.createElement(HookHarness, { tasks: [task()], onSnapshot }));
      await Promise.resolve();
    });

    expect(snapshots.at(-1)?.error).toBeNull();
    expect(snapshots.at(-1)?.summariesByTaskId['task-1']).toEqual({
      taskId: 'task-1',
      changeSet: null,
    });
    expect(hoisted.recordTaskChangePresence).not.toHaveBeenCalled();
  });

  it('does not cache presence for incomplete change summaries', async () => {
    hoisted.getTeamTaskChangeSummaries.mockResolvedValue(incompleteChangeSetResponse());

    const snapshots: HookSnapshot[] = [];
    const onSnapshot = (snapshot: HookSnapshot): void => {
      snapshots.push(snapshot);
    };
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(React.createElement(HookHarness, { tasks: [task()], onSnapshot }));
      await Promise.resolve();
    });

    expect(snapshots.at(-1)?.loading).toBe(false);
    expect(snapshots.at(-1)?.summariesByTaskId['task-1']?.changeSet).not.toBeNull();
    expect(hoisted.recordTaskChangePresence).not.toHaveBeenCalled();
    expect(hoisted.setSelectedTeamTaskChangePresence).not.toHaveBeenCalled();
  });

  it('caches has_changes for low-confidence summaries with safe file details', async () => {
    hoisted.getTeamTaskChangeSummaries.mockResolvedValue(lowConfidenceFileResponse());

    const snapshots: HookSnapshot[] = [];
    const onSnapshot = (snapshot: HookSnapshot): void => {
      snapshots.push(snapshot);
    };
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(React.createElement(HookHarness, { tasks: [task()], onSnapshot }));
      await Promise.resolve();
    });

    expect(snapshots.at(-1)?.summariesByTaskId['task-1']?.changeSet?.confidence).toBe('low');
    expect(hoisted.recordTaskChangePresence).toHaveBeenCalledWith(
      'team-a',
      'task-1',
      expect.any(Object),
      'has_changes'
    );
    expect(hoisted.setSelectedTeamTaskChangePresence).toHaveBeenCalledWith(
      'team-a',
      'task-1',
      'has_changes'
    );
  });

  it('does not cache presence for summaries with unsafe file details', async () => {
    hoisted.getTeamTaskChangeSummaries.mockResolvedValue(invalidFileSummaryResponse());

    const snapshots: HookSnapshot[] = [];
    const onSnapshot = (snapshot: HookSnapshot): void => {
      snapshots.push(snapshot);
    };
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(React.createElement(HookHarness, { tasks: [task()], onSnapshot }));
      await Promise.resolve();
    });

    expect(snapshots.at(-1)?.summariesByTaskId['task-1']?.changeSet).not.toBeNull();
    expect(hoisted.recordTaskChangePresence).not.toHaveBeenCalled();
    expect(hoisted.setSelectedTeamTaskChangePresence).not.toHaveBeenCalled();
  });

  it('renders legacy malformed summaries without crashing the section', async () => {
    hoisted.getTeamTaskChangeSummaries.mockResolvedValue(response(malformedLegacyChangeSet()));

    const scrollIntoViewDescriptor = Object.getOwnPropertyDescriptor(
      Element.prototype,
      'scrollIntoView'
    );
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(),
    });
    try {
      container = document.createElement('div');
      document.body.appendChild(container);
      root = createRoot(container);

      await act(async () => {
        root?.render(
          React.createElement(
            TooltipProvider,
            null,
            React.createElement(TeamChangesSection, {
              teamName: 'team-a',
              tasks: [task()],
              onViewChanges: vi.fn(),
            })
          )
        );
      });

      const expandButton = container.querySelector<HTMLButtonElement>(
        'button[aria-label="Expand section"]'
      );
      expect(expandButton).not.toBeNull();

      await act(async () => {
        expandButton?.click();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(container.textContent).toContain('legacy warning');
      expect(container.textContent).toContain(
        'The change summary reported one file without safe review details.'
      );
      expect(hoisted.recordTaskChangePresence).not.toHaveBeenCalled();
    } finally {
      if (scrollIntoViewDescriptor) {
        Object.defineProperty(Element.prototype, 'scrollIntoView', scrollIntoViewDescriptor);
      } else {
        delete (Element.prototype as { scrollIntoView?: Element['scrollIntoView'] }).scrollIntoView;
      }
    }
  });
});
