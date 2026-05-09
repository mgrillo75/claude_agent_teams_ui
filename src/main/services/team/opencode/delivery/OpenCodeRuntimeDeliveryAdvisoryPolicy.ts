import {
  isActionRequiredOpenCodeRuntimeDeliveryReason,
  normalizeOpenCodeRuntimeDeliveryDiagnostic,
  selectOpenCodeRuntimeDeliveryReason,
} from './OpenCodeRuntimeDeliveryDiagnostics';

import type { OpenCodePromptDeliveryLedgerRecord } from './OpenCodePromptDeliveryLedger';
import type {
  MemberRuntimeAdvisory,
  OpenCodeRuntimeDeliveryUserVisibleImpact,
} from '@shared/types';

export const OPENCODE_RUNTIME_DELIVERY_GENERIC_PROOF_GRACE_MS = 120_000;

export interface OpenCodeRuntimeDeliveryProofSnapshot {
  latestSuccessAt?: number;
  visibleReplyAt?: number;
  visibleReplyMessageId?: string;
  visibleReplyInbox?: string;
  taskProgressAt?: number;
}

export type OpenCodeRuntimeDeliveryAdvisoryAction = 'suppress' | 'defer' | 'surface';
export type OpenCodeRuntimeDeliveryAdvisorySeverity = 'warning' | 'error';

export interface OpenCodeRuntimeDeliveryAdvisoryDecision {
  action: OpenCodeRuntimeDeliveryAdvisoryAction;
  reason?: string;
  reasonCode?: MemberRuntimeAdvisory['reasonCode'];
  severity?: OpenCodeRuntimeDeliveryAdvisorySeverity;
  observedAt?: string;
  nextReviewAt?: string;
}

const QUOTA_EXHAUSTED_TOKENS = [
  'exhausted your capacity',
  'capacity exceeded',
  'quota exceeded',
  'quota exhausted',
  'insufficient credits',
  'key limit exceeded',
  'total limit',
] as const;
const RATE_LIMITED_TOKENS = [
  'rate limit',
  'too many requests',
  '429',
  'model cooldown',
  'cooling down',
] as const;
const AUTH_ERROR_TOKENS = [
  'auth_unavailable',
  'no auth available',
  'authentication_failed',
  'unauthorized',
  'forbidden',
  'invalid api key',
  'authentication',
  'api key',
  'does not have access',
  'please run /login',
] as const;
const CODEX_NATIVE_TIMEOUT_TOKENS = ['codex native exec timed out'] as const;
const NETWORK_ERROR_TOKENS = [
  'timeout',
  'timed out',
  'network',
  'connection',
  'econn',
  'enotfound',
  'fetch failed',
] as const;
const PROVIDER_OVERLOADED_TOKENS = [
  'overloaded',
  'temporarily unavailable',
  'service unavailable',
  '503',
] as const;
const PROTOCOL_PROOF_MISSING_TOKENS = [
  'non_visible_tool_without_task_progress',
  'visible_reply_still_required',
  'visible_reply_ack_only_still_requires_answer',
  'plain_text_ack_only_still_requires_answer',
  'visible_reply_destination_not_found_yet',
  'visible_reply_missing_relayofmessageid',
  'visible_reply_missing_task_refs',
  'visible_reply_missing_task_refs_after_merge',
  'visible_reply_task_refs_merge_failed',
  'did not create a visible reply',
  'did not create a visible message_send reply',
  'did not create a visible reply or task progress proof',
  'without the required relayofmessageid correlation',
  'without the required taskrefs metadata',
  'could not be verified',
  'no visible reply has been found yet',
] as const;
const DEFERRED_GENERIC_DELIVERY_TOKENS = [
  ...PROTOCOL_PROOF_MISSING_TOKENS,
  'empty_assistant_turn',
  'empty assistant turn',
  'prompt_delivered_no_assistant_message',
  'accepted the prompt, but no assistant turn was recorded',
  'opencode runtime delivery did not complete',
  'opencode message delivery observe bridge failed',
  'opencode bridge command timed out',
  'opencode app mcp was reattached before message delivery',
  'reattached stale opencode app mcp server',
  'recreated opencode session before message delivery',
  'opencode session reconcile skipped because the stored session is stale',
] as const;

