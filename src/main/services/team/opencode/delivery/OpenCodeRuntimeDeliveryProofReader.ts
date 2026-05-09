import { isLeadMember } from '@shared/utils/leadDetection';

import { TeamConfigReader } from '../../TeamConfigReader';
import { TeamInboxReader } from '../../TeamInboxReader';
import { TeamTaskReader } from '../../TeamTaskReader';

import {
  getOpenCodeRuntimeDeliveryPromptTimeMs,
  getOpenCodeRuntimeDeliveryRecordTimeMs,
  isTerminalSuccessfulOpenCodeDeliveryRecord,
  type OpenCodeRuntimeDeliveryProofSnapshot,
} from './OpenCodeRuntimeDeliveryAdvisoryPolicy';
import {
  getOpenCodeRuntimeDeliveryMessageTimeMs,
  getOpenCodeVisibleReplyInboxCandidates,
  isOpenCodeRecoveredVisibleReplyCandidate,
  normalizeOpenCodeRuntimeDeliveryToken,
  openCodeTaskRefsIncludeAll,
} from './OpenCodeRuntimeDeliveryProofMatching';

import type { OpenCodePromptDeliveryLedgerRecord } from './OpenCodePromptDeliveryLedger';
import type { InboxMessage, TeamConfig, TeamTask } from '@shared/types';

const PROOF_READ_CONCURRENCY = 4;

interface IndexedVisibleReply {
  inboxName: string;
  message: InboxMessage & { messageId: string };
  observedAt: number;
}

export interface OpenCodeRuntimeDeliveryProofIndex {
  getSnapshot(
    memberName: string,
    record: OpenCodePromptDeliveryLedgerRecord
  ): OpenCodeRuntimeDeliveryProofSnapshot;
}

export interface OpenCodeRuntimeDeliveryProofReaderInput {
  teamName: string;
  activeMemberKeys: ReadonlySet<string>;
  recordsByMember: ReadonlyMap<string, readonly OpenCodePromptDeliveryLedgerRecord[]>;
}

interface ConfigReaderPort {
  getConfigSnapshot?(teamName: string): Promise<TeamConfig | null>;
  getConfig(teamName: string): Promise<TeamConfig | null>;
}

async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let index = 0;
  const workerCount = Math.max(1, Math.min(limit, items.length));
  const workers = new Array(workerCount).fill(0).map(async () => {
    while (true) {
      const currentIndex = index;
      index += 1;
      if (currentIndex >= items.length) {
        return;
      }
      results[currentIndex] = await fn(items[currentIndex]);
    }
  });
  await Promise.all(workers);
  return results;
}

function getLatestMemberTaskProgressTime(task: TeamTask, memberKey: string): number {
  let latest = 0;
  for (const comment of task.comments ?? []) {
    if (normalizeOpenCodeRuntimeDeliveryToken(comment.author) !== memberKey) {
      continue;
    }
    const createdAt = Date.parse(comment.createdAt);
    if (Number.isFinite(createdAt)) {
      latest = Math.max(latest, createdAt);
    }
  }
  for (const event of task.historyEvents ?? []) {
    if (normalizeOpenCodeRuntimeDeliveryToken(event.actor ?? '') !== memberKey) {
      continue;
    }
    const timestamp = Date.parse(event.timestamp);
    if (Number.isFinite(timestamp)) {
      latest = Math.max(latest, timestamp);
    }
  }
  return latest;
}

function getOpenCodeTaskProgressProofKey(memberKey: string, taskId: string): string {
  return `${memberKey}::task::${taskId.trim()}`;
}

class MaterializedOpenCodeRuntimeDeliveryProofIndex implements OpenCodeRuntimeDeliveryProofIndex {
  constructor(
    private readonly latestSuccessTimesByMember: ReadonlyMap<string, number>,
    private readonly visibleRepliesByMember: ReadonlyMap<string, readonly IndexedVisibleReply[]>,
    private readonly taskProgressTimes: ReadonlyMap<string, number>
  ) {}

