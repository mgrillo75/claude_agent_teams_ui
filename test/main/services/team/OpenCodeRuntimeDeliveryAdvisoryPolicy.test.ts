import { describe, expect, it } from 'vitest';

import {
  decideOpenCodeRuntimeDeliveryAdvisory,
  OPENCODE_RUNTIME_DELIVERY_GENERIC_PROOF_GRACE_MS,
} from '../../../../src/main/services/team/opencode/delivery/OpenCodeRuntimeDeliveryAdvisoryPolicy';

import type { OpenCodePromptDeliveryLedgerRecord } from '../../../../src/main/services/team/opencode/delivery/OpenCodePromptDeliveryLedger';

function makeRecord(
  overrides: Partial<OpenCodePromptDeliveryLedgerRecord>
): OpenCodePromptDeliveryLedgerRecord {
  const now = '2026-05-09T12:00:00.000Z';
  return {
    id: 'opencode-prompt:test',
    teamName: 'team',
    memberName: 'jack',
    laneId: 'secondary:opencode:jack',
    runId: 'run-1',
    runtimeSessionId: 'session-1',
    inboxMessageId: 'msg-1',
    inboxTimestamp: now,
    source: 'ui-send',
    messageKind: null,
    replyRecipient: 'user',
    actionMode: null,
    taskRefs: [],
    payloadHash: 'sha256:test',
    status: 'failed_terminal',
    responseState: 'empty_assistant_turn',
    attempts: 3,
    maxAttempts: 3,
    acceptanceUnknown: false,
    nextAttemptAt: null,
    lastAttemptAt: now,
    lastObservedAt: now,
    acceptedAt: now,
    respondedAt: now,
    failedAt: now,
    inboxReadCommittedAt: null,
    inboxReadCommitError: null,
    prePromptCursor: null,
    postPromptCursor: null,
    deliveredUserMessageId: 'delivered-1',
    observedAssistantMessageId: null,
    observedAssistantPreview: null,
    observedToolCallNames: [],
    observedVisibleMessageId: null,
    visibleReplyMessageId: null,
    visibleReplyInbox: null,
    visibleReplyCorrelation: null,
    lastReason: 'empty_assistant_turn',
    diagnostics: ['empty_assistant_turn'],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('OpenCodeRuntimeDeliveryAdvisoryPolicy', () => {
  it('defers fresh generic terminal failures for proof observation', () => {
    const record = makeRecord({});

    const decision = decideOpenCodeRuntimeDeliveryAdvisory({
      record,
      now: Date.parse(record.failedAt!) + 1_000,
    });

    expect(decision).toMatchObject({
      action: 'defer',
      reasonCode: 'backend_error',
      nextReviewAt: new Date(
        Date.parse(record.failedAt!) + OPENCODE_RUNTIME_DELIVERY_GENERIC_PROOF_GRACE_MS
      ).toISOString(),
    });
  });

  it('surfaces action-required failures immediately', () => {
    const record = makeRecord({
      responseState: 'permission_blocked',
      lastReason: 'authentication_failed',
      diagnostics: ['authentication_failed'],
    });

    expect(
      decideOpenCodeRuntimeDeliveryAdvisory({
        record,
        now: Date.parse(record.failedAt!) + 1_000,
      })
    ).toMatchObject({
      action: 'surface',
      severity: 'error',
      reasonCode: 'auth_error',
    });
  });

  it('suppresses generic retryable tool errors before terminal failure', () => {
    const record = makeRecord({
      status: 'failed_retryable',
      responseState: 'tool_error',
      failedAt: null,
      nextAttemptAt: '2026-05-09T12:00:30.000Z',
      lastReason: 'opencode bridge command timed out',
      diagnostics: ['opencode bridge command timed out'],
    });

    expect(
      decideOpenCodeRuntimeDeliveryAdvisory({
        record,
        now: Date.parse(record.updatedAt) + 1_000,
      })
    ).toMatchObject({ action: 'suppress' });
  });

  it('surfaces permission-blocked retryable failures before terminal failure', () => {
    const record = makeRecord({
      status: 'failed_retryable',
      responseState: 'permission_blocked',
      failedAt: null,
      nextAttemptAt: '2026-05-09T12:00:30.000Z',
      lastReason: 'authentication_failed',
      diagnostics: ['authentication_failed'],
    });

    expect(
      decideOpenCodeRuntimeDeliveryAdvisory({
        record,
        now: Date.parse(record.updatedAt) + 1_000,
      })
    ).toMatchObject({
      action: 'surface',
      severity: 'error',
      reasonCode: 'auth_error',
    });
  });

  it('suppresses terminal failures when visible proof already exists', () => {
    const record = makeRecord({});

    expect(
      decideOpenCodeRuntimeDeliveryAdvisory({
        record,
        proof: {
          visibleReplyAt: Date.parse(record.failedAt!) + 1_000,
          visibleReplyMessageId: 'reply-1',
          visibleReplyInbox: 'user',
        },
        now: Date.parse(record.failedAt!) + OPENCODE_RUNTIME_DELIVERY_GENERIC_PROOF_GRACE_MS + 1,
      })
    ).toMatchObject({ action: 'suppress' });
  });
});