const HARD_RUNTIME_RESPONSE_STATES = new Set([
  'session_error',
  'tool_error',
  'permission_blocked',
  'reconcile_failed',
]);

function includesAnyToken(value: string, tokens: readonly string[]): boolean {
  return tokens.some((token) => value.includes(token));
}

function normalizeForClassification(message: string | null | undefined): string {
  return normalizeOpenCodeRuntimeDeliveryDiagnostic(message)?.toLowerCase() ?? '';
}

export function classifyOpenCodeRuntimeDeliveryReasonCode(
  message: string | undefined
): MemberRuntimeAdvisory['reasonCode'] {
  const normalized = normalizeForClassification(message);
  if (!normalized) {
    return 'unknown';
  }
  if (includesAnyToken(normalized, QUOTA_EXHAUSTED_TOKENS)) {
    return 'quota_exhausted';
  }
  if (includesAnyToken(normalized, RATE_LIMITED_TOKENS)) {
    return 'rate_limited';
  }
  if (includesAnyToken(normalized, AUTH_ERROR_TOKENS)) {
    return 'auth_error';
  }
  if (includesAnyToken(normalized, CODEX_NATIVE_TIMEOUT_TOKENS)) {
    return 'codex_native_timeout';
  }
  if (includesAnyToken(normalized, NETWORK_ERROR_TOKENS)) {
    return 'network_error';
  }
  if (includesAnyToken(normalized, PROVIDER_OVERLOADED_TOKENS)) {
    return 'provider_overloaded';
  }
  if (includesAnyToken(normalized, PROTOCOL_PROOF_MISSING_TOKENS)) {
    return 'protocol_proof_missing';
  }
  return 'backend_error';
}

export function getOpenCodeRuntimeDeliveryRecordTimeMs(
  record: OpenCodePromptDeliveryLedgerRecord
): number {
  const candidates = [
    record.failedAt,
    record.respondedAt,
    record.lastObservedAt,
    record.updatedAt,
    record.createdAt,
  ];
  for (const candidate of candidates) {
    const time = Date.parse(candidate ?? '');
    if (Number.isFinite(time)) {
      return time;
    }
  }
  return 0;
}

export function getOpenCodeRuntimeDeliveryPromptTimeMs(
  record: OpenCodePromptDeliveryLedgerRecord
): number {
  const candidates = [record.inboxTimestamp, record.acceptedAt, record.createdAt, record.updatedAt];
  for (const candidate of candidates) {
    const time = Date.parse(candidate ?? '');
    if (Number.isFinite(time)) {
      return time;
    }
  }
  return getOpenCodeRuntimeDeliveryRecordTimeMs(record);
}

export function isTerminalSuccessfulOpenCodeDeliveryRecord(
  record: OpenCodePromptDeliveryLedgerRecord
): boolean {
  return (
    record.status === 'responded' &&
    Boolean(record.inboxReadCommittedAt || record.visibleReplyMessageId)
  );
}

export function isPotentialOpenCodeRuntimeDeliveryError(
  record: OpenCodePromptDeliveryLedgerRecord
): boolean {
  if (record.status === 'failed_terminal') {
    return true;
  }
  return (
    record.status !== 'responded' &&
    (record.responseState === 'session_error' ||
      record.responseState === 'tool_error' ||
      record.responseState === 'permission_blocked' ||
      record.responseState === 'reconcile_failed')
  );
}

export function isProofOnlyOpenCodeRuntimeDeliveryReason(
  reason: string | null | undefined
): boolean {
  return (
    classifyOpenCodeRuntimeDeliveryReasonCode(reason ?? undefined) === 'protocol_proof_missing'
  );
}

export function isDeferredGenericOpenCodeRuntimeDeliveryReason(
  reason: string | null | undefined
): boolean {
  const normalized = normalizeForClassification(reason);
  return Boolean(normalized) && includesAnyToken(normalized, DEFERRED_GENERIC_DELIVERY_TOKENS);
}

export function isHardOpenCodeRuntimeDeliveryReason(input: {
  record: OpenCodePromptDeliveryLedgerRecord;
  reason: string | null | undefined;
}): boolean {
  if (isActionRequiredOpenCodeRuntimeDeliveryReason(input.reason)) {
    return true;
  }
  if (input.record.status !== 'failed_terminal') {
    return input.record.responseState === 'permission_blocked';
  }
  if (isDeferredGenericOpenCodeRuntimeDeliveryReason(input.reason)) {
    return false;
  }
  if (input.record.responseState && HARD_RUNTIME_RESPONSE_STATES.has(input.record.responseState)) {
    return true;
  }
  return (
    classifyOpenCodeRuntimeDeliveryReasonCode(input.reason ?? undefined) !==
    'protocol_proof_missing'
  );
}