  getSnapshot(
    memberName: string,
    record: OpenCodePromptDeliveryLedgerRecord
  ): OpenCodeRuntimeDeliveryProofSnapshot {
    const memberKey = normalizeOpenCodeRuntimeDeliveryToken(memberName);
    const visibleReplies = this.visibleRepliesByMember.get(memberKey) ?? [];
    const relayOfMessageId = record.inboxMessageId.trim();
    const promptTime = getOpenCodeRuntimeDeliveryPromptTimeMs(record);
    let visibleReply: IndexedVisibleReply | null = null;

    const expectedMessageId = record.visibleReplyMessageId?.trim();
    if (expectedMessageId) {
      visibleReply =
        visibleReplies.find(
          (candidate) =>
            candidate.message.messageId === expectedMessageId &&
            isOpenCodeRecoveredVisibleReplyCandidate({
              message: candidate.message,
              ledgerRecord: record,
              from: memberName,
              requireTaskRefs: false,
            }) &&
            openCodeTaskRefsIncludeAll(candidate.message.taskRefs, record.taskRefs)
        ) ?? null;
    }

    if (!visibleReply && relayOfMessageId) {
      visibleReply =
        visibleReplies.find((candidate) => {
          const messageRelayOfMessageId =
            typeof candidate.message.relayOfMessageId === 'string'
              ? candidate.message.relayOfMessageId.trim()
              : '';
          return (
            messageRelayOfMessageId === relayOfMessageId &&
            isOpenCodeRecoveredVisibleReplyCandidate({
              message: candidate.message,
              ledgerRecord: record,
              from: memberName,
              requireTaskRefs: false,
            }) &&
            openCodeTaskRefsIncludeAll(candidate.message.taskRefs, record.taskRefs)
          );
        }) ?? null;
    }

    if (!visibleReply && record.taskRefs.length > 0) {
      visibleReply =
        visibleReplies
          .filter((candidate) =>
            isOpenCodeRecoveredVisibleReplyCandidate({
              message: candidate.message,
              ledgerRecord: record,
              from: memberName,
              requireTaskRefs: true,
            })
          )
          .sort((left, right) => left.observedAt - right.observedAt)[0] ?? null;
    }

    let taskProgressAt = 0;
    for (const taskRef of record.taskRefs) {
      const taskId = taskRef.taskId?.trim();
      if (!taskId) {
        continue;
      }
      const proofAt = this.taskProgressTimes.get(
        getOpenCodeTaskProgressProofKey(memberKey, taskId)
      );
      if (typeof proofAt === 'number' && proofAt > promptTime) {
        taskProgressAt = Math.max(taskProgressAt, proofAt);
      }
    }

    return {
      latestSuccessAt: this.latestSuccessTimesByMember.get(memberKey),
      visibleReplyAt: visibleReply?.observedAt,
      visibleReplyMessageId: visibleReply?.message.messageId,
      visibleReplyInbox: visibleReply?.inboxName,
      taskProgressAt: taskProgressAt > 0 ? taskProgressAt : undefined,
    };
  }
}

export class OpenCodeRuntimeDeliveryProofReader {
  constructor(
    private readonly inboxReader = new TeamInboxReader(),
    private readonly taskReader = new TeamTaskReader(),
    private readonly configReader: ConfigReaderPort = new TeamConfigReader()
  ) {}

  async readProofIndex(
    input: OpenCodeRuntimeDeliveryProofReaderInput
  ): Promise<OpenCodeRuntimeDeliveryProofIndex> {
    const [configuredLeadName, visibleRepliesByMember, taskProgressTimes] = await Promise.all([
      this.readConfiguredLeadName(input.teamName),
      this.readVisibleRepliesByMember(input),
      this.readTaskProgressProofTimes(
        input.teamName,
        input.activeMemberKeys,
        input.recordsByMember
      ),
    ]);

    return new MaterializedOpenCodeRuntimeDeliveryProofIndex(
      this.readLatestSuccessTimesByMember(input.activeMemberKeys, input.recordsByMember),
      await visibleRepliesByMember(configuredLeadName),
      taskProgressTimes
    );
  }

  private async readConfiguredLeadName(teamName: string): Promise<string | null> {
    const config =
      (typeof this.configReader.getConfigSnapshot === 'function'
        ? await this.configReader.getConfigSnapshot(teamName)
        : await this.configReader.getConfig(teamName)) ?? null;
    return config?.members?.find((member) => isLeadMember(member))?.name?.trim() || null;
  }

