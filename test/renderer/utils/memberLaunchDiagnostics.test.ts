import { describe, expect, it } from 'vitest';

import {
  buildMemberLaunchDiagnosticsPayload,
  formatMemberLaunchDiagnosticsPayload,
  hasMemberLaunchDiagnosticsDetails,
  hasMemberLaunchDiagnosticsError,
  getMemberLaunchDiagnosticsErrorMessage,
} from '@renderer/utils/memberLaunchDiagnostics';

describe('member launch diagnostics', () => {
  it('builds a bounded copy payload from spawn and runtime evidence', () => {
    const payload = buildMemberLaunchDiagnosticsPayload({
      teamName: 'demo-team',
      runId: 'run-42',
      memberName: 'bob',
      spawnEntry: {
        status: 'waiting',
        launchState: 'runtime_pending_bootstrap',
        runtimeAlive: false,
        bootstrapConfirmed: false,
        hardFailure: false,
        agentToolAccepted: true,
        livenessKind: 'shell_only',
        livenessSource: 'process',
        runtimeDiagnostic: 'tmux pane foreground command is zsh',
        runtimeDiagnosticSeverity: 'warning',
        updatedAt: '2026-04-24T12:00:00.000Z',
      },
      runtimeEntry: {
        memberName: 'bob',
        alive: false,
        restartable: true,
        pid: 26676,
        pidSource: 'tmux_pane',
        paneId: '%42',
        panePid: 26676,
        paneCurrentCommand: 'zsh',
        processCommand: 'node runtime --token super-secret --team-name demo-team',
        diagnostics: ['tmux pane foreground command is zsh', 'no runtime child found'],
        updatedAt: '2026-04-24T12:00:01.000Z',
      },
    });

    expect(payload).toMatchObject({
      teamName: 'demo-team',
      runId: 'run-42',
      memberName: 'bob',
      launchState: 'runtime_pending_bootstrap',
      spawnStatus: 'waiting',
      livenessKind: 'shell_only',
      pid: 26676,
      pidSource: 'tmux_pane',
      paneCurrentCommand: 'zsh',
      runtimeDiagnostic: 'tmux pane foreground command is zsh',
      runtimeDiagnosticSeverity: 'warning',
    });
    expect(payload.processCommand).toContain('--token [redacted]');
    expect(payload.processCommand).not.toContain('super-secret');
    expect(payload.diagnostics).toEqual([
      'tmux pane foreground command is zsh',
      'no runtime child found',
    ]);
    expect(hasMemberLaunchDiagnosticsDetails(payload)).toBe(true);
    expect(formatMemberLaunchDiagnosticsPayload(payload)).toContain('"livenessKind": "shell_only"');
  });

  it('includes the exact normalized member card error in copy diagnostics', () => {
    const payload = buildMemberLaunchDiagnosticsPayload({
      memberName: 'jack',
      spawnEntry: {
        status: 'error',
        launchState: 'failed_to_start',
        hardFailure: true,
        hardFailureReason:
          'Latest assistant message msg_123 failed with APIError - OpenCode quota exhausted. Visit https://openrouter.ai/settings/keys',
        runtimeDiagnostic: 'persisted runtime pid is not alive',
        runtimeDiagnosticSeverity: 'error',
        updatedAt: '2026-05-08T12:00:00.000Z',
      },
    });

    expect(payload.memberCardError).toBe(
      'OpenCode quota exhausted. Visit https://openrouter.ai/settings/keys'
    );
    expect(payload.diagnostics?.[0]).toBe(
      'OpenCode quota exhausted. Visit https://openrouter.ai/settings/keys'
    );
    expect(getMemberLaunchDiagnosticsErrorMessage(payload)).toBe(
      'OpenCode quota exhausted. Visit https://openrouter.ai/settings/keys'
    );
    expect(formatMemberLaunchDiagnosticsPayload(payload)).toContain('"memberCardError"');
  });

  it('includes runtime advisory evidence in copy diagnostics', () => {
    const payload = buildMemberLaunchDiagnosticsPayload({
      memberName: 'alice',
      runtimeAdvisoryLabel: 'OpenCode delivery error',
      runtimeAdvisoryTitle: 'OpenCode accepted the prompt, but no assistant turn was recorded.',
      runtimeAdvisory: {
        kind: 'api_error',
        observedAt: '2026-05-17T22:11:38.239Z',
        reasonCode: 'backend_error',
        message: 'OpenCode accepted the prompt, but no assistant turn was recorded.',
      },
    });

    expect(payload.memberCardError).toBe(
      'OpenCode accepted the prompt, but no assistant turn was recorded.'
    );
    expect(payload.runtimeAdvisoryKind).toBe('api_error');
    expect(payload.runtimeAdvisoryReasonCode).toBe('backend_error');
    expect(payload.diagnostics).toContain(
      'OpenCode accepted the prompt, but no assistant turn was recorded.'
    );
    expect(hasMemberLaunchDiagnosticsDetails(payload)).toBe(true);
  });

  it('does not turn healthy info liveness diagnostics into member card errors', () => {
    const payload = buildMemberLaunchDiagnosticsPayload({
      teamName: 'atlas-hq-5',
      runId: '5a9ee2e5-a8cb-4559-b624-0dbf13ee4d11',
      memberName: 'atlas',
      spawnEntry: {
        status: 'online',
        launchState: 'confirmed_alive',
        runtimeAlive: true,
        bootstrapConfirmed: true,
        hardFailure: false,
        agentToolAccepted: true,
        livenessKind: 'runtime_process',
        livenessSource: 'heartbeat',
        runtimeDiagnostic: 'OpenCode runtime process detected after bootstrap confirmation',
        runtimeDiagnosticSeverity: 'info',
        updatedAt: '2026-05-18T08:13:23.902Z',
      },
      runtimeEntry: {
        memberName: 'atlas',
        providerId: 'opencode',
        alive: true,
        restartable: false,
        livenessKind: 'runtime_process',
        runtimeDiagnostic: 'OpenCode runtime process detected after bootstrap confirmation',
        runtimeDiagnosticSeverity: 'info',
        diagnostics: [
          'OpenCode runtime process detected after bootstrap confirmation',
          'matched OpenCode runtime pid and process identity',
          'bootstrap confirmed',
        ],
        updatedAt: '2026-05-18T08:34:47.845Z',
      },
    });

    expect(payload.memberCardError).toBeUndefined();
    expect(payload.runtimeDiagnostic).toBe(
      'OpenCode runtime process detected after bootstrap confirmation'
    );
    expect(payload.runtimeDiagnosticSeverity).toBe('info');
    expect(payload.diagnostics).toContain(
      'OpenCode runtime process detected after bootstrap confirmation'
    );
  });

  it('does not turn info runtime diagnostics into member card errors even on terminal launch state', () => {
    const payload = buildMemberLaunchDiagnosticsPayload({
      memberName: 'atlas',
      spawnEntry: {
        status: 'error',
        launchState: 'failed_to_start',
        hardFailure: true,
        runtimeDiagnostic: 'OpenCode runtime process detected after bootstrap confirmation',
        runtimeDiagnosticSeverity: 'info',
        updatedAt: '2026-05-18T08:13:23.902Z',
      },
      runtimeEntry: {
        memberName: 'atlas',
        providerId: 'opencode',
        alive: true,
        restartable: false,
        runtimeDiagnostic: 'OpenCode runtime process detected after bootstrap confirmation',
        runtimeDiagnosticSeverity: 'info',
        updatedAt: '2026-05-18T08:34:47.845Z',
      },
    });

    expect(payload.memberCardError).toBeUndefined();
    expect(payload.runtimeDiagnosticSeverity).toBe('info');
  });

  it('prefers advisory errors over healthy info liveness diagnostics', () => {
    const payload = buildMemberLaunchDiagnosticsPayload({
      memberName: 'atlas',
      runtimeAdvisoryLabel: 'OpenCode delivery error',
      runtimeAdvisoryTitle:
        'OpenCode runtime delivery error. OpenCode accepted the prompt, but no assistant turn was recorded.',
      spawnEntry: {
        status: 'online',
        launchState: 'confirmed_alive',
        runtimeAlive: true,
        bootstrapConfirmed: true,
        hardFailure: false,
        livenessKind: 'runtime_process',
        runtimeDiagnostic: 'OpenCode runtime process detected after bootstrap confirmation',
        runtimeDiagnosticSeverity: 'info',
        updatedAt: '2026-05-18T08:13:23.902Z',
      },
      runtimeAdvisory: {
        kind: 'api_error',
        observedAt: '2026-05-18T08:31:46.075Z',
        reasonCode: 'backend_error',
        message: 'OpenCode accepted the prompt, but no assistant turn was recorded.',
      },
    });

    expect(payload.memberCardError).toBe(
      'OpenCode runtime delivery error. OpenCode accepted the prompt, but no assistant turn was recorded.'
    );
    expect(payload.memberCardError).not.toBe(
      'OpenCode runtime process detected after bootstrap confirmation'
    );
  });

  it('does not surface recoverable OpenCode session refresh advisory as card error', () => {
    const payload = buildMemberLaunchDiagnosticsPayload({
      memberName: 'tom',
      member: { name: 'tom', providerId: 'opencode' },
      runtimeAdvisoryLabel: 'OpenCode session refresh',
      runtimeAdvisoryTitle:
        'OpenCode session changed; refreshing the session before retry.',
      spawnEntry: {
        status: 'online',
        launchState: 'confirmed_alive',
        runtimeAlive: true,
        bootstrapConfirmed: true,
        hardFailure: false,
        runtimeDiagnostic: 'OpenCode runtime process detected after bootstrap confirmation',
        runtimeDiagnosticSeverity: 'info',
        updatedAt: '2026-05-18T08:13:23.902Z',
      },
      runtimeAdvisory: {
        kind: 'api_error',
        observedAt: '2026-05-18T08:31:46.075Z',
        reasonCode: 'backend_error',
        message: 'OpenCode session changed; refreshing the session before retry.',
      },
    });

    expect(payload.memberCardError).toBeUndefined();
    expect(payload.diagnostics).toContain(
      'OpenCode session changed; refreshing the session before retry.'
    );
  });

  it('does not surface recoverable OpenCode transport refresh advisory as card error', () => {
    const payload = buildMemberLaunchDiagnosticsPayload({
      memberName: 'tom',
      member: { name: 'tom', providerId: 'opencode' },
      runtimeAdvisoryLabel: 'OpenCode session refresh',
      runtimeAdvisoryTitle: 'OpenCode session changed; refreshing the session before retry.',
      runtimeAdvisory: {
        kind: 'api_error',
        observedAt: '2026-05-18T08:31:46.075Z',
        reasonCode: 'backend_error',
        message: 'opencode_app_mcp_transport_changed:old->new',
      },
    });

    expect(payload.memberCardError).toBeUndefined();
  });

  it('does not surface legacy OpenCode refresh scheduled advisory as card error', () => {
    const payload = buildMemberLaunchDiagnosticsPayload({
      memberName: 'tom',
      member: { name: 'tom', providerId: 'opencode' },
      runtimeAdvisoryLabel: 'OpenCode session refresh',
      runtimeAdvisoryTitle: 'OpenCode session changed; refreshing the session before retry.',
      runtimeAdvisory: {
        kind: 'api_error',
        observedAt: '2026-05-18T08:31:46.075Z',
        reasonCode: 'backend_error',
        message: 'opencode_prompt_delivery_session_refresh_scheduled',
      },
    });

    expect(payload.memberCardError).toBeUndefined();
    expect(hasMemberLaunchDiagnosticsError(payload)).toBe(false);
  });

  it('suppresses generic OpenCode advisory card errors when clean refresh evidence is present', () => {
    const payload = buildMemberLaunchDiagnosticsPayload({
      memberName: 'tom',
      member: { name: 'tom', providerId: 'opencode' },
      runtimeAdvisoryLabel: 'OpenCode API error',
      runtimeAdvisoryTitle: 'OpenCode API error',
      runtimeAdvisory: {
        kind: 'api_error',
        observedAt: '2026-05-18T08:31:46.075Z',
        reasonCode: 'backend_error',
        message: 'OpenCode API error',
      },
      runtimeEntry: {
        memberName: 'tom',
        providerId: 'opencode',
        alive: true,
        restartable: false,
        diagnostics: ['resolved_behavior_changed:old->new'],
        updatedAt: '2026-05-18T08:34:47.845Z',
      },
    });

    expect(payload.memberCardError).toBeUndefined();
    expect(hasMemberLaunchDiagnosticsError(payload)).toBe(false);
  });

  it('does not treat OpenCode response-state names inside refresh markers as card errors', () => {
    const payload = buildMemberLaunchDiagnosticsPayload({
      memberName: 'tom',
      member: { name: 'tom', providerId: 'opencode' },
      spawnEntry: {
        status: 'error',
        launchState: 'failed_to_start',
        hardFailure: true,
        error: 'OpenCode API error. resolved_behavior_changed:permission_blocked->pending',
        hardFailureReason: 'OpenCode API error',
        runtimeDiagnostic:
          'resolved_behavior_changed:responded_non_visible_tool->pending',
        runtimeDiagnosticSeverity: 'error',
        updatedAt: '2026-05-18T08:13:23.902Z',
      },
      runtimeEntry: {
        memberName: 'tom',
        providerId: 'opencode',
        alive: true,
        restartable: false,
        runtimeDiagnostic:
          'resolved_behavior_changed:responded_non_visible_tool->pending',
        runtimeDiagnosticSeverity: 'error',
        diagnostics: ['resolved_behavior_changed:tool_error->session_error'],
        updatedAt: '2026-05-18T08:34:47.845Z',
      },
    });

    expect(payload.memberCardError).toBeUndefined();
    expect(hasMemberLaunchDiagnosticsError(payload)).toBe(false);
  });

  it('does not treat multiple clean OpenCode refresh markers in one diagnostic as card errors', () => {
    const payload = buildMemberLaunchDiagnosticsPayload({
      memberName: 'tom',
      member: { name: 'tom', providerId: 'opencode' },
      spawnEntry: {
        status: 'error',
        launchState: 'failed_to_start',
        hardFailure: true,
        error:
          'OpenCode API error. resolved_behavior_changed:old->new opencode_app_mcp_transport_changed:a->b',
        runtimeDiagnostic:
          'resolved_behavior_changed:old->new opencode_app_mcp_transport_changed:a->b',
        runtimeDiagnosticSeverity: 'error',
        updatedAt: '2026-05-18T08:13:23.902Z',
      },
    });

    expect(payload.memberCardError).toBeUndefined();
    expect(hasMemberLaunchDiagnosticsError(payload)).toBe(false);
  });

  it('does not surface recoverable OpenCode refresh text from stale spawn errors as card error', () => {
    const payload = buildMemberLaunchDiagnosticsPayload({
      memberName: 'tom',
      spawnEntry: {
        status: 'error',
        launchState: 'failed_to_start',
        hardFailure: true,
        error: 'OpenCode API error. resolved_behavior_changed:old->new',
        hardFailureReason: 'OpenCode API error',
        runtimeDiagnostic: 'opencode_app_mcp_transport_changed:old->new',
        runtimeDiagnosticSeverity: 'error',
        updatedAt: '2026-05-18T08:13:23.902Z',
      },
      runtimeEntry: {
        memberName: 'tom',
        providerId: 'opencode',
        alive: true,
        restartable: false,
        runtimeDiagnostic:
          'opencode_session_refresh_scheduled_after_resolved_behavior_changed',
        runtimeDiagnosticSeverity: 'error',
        diagnostics: ['resolved_behavior_changed:old->new'],
        updatedAt: '2026-05-18T08:34:47.845Z',
      },
    });

    expect(payload.memberCardError).toBeUndefined();
    expect(payload.diagnostics).toContain('resolved_behavior_changed:old->new');
    expect(payload.diagnosticHints).toBeUndefined();
    expect(payload.probableCause).toBeUndefined();
    expect(hasMemberLaunchDiagnosticsError(payload)).toBe(false);
    expect(getMemberLaunchDiagnosticsErrorMessage(payload)).toBeUndefined();
  });

  it('treats parenthesized clean OpenCode refresh markers as recoverable UI diagnostics', () => {
    const payload = buildMemberLaunchDiagnosticsPayload({
      memberName: 'tom',
      member: { name: 'tom', providerId: 'opencode' },
      spawnEntry: {
        status: 'error',
        launchState: 'failed_to_start',
        hardFailure: true,
        error: 'OpenCode API error. (resolved_behavior_changed:old->new)',
        hardFailureReason: 'OpenCode API error:',
        runtimeDiagnostic: '(opencode_app_mcp_transport_changed:old->new)',
        runtimeDiagnosticSeverity: 'error',
        updatedAt: '2026-05-18T08:13:23.902Z',
      },
    });

    expect(payload.memberCardError).toBeUndefined();
    expect(hasMemberLaunchDiagnosticsError(payload)).toBe(false);
    expect(getMemberLaunchDiagnosticsErrorMessage(payload)).toBeUndefined();
  });

  it('keeps malformed generic OpenCode API error prefixes as card errors', () => {
    const payload = buildMemberLaunchDiagnosticsPayload({
      memberName: 'tom',
      member: { name: 'tom', providerId: 'opencode' },
      spawnEntry: {
        status: 'error',
        launchState: 'failed_to_start',
        hardFailure: true,
        error: 'OpenCode API errorresolved_behavior_changed:old->new',
        runtimeDiagnostic: 'opencode_app_mcp_transport_changed:old->new',
        runtimeDiagnosticSeverity: 'error',
        updatedAt: '2026-05-18T08:13:23.902Z',
      },
    });

    expect(payload.memberCardError).toBe(
      'OpenCode API errorresolved_behavior_changed:old->new'
    );
    expect(hasMemberLaunchDiagnosticsError(payload)).toBe(true);
  });

  it('suppresses card error when all stale spawn failure fields are recoverable refresh diagnostics', () => {
    const payload = buildMemberLaunchDiagnosticsPayload({
      memberName: 'tom',
      member: { name: 'tom', providerId: 'opencode' },
      spawnEntry: {
        status: 'error',
        launchState: 'failed_to_start',
        hardFailure: true,
        error: 'OpenCode API error. resolved_behavior_changed:old->new',
        hardFailureReason:
          'opencode_session_refresh_scheduled_after_resolved_behavior_changed',
        runtimeDiagnostic: 'opencode_app_mcp_transport_changed:old->new',
        runtimeDiagnosticSeverity: 'error',
        updatedAt: '2026-05-18T08:13:23.902Z',
      },
    });

    expect(payload.memberCardError).toBeUndefined();
    expect(payload.diagnostics).toContain(
      'OpenCode API error. resolved_behavior_changed:old->new'
    );
    expect(payload.diagnosticHints).toBeUndefined();
    expect(hasMemberLaunchDiagnosticsError(payload)).toBe(false);
  });

  it('uses runtime diagnostics as refresh evidence without turning them into card errors', () => {
    const payload = buildMemberLaunchDiagnosticsPayload({
      memberName: 'tom',
      spawnEntry: {
        status: 'error',
        launchState: 'failed_to_start',
        hardFailure: true,
        error: 'OpenCode API error',
        updatedAt: '2026-05-18T08:13:23.902Z',
      },
      runtimeEntry: {
        memberName: 'tom',
        providerId: 'opencode',
        alive: true,
        restartable: false,
        diagnostics: [
          'resolved_behavior_changed:old->new',
          'matched OpenCode runtime pid and process identity',
        ],
        updatedAt: '2026-05-18T08:34:47.845Z',
      },
    });

    expect(payload.memberCardError).toBeUndefined();
    expect(payload.diagnostics).toContain('resolved_behavior_changed:old->new');
    expect(payload.memberCardError).not.toBe(
      'matched OpenCode runtime pid and process identity'
    );
  });

  it('uses suppressed spawn runtime diagnostics as refresh evidence for generic OpenCode API errors', () => {
    const payload = buildMemberLaunchDiagnosticsPayload({
      memberName: 'tom',
      member: { name: 'tom', providerId: 'opencode' },
      spawnEntry: {
        status: 'error',
        launchState: 'failed_to_start',
        hardFailure: true,
        error: 'OpenCode API error',
        runtimeDiagnostic: 'opencode_app_mcp_transport_changed:old->new',
        runtimeDiagnosticSeverity: 'error',
        updatedAt: '2026-05-18T08:13:23.902Z',
      },
    });

    expect(payload.memberCardError).toBeUndefined();
    expect(hasMemberLaunchDiagnosticsError(payload)).toBe(false);
    expect(getMemberLaunchDiagnosticsErrorMessage(payload)).toBeUndefined();
  });

  it('does not suppress stale markers when separate evidence contains real failure details', () => {
    const payload = buildMemberLaunchDiagnosticsPayload({
      memberName: 'tom',
      member: { name: 'tom', providerId: 'opencode' },
      spawnEntry: {
        status: 'error',
        launchState: 'failed_to_start',
        hardFailure: true,
        error: 'session_stale',
        updatedAt: '2026-05-18T08:13:23.902Z',
      },
      runtimeEntry: {
        memberName: 'tom',
        providerId: 'opencode',
        alive: true,
        restartable: false,
        diagnostics: ['permission denied'],
        updatedAt: '2026-05-18T08:34:47.845Z',
      },
    });

    expect(payload.memberCardError).toBe('session_stale');
    expect(payload.diagnostics).toContain('permission denied');
    expect(hasMemberLaunchDiagnosticsError(payload)).toBe(true);
  });

  it('uses stale OpenCode log-projection diagnostics as refresh evidence without card errors', () => {
    const payload = buildMemberLaunchDiagnosticsPayload({
      memberName: 'tom',
      spawnEntry: {
        status: 'error',
        launchState: 'failed_to_start',
        hardFailure: true,
        error: 'OpenCode API error',
        updatedAt: '2026-05-18T08:13:23.902Z',
      },
      runtimeEntry: {
        memberName: 'tom',
        providerId: 'opencode',
        alive: true,
        restartable: false,
        diagnostics: [
          'OpenCode session is stale (resolved_behavior_changed:old->new); reading historical messages for log projection only',
        ],
        updatedAt: '2026-05-18T08:34:47.845Z',
      },
    });

    expect(payload.memberCardError).toBeUndefined();
    expect(hasMemberLaunchDiagnosticsError(payload)).toBe(false);
    expect(getMemberLaunchDiagnosticsErrorMessage(payload)).toBeUndefined();
  });

  it('keeps card error when stale refresh diagnostics include unknown extra text', () => {
    const payload = buildMemberLaunchDiagnosticsPayload({
      memberName: 'tom',
      spawnEntry: {
        status: 'error',
        launchState: 'failed_to_start',
        hardFailure: true,
        error: 'OpenCode API error',
        updatedAt: '2026-05-18T08:13:23.902Z',
      },
      runtimeEntry: {
        memberName: 'tom',
        providerId: 'opencode',
        alive: true,
        restartable: false,
        diagnostics: [
          'OpenCode session is stale (resolved_behavior_changed:old->new); unexpected detail',
        ],
        updatedAt: '2026-05-18T08:34:47.845Z',
      },
    });

    expect(payload.memberCardError).toBe('OpenCode API error');
    expect(hasMemberLaunchDiagnosticsError(payload)).toBe(true);
  });

  it('keeps card error when OpenCode API error includes non-refresh failure details', () => {
    const payload = buildMemberLaunchDiagnosticsPayload({
      memberName: 'tom',
      member: { name: 'tom', providerId: 'opencode' },
      spawnEntry: {
        status: 'error',
        launchState: 'failed_to_start',
        hardFailure: true,
        error: 'OpenCode API error. resolved_behavior_changed:old->new permission denied',
        runtimeDiagnostic: 'opencode_app_mcp_transport_changed:old->new',
        runtimeDiagnosticSeverity: 'error',
        updatedAt: '2026-05-18T08:13:23.902Z',
      },
    });

    expect(payload.memberCardError).toBe(
      'OpenCode API error. resolved_behavior_changed:old->new permission denied'
    );
    expect(payload.diagnosticHints).toContain(
      'Launch state is terminal for this run; restart/relaunch is required after fixing the cause.'
    );
  });

  it('keeps card error when OpenCode API error includes unknown refresh details', () => {
    const payload = buildMemberLaunchDiagnosticsPayload({
      memberName: 'tom',
      member: { name: 'tom', providerId: 'opencode' },
      spawnEntry: {
        status: 'error',
        launchState: 'failed_to_start',
        hardFailure: true,
        error: 'OpenCode API error. resolved_behavior_changed:old->new unexpected detail',
        runtimeDiagnostic: 'opencode_app_mcp_transport_changed:old->new',
        runtimeDiagnosticSeverity: 'error',
        updatedAt: '2026-05-18T08:13:23.902Z',
      },
    });

    expect(payload.memberCardError).toBe(
      'OpenCode API error. resolved_behavior_changed:old->new unexpected detail'
    );
    expect(hasMemberLaunchDiagnosticsError(payload)).toBe(true);
  });

  it('keeps card error when refresh marker has colon-suffixed failure details', () => {
    const payload = buildMemberLaunchDiagnosticsPayload({
      memberName: 'tom',
      member: { name: 'tom', providerId: 'opencode' },
      spawnEntry: {
        status: 'error',
        launchState: 'failed_to_start',
        hardFailure: true,
        error: 'OpenCode API error. resolved_behavior_changed:old->new:permission_denied',
        runtimeDiagnostic: 'opencode_app_mcp_transport_changed:old->new',
        runtimeDiagnosticSeverity: 'error',
        updatedAt: '2026-05-18T08:13:23.902Z',
      },
    });

    expect(payload.memberCardError).toBe(
      'OpenCode API error. resolved_behavior_changed:old->new:permission_denied'
    );
    expect(hasMemberLaunchDiagnosticsError(payload)).toBe(true);
  });

  it.each(['permission_denied', 'error', 'failed', 'failure', 'aborted', 'canceled', 'cancelled', 'interrupted', 'enospc'])(
    'keeps card error when refresh marker directly consumes failure-looking suffix _%s',
    (suffix) => {
      const error = `OpenCode API error. resolved_behavior_changed:old->new_${suffix}`;
      const payload = buildMemberLaunchDiagnosticsPayload({
        memberName: 'tom',
        member: { name: 'tom', providerId: 'opencode' },
        spawnEntry: {
          status: 'error',
          launchState: 'failed_to_start',
          hardFailure: true,
          error,
          runtimeDiagnostic: 'opencode_app_mcp_transport_changed:old->new',
          runtimeDiagnosticSeverity: 'error',
          updatedAt: '2026-05-18T08:13:23.902Z',
        },
      });

      expect(payload.memberCardError).toBe(error);
      expect(hasMemberLaunchDiagnosticsError(payload)).toBe(true);
    }
  );

  it.each([
    'resolved_behavior_changed:old->new/auth_unavailable',
    'resolved_behavior_changed:old->new permission denied',
    'resolved_behavior_changed:old->new permission_blocked',
    'resolved_behavior_changed:old->new login required',
    'resolved_behavior_changed:old->new not logged in',
    'resolved_behavior_changed:old->new missing credentials',
    'resolved_behavior_changed:old->new access denied',
    'resolved_behavior_changed:old->new 401',
    'resolved_behavior_changed:old->new;key limit exceeded',
    'resolved_behavior_changed:old->new-network_timeout',
    'resolved_behavior_changed:old->new interrupted',
    'resolved_behavior_changed:old->new(non_visible_tool_without_task_progress)',
    'opencode_app_mcp_transport_changed:old->new/permission_denied',
    'opencode_app_mcp_transport_changed:old->new;visible_reply_missing_task_refs',
  ])('keeps card error for separator-attached failure detail %s', (detail) => {
    const error = `OpenCode API error. ${detail}`;
    const payload = buildMemberLaunchDiagnosticsPayload({
      memberName: 'tom',
      member: { name: 'tom', providerId: 'opencode' },
      spawnEntry: {
        status: 'error',
        launchState: 'failed_to_start',
        hardFailure: true,
        error,
        runtimeDiagnostic: 'opencode_app_mcp_transport_changed:old->new',
        runtimeDiagnosticSeverity: 'error',
        updatedAt: '2026-05-18T08:13:23.902Z',
      },
    });

    expect(payload.memberCardError).toBe(error);
    expect(hasMemberLaunchDiagnosticsError(payload)).toBe(true);
  });

  it('suppresses card error when refresh marker suffix is clean', () => {
    const payload = buildMemberLaunchDiagnosticsPayload({
      memberName: 'tom',
      member: { name: 'tom', providerId: 'opencode' },
      spawnEntry: {
        status: 'error',
        launchState: 'failed_to_start',
        hardFailure: true,
        error: 'OpenCode API error. resolved_behavior_changed:old->new',
        runtimeDiagnostic: 'opencode_app_mcp_transport_changed:old->new',
        runtimeDiagnosticSeverity: 'error',
        updatedAt: '2026-05-18T08:13:23.902Z',
      },
    });

    expect(payload.memberCardError).toBeUndefined();
    expect(hasMemberLaunchDiagnosticsError(payload)).toBe(false);
  });

  it('keeps card error when failure details are attached to a refresh marker with punctuation', () => {
    const payload = buildMemberLaunchDiagnosticsPayload({
      memberName: 'tom',
      member: { name: 'tom', providerId: 'opencode' },
      spawnEntry: {
        status: 'error',
        launchState: 'failed_to_start',
        hardFailure: true,
        error: 'OpenCode API error. resolved_behavior_changed:old->new;permission_denied',
        runtimeDiagnostic: 'opencode_app_mcp_transport_changed:old->new',
        runtimeDiagnosticSeverity: 'error',
        updatedAt: '2026-05-18T08:13:23.902Z',
      },
    });

    expect(payload.memberCardError).toBe(
      'OpenCode API error. resolved_behavior_changed:old->new;permission_denied'
    );
    expect(payload.diagnosticHints).toContain(
      'Launch state is terminal for this run; restart/relaunch is required after fixing the cause.'
    );
  });

  it('keeps generic card error when diagnostics mention refresh plus real failure details', () => {
    const payload = buildMemberLaunchDiagnosticsPayload({
      memberName: 'tom',
      spawnEntry: {
        status: 'error',
        launchState: 'failed_to_start',
        hardFailure: true,
        error: 'OpenCode API error',
        updatedAt: '2026-05-18T08:13:23.902Z',
      },
      runtimeEntry: {
        memberName: 'tom',
        providerId: 'opencode',
        alive: true,
        restartable: false,
        diagnostics: ['resolved_behavior_changed:old->new permission denied'],
        updatedAt: '2026-05-18T08:34:47.845Z',
      },
    });

    expect(payload.memberCardError).toBe('OpenCode API error');
    expect(payload.diagnosticHints).toContain(
      'Launch state is terminal for this run; restart/relaunch is required after fixing the cause.'
    );
  });

  it('keeps generic card error when clean refresh diagnostics are mixed with separate failure details', () => {
    const payload = buildMemberLaunchDiagnosticsPayload({
      memberName: 'tom',
      spawnEntry: {
        status: 'error',
        launchState: 'failed_to_start',
        hardFailure: true,
        error: 'OpenCode API error',
        updatedAt: '2026-05-18T08:13:23.902Z',
      },
      runtimeEntry: {
        memberName: 'tom',
        providerId: 'opencode',
        alive: true,
        restartable: false,
        diagnostics: ['resolved_behavior_changed:old->new', 'permission denied'],
        updatedAt: '2026-05-18T08:34:47.845Z',
      },
    });

    expect(payload.memberCardError).toBe('OpenCode API error');
    expect(payload.diagnostics).toContain('permission denied');
    expect(payload.diagnosticHints).toContain(
      'Launch state is terminal for this run; restart/relaunch is required after fixing the cause.'
    );
  });

  it('keeps generic card error when clean refresh diagnostics are mixed with network failure details', () => {
    const payload = buildMemberLaunchDiagnosticsPayload({
      memberName: 'tom',
      spawnEntry: {
        status: 'error',
        launchState: 'failed_to_start',
        hardFailure: true,
        error: 'OpenCode API error',
        updatedAt: '2026-05-18T08:13:23.902Z',
      },
      runtimeEntry: {
        memberName: 'tom',
        providerId: 'opencode',
        alive: true,
        restartable: false,
        diagnostics: ['resolved_behavior_changed:old->new', 'network timeout'],
        updatedAt: '2026-05-18T08:34:47.845Z',
      },
    });

    expect(payload.memberCardError).toBe('OpenCode API error');
    expect(payload.diagnostics).toContain('network timeout');
    expect(hasMemberLaunchDiagnosticsError(payload)).toBe(true);
  });

  it('keeps generic card error when clean refresh diagnostics are mixed with auth failure details', () => {
    const payload = buildMemberLaunchDiagnosticsPayload({
      memberName: 'tom',
      spawnEntry: {
        status: 'error',
        launchState: 'failed_to_start',
        hardFailure: true,
        error: 'OpenCode API error',
        updatedAt: '2026-05-18T08:13:23.902Z',
      },
      runtimeEntry: {
        memberName: 'tom',
        providerId: 'opencode',
        alive: true,
        restartable: false,
        diagnostics: ['resolved_behavior_changed:old->new', 'auth_unavailable'],
        updatedAt: '2026-05-18T08:34:47.845Z',
      },
    });

    expect(payload.memberCardError).toBe('OpenCode API error');
    expect(payload.diagnostics).toContain('auth_unavailable');
    expect(hasMemberLaunchDiagnosticsError(payload)).toBe(true);
  });

  it('keeps generic card error when clean refresh diagnostics are mixed with permission-blocked details', () => {
    const payload = buildMemberLaunchDiagnosticsPayload({
      memberName: 'tom',
      spawnEntry: {
        status: 'error',
        launchState: 'failed_to_start',
        hardFailure: true,
        error: 'OpenCode API error',
        updatedAt: '2026-05-18T08:13:23.902Z',
      },
      runtimeEntry: {
        memberName: 'tom',
        providerId: 'opencode',
        alive: true,
        restartable: false,
        diagnostics: ['resolved_behavior_changed:old->new', 'permission_blocked'],
        updatedAt: '2026-05-18T08:34:47.845Z',
      },
    });

    expect(payload.memberCardError).toBe('OpenCode API error');
    expect(payload.diagnostics).toContain('permission_blocked');
    expect(hasMemberLaunchDiagnosticsError(payload)).toBe(true);
  });

  it('keeps generic card error when clean refresh diagnostics are mixed with quota failure details', () => {
    const payload = buildMemberLaunchDiagnosticsPayload({
      memberName: 'tom',
      spawnEntry: {
        status: 'error',
        launchState: 'failed_to_start',
        hardFailure: true,
        error: 'OpenCode API error',
        updatedAt: '2026-05-18T08:13:23.902Z',
      },
      runtimeEntry: {
        memberName: 'tom',
        providerId: 'opencode',
        alive: true,
        restartable: false,
        diagnostics: [
          'resolved_behavior_changed:old->new',
          'Key limit exceeded (total limit). Manage it using OpenRouter settings.',
        ],
        updatedAt: '2026-05-18T08:34:47.845Z',
      },
    });

    expect(payload.memberCardError).toBe('OpenCode API error');
    expect(payload.diagnostics).toContain(
      'Key limit exceeded (total limit). Manage it using OpenRouter settings.'
    );
    expect(hasMemberLaunchDiagnosticsError(payload)).toBe(true);
  });

  it('keeps generic card error when stale log-projection diagnostics include protocol failure details', () => {
    const payload = buildMemberLaunchDiagnosticsPayload({
      memberName: 'tom',
      spawnEntry: {
        status: 'error',
        launchState: 'failed_to_start',
        hardFailure: true,
        error: 'OpenCode API error',
        updatedAt: '2026-05-18T08:13:23.902Z',
      },
      runtimeEntry: {
        memberName: 'tom',
        providerId: 'opencode',
        alive: true,
        restartable: false,
        diagnostics: [
          'OpenCode session is stale (resolved_behavior_changed:old->new); visible_reply_missing_task_refs',
        ],
        updatedAt: '2026-05-18T08:34:47.845Z',
      },
    });

    expect(payload.memberCardError).toBe('OpenCode API error');
    expect(payload.diagnostics).toContain(
      'OpenCode session is stale (resolved_behavior_changed:old->new); visible_reply_missing_task_refs'
    );
    expect(hasMemberLaunchDiagnosticsError(payload)).toBe(true);
  });

  it('keeps action-required runtime advisory errors even when the message looks like refresh evidence', () => {
    const payload = buildMemberLaunchDiagnosticsPayload({
      memberName: 'tom',
      member: { name: 'tom', providerId: 'opencode' },
      runtimeAdvisoryLabel: 'OpenCode quota error',
      runtimeAdvisoryTitle: 'OpenCode quota exhausted.',
      runtimeAdvisory: {
        kind: 'api_error',
        observedAt: '2026-05-18T08:31:46.075Z',
        reasonCode: 'quota_exhausted',
        message: 'resolved_behavior_changed:old->new',
      },
    });

    expect(payload.memberCardError).toBe('OpenCode quota exhausted.');
    expect(payload.runtimeAdvisoryReasonCode).toBe('quota_exhausted');
    expect(payload.diagnostics).toContain('OpenCode quota exhausted.');
  });

  it('does not suppress non-OpenCode runtime diagnostics that look like refresh markers', () => {
    const payload = buildMemberLaunchDiagnosticsPayload({
      memberName: 'claude',
      member: { name: 'claude', providerId: 'anthropic' },
      spawnEntry: {
        status: 'error',
        launchState: 'failed_to_start',
        hardFailure: true,
        error: 'session_stale',
        runtimeDiagnostic: 'resolved_behavior_changed:old->new',
        runtimeDiagnosticSeverity: 'error',
        updatedAt: '2026-05-18T08:13:23.902Z',
      },
    });

    expect(payload.memberCardError).toBe('session_stale');
    expect(payload.diagnostics).toContain('resolved_behavior_changed:old->new');
    expect(payload.diagnosticHints).toContain(
      'Launch state is terminal for this run; restart/relaunch is required after fixing the cause.'
    );
  });

  it('does not suppress non-OpenCode advisory errors that look like session refresh', () => {
    const payload = buildMemberLaunchDiagnosticsPayload({
      memberName: 'claude',
      member: { name: 'claude', providerId: 'anthropic' },
      runtimeAdvisoryLabel: 'Anthropic API error',
      runtimeAdvisoryTitle: 'Anthropic API error.\n\nresolved_behavior_changed:old->new',
      runtimeAdvisory: {
        kind: 'api_error',
        observedAt: '2026-05-18T08:31:46.075Z',
        reasonCode: 'backend_error',
        message: 'resolved_behavior_changed:old->new',
      },
    });

    expect(payload.memberCardError).toBe('Anthropic API error. resolved_behavior_changed:old->new');
    expect(payload.diagnostics).toContain(
      'Anthropic API error. resolved_behavior_changed:old->new'
    );
  });
});
