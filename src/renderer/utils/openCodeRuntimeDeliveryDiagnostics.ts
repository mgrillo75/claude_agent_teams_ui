import type { SendMessageResult } from '@shared/types';

export interface OpenCodeRuntimeDeliveryDebugDetails {
  messageId: string;
  statusMessageId?: string;
  providerId: string;
  delivered: boolean | null;
  responsePending: boolean | null;
  responseState: string | null;
  ledgerStatus: string | null;
  visibleReplyMessageId?: string | null;
  visibleReplyCorrelation?: string | null;
  queuedBehindMessageId?: string | null;
  acceptanceUnknown: boolean | null;
  reason: string | null;
  diagnostics: string[];
  userVisibleState?: string | null;
  userVisibleReasonCode?: string | null;
  userVisibleMessage?: string | null;
  userVisibleNextReviewAt?: string | null;
}

interface OpenCodeRuntimeDeliveryDiagnostics {
  warning: string | null;
  debugDetails: OpenCodeRuntimeDeliveryDebugDetails | null;
}

const PENDING_WARNING =
  'OpenCode delivery is still being checked. Message was saved and will be observed before retry if needed.';
const PROOF_WARNING =
  'OpenCode reply could not be verified. Message was saved to inbox, but no visible reply or task progress proof was found.';
const FAILED_WARNING =
  'OpenCode runtime delivery failed. Message was saved to inbox, but live delivery did not complete.';

function formatOpenCodeRuntimeDeliveryFailureReason(reason: string | null | undefined): string {
  const normalized = reason?.trim();
  if (!normalized) {
    return '';
  }
  const normalizedLower = normalized.toLowerCase();
  if (normalizedLower === 'empty_assistant_turn') {
    return 'OpenCode returned an empty assistant turn.';
  }
  if (normalizedLower === 'prompt_delivered_no_assistant_message') {
    return 'OpenCode accepted the prompt, but no assistant turn was recorded.';
  }
  if (
    normalizedLower === 'visible_reply_still_required' ||
    normalizedLower === 'visible_reply_ack_only_still_requires_answer' ||
    normalizedLower === 'plain_text_ack_only_still_requires_answer'
  ) {
    return 'OpenCode responded, but did not create a visible message_send reply.';
  }
  if (
    normalizedLower === 'visible_reply_destination_not_found_yet' ||
    normalizedLower === 'visible_reply_missing_relayofmessageid'
  ) {
    return 'OpenCode created a reply without the required relayOfMessageId correlation.';
  }
  if (normalizedLower === 'visible_reply_missing_task_refs') {
    return 'OpenCode created a reply without the required taskRefs metadata.';
  }
  if (normalizedLower === 'visible_reply_missing_task_refs_after_merge') {
    return 'OpenCode created a reply without the required taskRefs metadata.';
  }
  if (normalizedLower === 'visible_reply_task_refs_merge_failed') {
    return 'OpenCode created a reply without the required taskRefs metadata, and the app could not attach it automatically.';
  }
  if (normalizedLower === 'non_visible_tool_without_task_progress') {
    return 'OpenCode used tools, but did not create a visible reply or task progress proof.';
  }
  return '';
}