export function hasSupersedingOpenCodeRuntimeDeliveryProof(input: {
  record: OpenCodePromptDeliveryLedgerRecord;
  proof?: OpenCodeRuntimeDeliveryProofSnapshot | null;
}): boolean {
  const proof = input.proof;
  if (!proof) {
    return false;
  }
  const recordTime = getOpenCodeRuntimeDeliveryRecordTimeMs(input.record);
  if (typeof proof.latestSuccessAt === 'number' && proof.latestSuccessAt > recordTime) {
    return true;
  }
  if (typeof proof.visibleReplyAt === 'number' && proof.visibleReplyAt > 0) {
    return true;
  }
  if (typeof proof.taskProgressAt === 'number' && proof.taskProgressAt > 0) {
    return true;
  }
  return false;
}

export function decideOpenCodeRuntimeDeliveryAdvisory(input: {
  record: OpenCodePromptDeliveryLedgerRecord;
  proof?: OpenCodeRuntimeDeliveryProofSnapshot | null;
  now?: number;
  graceMs?: number;
}): OpenCodeRuntimeDeliveryAdvisoryDecision {
  const reason = selectOpenCodeRuntimeDeliveryReason(input.record);
  if (!reason) {
    return { action: 'suppress' };
  }
  if (hasSupersedingOpenCodeRuntimeDeliveryProof(input)) {
    return { action: 'suppress' };
  }

  const now = input.now ?? Date.now();
  const graceMs = input.graceMs ?? OPENCODE_RUNTIME_DELIVERY_GENERIC_PROOF_GRACE_MS;
  const recordTime = getOpenCodeRuntimeDeliveryRecordTimeMs(input.record);
  const observedAt = new Date(
    Number.isFinite(recordTime) && recordTime > 0 ? recordTime : now
  ).toISOString();
  const reasonCode = classifyOpenCodeRuntimeDeliveryReasonCode(reason);

  if (isHardOpenCodeRuntimeDeliveryReason({ record: input.record, reason })) {
    return {
      action: 'surface',
      severity: 'error',
      reason,
      reasonCode,
      observedAt,
    };
  }

  if (input.record.status !== 'failed_terminal') {
    return { action: 'suppress' };
  }

  if (
    reasonCode === 'protocol_proof_missing' ||
    isDeferredGenericOpenCodeRuntimeDeliveryReason(reason)
  ) {
    const terminalAt = getOpenCodeRuntimeDeliveryRecordTimeMs(input.record);
    const nextReviewAtMs =
      Number.isFinite(terminalAt) && terminalAt > 0 ? terminalAt + graceMs : now + graceMs;
    if (now < nextReviewAtMs) {
      return {
        action: 'defer',
        reason,
        reasonCode,
        observedAt,
        nextReviewAt: new Date(nextReviewAtMs).toISOString(),
      };
    }
    return {
      action: 'surface',
      severity: reasonCode === 'protocol_proof_missing' ? 'warning' : 'error',
      reason,
      reasonCode,
      observedAt,
    };
  }

  return {
    action: 'surface',
    severity: 'error',
    reason,
    reasonCode,
    observedAt,
  };
}

export function toOpenCodeRuntimeDeliveryUserVisibleImpact(
  decision: OpenCodeRuntimeDeliveryAdvisoryDecision
): OpenCodeRuntimeDeliveryUserVisibleImpact {
  if (decision.action === 'suppress') {
    return { state: 'none' };
  }
  if (decision.action === 'defer') {
    return {
      state: 'checking',
      reasonCode: decision.reasonCode,
      message: decision.reason,
      observedAt: decision.observedAt,
      nextReviewAt: decision.nextReviewAt,
    };
  }
  return {
    state: decision.severity === 'warning' ? 'warning' : 'error',
    reasonCode: decision.reasonCode,
    message: decision.reason,
    observedAt: decision.observedAt,
    nextReviewAt: decision.nextReviewAt,
  };
}
