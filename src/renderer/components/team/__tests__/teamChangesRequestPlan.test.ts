import { describe, expect, it } from 'vitest';

import {
  buildTeamChangeRequestPlan,
  buildTeamChangesTasksFingerprint,
  TEAM_CHANGES_UNKNOWN_SCAN_LIMIT,
} from '../teamChangesRequestPlan';

import type { TeamTaskWithKanban } from '@shared/types';

function task(overrides: Partial<TeamTaskWithKanban> & { id: string }): TeamTaskWithKanban {
  const { id, subject, status, ...rest } = overrides;
  return {
    id,
    subject: subject ?? `Task ${id}`,
    status: status ?? 'pending',
    ...rest,
  };
}

describe('buildTeamChangeRequestPlan', () => {
  it('scans unknown pending tasks only when they have work evidence', () => {
    const plan = buildTeamChangeRequestPlan(
      [
        task({ id: 'plain-pending', status: 'pending', changePresence: 'unknown' }),
        task({
          id: 'worked-pending',
          status: 'pending',
          changePresence: 'unknown',
          workIntervals: [{ startedAt: '2026-05-09T08:00:00.000Z' }],
        }),
      ],
      0,
      false
    );

    expect(plan.requests.map((request) => request.taskId)).toEqual(['worked-pending']);
    expect([...plan.eligibleTaskIds]).toEqual(['worked-pending']);
  });

  it('keeps known changed tasks even when they are currently pending', () => {
    const plan = buildTeamChangeRequestPlan(
      [task({ id: 'known-changed', status: 'pending', changePresence: 'has_changes' })],
      0,
      false
    );

    expect(plan.requests.map((request) => request.taskId)).toEqual(['known-changed']);
    expect(plan.eligibleTaskIds.has('known-changed')).toBe(true);
  });

  it('rotates unknown scans and preserves summary-only request options', () => {
    const tasks = Array.from({ length: TEAM_CHANGES_UNKNOWN_SCAN_LIMIT + 4 }, (_, index) =>
      task({
        id: `task-${index}`,
        status: 'completed',
        changePresence: 'unknown',
        updatedAt: `2026-05-09T08:${String(index).padStart(2, '0')}:00.000Z`,
      })
    );

    const firstPass = buildTeamChangeRequestPlan(tasks, 0, true);
    const secondPass = buildTeamChangeRequestPlan(tasks, firstPass.nextUnknownScanCursor, false);

    expect(firstPass.requests).toHaveLength(TEAM_CHANGES_UNKNOWN_SCAN_LIMIT);
    expect(firstPass.requests[0].options?.summaryOnly).toBe(true);
    expect(firstPass.requests[0].options?.forceFresh).toBe(true);
    expect(secondPass.requests[0].taskId).toBe('task-3');
  });

  it('changes fingerprint when review state changes without timestamp changes', () => {
    const baseTask = task({
      id: 'reviewing',
      status: 'completed',
      changePresence: 'unknown',
      updatedAt: '2026-05-09T08:00:00.000Z',
      reviewState: 'none',
    });

    expect(buildTeamChangesTasksFingerprint([baseTask])).not.toBe(
      buildTeamChangesTasksFingerprint([{ ...baseTask, reviewState: 'review' }])
    );
  });

  it('keeps fingerprint stable for task reorder and irrelevant history events', () => {
    const first = task({
      id: 'task-a',
      status: 'pending',
      historyEvents: [
        {
          id: 'event-created',
          type: 'task_created',
          timestamp: '2026-05-09T08:00:00.000Z',
          status: 'pending',
        },
        {
          id: 'event-owner',
          type: 'owner_changed',
          timestamp: '2026-05-09T08:01:00.000Z',
          from: 'alice',
          to: 'bob',
        },
      ],
    });
    const second = task({
      id: 'task-b',
      status: 'completed',
      historyEvents: [
        {
          id: 'event-status',
          type: 'status_changed',
          timestamp: '2026-05-09T08:02:00.000Z',
          from: 'in_progress',
          to: 'completed',
        },
      ],
    });

    expect(buildTeamChangesTasksFingerprint([first, second])).toBe(
      buildTeamChangesTasksFingerprint([
        second,
        {
          ...first,
          historyEvents: [
            ...(first.historyEvents ?? []),
            {
              id: 'event-owner-2',
              type: 'owner_changed',
              timestamp: '2026-05-09T08:03:00.000Z',
              from: 'bob',
              to: 'carol',
            },
          ],
        },
      ])
    );
  });
});