  private async readVisibleRepliesByMember(
    input: OpenCodeRuntimeDeliveryProofReaderInput
  ): Promise<(configuredLeadName: string | null) => Promise<Map<string, IndexedVisibleReply[]>>> {
    const candidateDescriptors = new Map<
      string,
      {
        replyRecipient?: string | null;
        includeUserFallbackForLeadRecipient?: boolean;
      }
    >();
    for (const records of input.recordsByMember.values()) {
      for (const record of records) {
        const includeUserFallbackForLeadRecipient = true;
        const key = `${record.replyRecipient ?? ''}\u0000${includeUserFallbackForLeadRecipient ? '1' : '0'}`;
        candidateDescriptors.set(key, {
          replyRecipient: record.replyRecipient,
          includeUserFallbackForLeadRecipient,
        });
      }
    }

    return async (configuredLeadName: string | null) => {
      const inboxNames = new Set<string>();
      for (const descriptor of candidateDescriptors.values()) {
        for (const inboxName of getOpenCodeVisibleReplyInboxCandidates({
          ...descriptor,
          configuredLeadName,
        })) {
          inboxNames.add(inboxName);
        }
      }

      const result = new Map<string, IndexedVisibleReply[]>();
      await mapLimit(Array.from(inboxNames), PROOF_READ_CONCURRENCY, async (inboxName) => {
        const messages = await this.inboxReader
          .getMessagesFor(input.teamName, inboxName)
          .catch(() => []);
        for (const message of messages) {
          const messageId = typeof message.messageId === 'string' ? message.messageId.trim() : '';
          if (!messageId) {
            continue;
          }
          const memberKey = normalizeOpenCodeRuntimeDeliveryToken(message.from);
          if (!input.activeMemberKeys.has(memberKey)) {
            continue;
          }
          if (message.source !== undefined && message.source !== 'runtime_delivery') {
            continue;
          }
          const observedAt = getOpenCodeRuntimeDeliveryMessageTimeMs(message);
          const existing = result.get(memberKey) ?? [];
          existing.push({
            inboxName,
            message: { ...message, messageId },
            observedAt,
          });
          result.set(memberKey, existing);
        }
      });
      return result;
    };
  }

  private readLatestSuccessTimesByMember(
    activeMemberKeys: ReadonlySet<string>,
    recordsByMember: ReadonlyMap<string, readonly OpenCodePromptDeliveryLedgerRecord[]>
  ): Map<string, number> {
    const result = new Map<string, number>();
    for (const [memberKey, records] of recordsByMember) {
      if (!activeMemberKeys.has(memberKey)) {
        continue;
      }
      for (const record of records) {
        if (!isTerminalSuccessfulOpenCodeDeliveryRecord(record)) {
          continue;
        }
        result.set(
          memberKey,
          Math.max(result.get(memberKey) ?? 0, getOpenCodeRuntimeDeliveryRecordTimeMs(record))
        );
      }
    }
    return result;
  }

  private async readTaskProgressProofTimes(
    teamName: string,
    activeMemberKeys: ReadonlySet<string>,
    recordsByMember: ReadonlyMap<string, readonly OpenCodePromptDeliveryLedgerRecord[]>
  ): Promise<Map<string, number>> {
    const taskIdsByMember = new Map<string, Set<string>>();
    for (const [memberKey, records] of recordsByMember) {
      if (!activeMemberKeys.has(memberKey)) {
        continue;
      }
      for (const record of records) {
        for (const taskRef of record.taskRefs) {
          const taskId = taskRef.taskId?.trim();
          if (!taskId) {
            continue;
          }
          const taskIds = taskIdsByMember.get(memberKey) ?? new Set<string>();
          taskIds.add(taskId);
          taskIdsByMember.set(memberKey, taskIds);
        }
      }
    }
    if (taskIdsByMember.size === 0) {
      return new Map();
    }

    const tasks = await this.taskReader.getTasks(teamName).catch(() => []);
    if (tasks.length === 0) {
      return new Map();
    }

    const result = new Map<string, number>();
    for (const task of tasks) {
      const taskId = task.id?.trim();
      if (!taskId) {
        continue;
      }
      for (const [memberKey, taskIds] of taskIdsByMember) {
        if (!taskIds.has(taskId)) {
          continue;
        }
        const proofAt = getLatestMemberTaskProgressTime(task, memberKey);
        if (proofAt <= 0) {
          continue;
        }
        const key = getOpenCodeTaskProgressProofKey(memberKey, taskId);
        result.set(key, Math.max(result.get(key) ?? 0, proofAt));
      }
    }
    return result;
  }
}