export function buildOpenCodeRuntimeDeliveryDiagnostics(
  result: SendMessageResult
): OpenCodeRuntimeDeliveryDiagnostics {
  const runtimeDelivery = result.runtimeDelivery;
  if (runtimeDelivery?.attempted !== true) {
    return { warning: null, debugDetails: null };
  }

  const userVisibleState = runtimeDelivery.userVisibleImpact?.state;
  const isFailed =
    userVisibleState === 'error' || (!userVisibleState && runtimeDelivery.delivered === false);
  const isWarning = userVisibleState === 'warning';
  const isPending =
    userVisibleState === 'checking' ||
    (!userVisibleState && runtimeDelivery.responsePending === true);
  if (!isFailed && !isPending) {
    if (!isWarning) {
      return { warning: null, debugDetails: null };
    }
  }

  const userVisibleMessage = runtimeDelivery.userVisibleImpact?.message?.trim();
  const failureReason =
    isFailed || isWarning
      ? formatOpenCodeRuntimeDeliveryFailureReason(
          userVisibleMessage ?? runtimeDelivery.reason ?? runtimeDelivery.diagnostics?.[0]
        )
      : '';
  const statusMessageId = runtimeDelivery.queuedBehindMessageId ?? result.messageId;

  return {
    warning:
      isWarning && failureReason
        ? `${PROOF_WARNING} Reason: ${failureReason}`
        : isWarning
          ? PROOF_WARNING
          : isFailed && failureReason
            ? `${FAILED_WARNING} Reason: ${failureReason}`
            : isFailed
              ? FAILED_WARNING
              : PENDING_WARNING,
    debugDetails: {
      messageId: result.messageId,
      statusMessageId,
      providerId: runtimeDelivery.providerId,
      delivered: typeof runtimeDelivery.delivered === 'boolean' ? runtimeDelivery.delivered : null,
      responsePending:
        typeof runtimeDelivery.responsePending === 'boolean'
          ? runtimeDelivery.responsePending
          : null,
      responseState: runtimeDelivery.responseState ?? null,
      ledgerStatus: runtimeDelivery.ledgerStatus ?? null,
      visibleReplyMessageId: runtimeDelivery.visibleReplyMessageId ?? null,
      visibleReplyCorrelation: runtimeDelivery.visibleReplyCorrelation ?? null,
      queuedBehindMessageId: runtimeDelivery.queuedBehindMessageId ?? null,
      acceptanceUnknown:
        typeof runtimeDelivery.acceptanceUnknown === 'boolean'
          ? runtimeDelivery.acceptanceUnknown
          : null,
      reason: runtimeDelivery.reason ?? null,
      diagnostics: runtimeDelivery.diagnostics ?? [],
      userVisibleState: runtimeDelivery.userVisibleImpact?.state ?? null,
      userVisibleReasonCode: runtimeDelivery.userVisibleImpact?.reasonCode ?? null,
      userVisibleMessage: runtimeDelivery.userVisibleImpact?.message ?? null,
      userVisibleNextReviewAt: runtimeDelivery.userVisibleImpact?.nextReviewAt ?? null,
    },
  };
}

export function isOpenCodeRuntimeDeliveryHardUxFailure(
  runtimeDelivery: SendMessageResult['runtimeDelivery'] | null | undefined
): boolean {
  if (runtimeDelivery?.attempted !== true) {
    return false;
  }
  const userVisibleState = runtimeDelivery.userVisibleImpact?.state;
  if (userVisibleState) {
    return userVisibleState === 'error';
  }
  return runtimeDelivery.delivered === false;
}

export function isOpenCodeRuntimeDeliveryHardUxFailureFromDebugDetails(
  details: OpenCodeRuntimeDeliveryDebugDetails | null | undefined
): boolean {
  if (!details) {
    return false;
  }
  if (details.userVisibleState) {
    return details.userVisibleState === 'error';
  }
  return details.delivered === false;
}

export function shouldClearPendingReplyForOpenCodeRuntimeDelivery(
  runtimeDelivery: SendMessageResult['runtimeDelivery'] | null | undefined
): boolean {
  if (runtimeDelivery?.attempted !== true) {
    return false;
  }
  const userVisibleState = runtimeDelivery.userVisibleImpact?.state;
  if (userVisibleState === 'warning' || userVisibleState === 'error') {
    return true;
  }
  if (userVisibleState === 'checking') {
    return false;
  }
  return runtimeDelivery.responsePending !== true;
}

export function formatOpenCodeRuntimeDeliveryDebugDetails(
  details: OpenCodeRuntimeDeliveryDebugDetails
): string {
  return JSON.stringify(
    {
      messageId: details.messageId,
      statusMessageId: details.statusMessageId,
      providerId: details.providerId,
      delivered: details.delivered,
      responsePending: details.responsePending,
      responseState: details.responseState,
      ledgerStatus: details.ledgerStatus,
      visibleReplyMessageId: details.visibleReplyMessageId,
      visibleReplyCorrelation: details.visibleReplyCorrelation,
      queuedBehindMessageId: details.queuedBehindMessageId,
      acceptanceUnknown: details.acceptanceUnknown,
      reason: details.reason,
      diagnostics: details.diagnostics,
      userVisibleState: details.userVisibleState,
      userVisibleReasonCode: details.userVisibleReasonCode,
      userVisibleMessage: details.userVisibleMessage,
      userVisibleNextReviewAt: details.userVisibleNextReviewAt,
    },
    null,
    2
  );
}
