import { describe, expect, it } from 'vitest';

import { buildOpenCodeRuntimeDeliveryDiagnostics } from '../../../src/renderer/utils/openCodeRuntimeDeliveryDiagnostics';

describe('openCodeRuntimeDeliveryDiagnostics', () => {
  it('honors user-visible checking impact over raw terminal delivery facts', () => {
    const diagnostics = buildOpenCodeRuntimeDeliveryDiagnostics({
      deliveredToInbox: true,
      messageId: 'msg-empty',
      runtimeDelivery: {
        providerId: 'opencode',
        attempted: true,
        delivered: false,
        responsePending: false,
        responseState: 'empty_assistant_turn',
        ledgerStatus: 'failed_terminal',
        reason: 'empty_assistant_turn',
        diagnostics: ['empty_assistant_turn'],
        userVisibleImpact: {
          state: 'checking',
          reasonCode: 'backend_error',
          message: 'empty_assistant_turn',
          nextReviewAt: '2026-05-09T12:00:00.000Z',
        },
      },
    });

    expect(diagnostics.warning).toBe(
      'OpenCode delivery is still being checked. Message was saved and will be observed before retry if needed.'
    );
    expect(diagnostics.debugDetails).toMatchObject({
      messageId: 'msg-empty',
      statusMessageId: 'msg-empty',
      userVisibleState: 'checking',
      userVisibleNextReviewAt: '2026-05-09T12:00:00.000Z',
    });
  });

  it('honors user-visible none impact over raw terminal delivery facts', () => {
    const diagnostics = buildOpenCodeRuntimeDeliveryDiagnostics({
      deliveredToInbox: true,
      messageId: 'msg-proven',
      runtimeDelivery: {
        providerId: 'opencode',
        attempted: true,
        delivered: false,
        responsePending: false,
        responseState: 'empty_assistant_turn',
        ledgerStatus: 'failed_terminal',
        reason: 'empty_assistant_turn',
        diagnostics: ['empty_assistant_turn'],
        userVisibleImpact: {
          state: 'none',
        },
      },
    });

    expect(diagnostics).toEqual({ warning: null, debugDetails: null });
  });

  it('surfaces terminal empty assistant turn in the compact failed warning', () => {
    const diagnostics = buildOpenCodeRuntimeDeliveryDiagnostics({
      deliveredToInbox: true,
      messageId: 'msg-empty',
      runtimeDelivery: {
        providerId: 'opencode',
        attempted: true,
        delivered: false,
        responsePending: false,
        responseState: 'empty_assistant_turn',
        ledgerStatus: 'failed_terminal',
        reason: 'empty_assistant_turn',
        diagnostics: ['empty_assistant_turn'],
      },
    });

    expect(diagnostics.warning).toBe(
      'OpenCode runtime delivery failed. Message was saved to inbox, but live delivery did not complete. Reason: OpenCode returned an empty assistant turn.'
    );
    expect(diagnostics.debugDetails).toMatchObject({
      responseState: 'empty_assistant_turn',
      reason: 'empty_assistant_turn',
    });
  });

  it('surfaces prompt delivery with no recorded assistant turn separately', () => {
    const diagnostics = buildOpenCodeRuntimeDeliveryDiagnostics({
      deliveredToInbox: true,
      messageId: 'msg-no-assistant',
      runtimeDelivery: {
        providerId: 'opencode',
        attempted: true,
        delivered: false,
        responsePending: false,
        responseState: 'prompt_delivered_no_assistant_message',
        ledgerStatus: 'failed_terminal',
        reason: 'prompt_delivered_no_assistant_message',
        diagnostics: ['prompt_delivered_no_assistant_message'],
      },
    });

    expect(diagnostics.warning).toBe(
      'OpenCode runtime delivery failed. Message was saved to inbox, but live delivery did not complete. Reason: OpenCode accepted the prompt, but no assistant turn was recorded.'
    );
    expect(diagnostics.debugDetails).toMatchObject({
      responseState: 'prompt_delivered_no_assistant_message',
      reason: 'prompt_delivered_no_assistant_message',
    });
  });

  it('surfaces missing visible reply proof as a readable failure', () => {
    const diagnostics = buildOpenCodeRuntimeDeliveryDiagnostics({
      deliveredToInbox: true,
      messageId: 'msg-visible-required',
      runtimeDelivery: {
        providerId: 'opencode',
        attempted: true,
        delivered: false,
        responsePending: false,
        responseState: 'responded_non_visible_tool',
        ledgerStatus: 'failed_terminal',
        reason: 'visible_reply_still_required',
        diagnostics: ['visible_reply_still_required'],
      },
    });

    expect(diagnostics.warning).toBe(
      'OpenCode runtime delivery failed. Message was saved to inbox, but live delivery did not complete. Reason: OpenCode responded, but did not create a visible message_send reply.'
    );
    expect(diagnostics.debugDetails).toMatchObject({
      responseState: 'responded_non_visible_tool',
      reason: 'visible_reply_still_required',
    });
  });

  it('surfaces missing task progress proof as a readable failure', () => {
    const diagnostics = buildOpenCodeRuntimeDeliveryDiagnostics({
      deliveredToInbox: true,
      messageId: 'msg-progress-required',
      runtimeDelivery: {
        providerId: 'opencode',
        attempted: true,
        delivered: false,
        responsePending: false,
        responseState: 'responded_non_visible_tool',
        ledgerStatus: 'failed_terminal',
        reason: 'non_visible_tool_without_task_progress',
        diagnostics: ['non_visible_tool_without_task_progress'],
      },
    });

    expect(diagnostics.warning).toBe(
      'OpenCode runtime delivery failed. Message was saved to inbox, but live delivery did not complete. Reason: OpenCode used tools, but did not create a visible reply or task progress proof.'
    );
  });

  it('surfaces missing taskRefs proof as a readable failure', () => {
    const diagnostics = buildOpenCodeRuntimeDeliveryDiagnostics({
      deliveredToInbox: true,
      messageId: 'msg-taskrefs-required',
      runtimeDelivery: {
        providerId: 'opencode',
        attempted: true,
        delivered: false,
        responsePending: false,
        responseState: 'responded_visible_message',
        ledgerStatus: 'failed_terminal',
        reason: 'visible_reply_missing_task_refs',
        diagnostics: ['visible_reply_missing_task_refs'],
      },
    });

    expect(diagnostics.warning).toBe(
      'OpenCode runtime delivery failed. Message was saved to inbox, but live delivery did not complete. Reason: OpenCode created a reply without the required taskRefs metadata.'
    );
  });
});
