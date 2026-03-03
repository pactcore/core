import type { AgentMailbox, AgentMailboxMessage } from "../../application/contracts";
import { generateId } from "../../application/utils";

export class InMemoryAgentMailbox implements AgentMailbox {
  private readonly inbox = new Map<string, AgentMailboxMessage[]>();
  private readonly outbox = new Map<string, AgentMailboxMessage[]>();

  async enqueueInbox(agentId: string, topic: string, payload: unknown): Promise<AgentMailboxMessage> {
    const message = this.createMessage(agentId, "inbox", topic, payload);
    const queue = this.inbox.get(agentId) ?? [];
    queue.push(message);
    this.inbox.set(agentId, queue);
    return message;
  }

  async enqueueOutbox(agentId: string, topic: string, payload: unknown): Promise<AgentMailboxMessage> {
    const message = this.createMessage(agentId, "outbox", topic, payload);
    const queue = this.outbox.get(agentId) ?? [];
    queue.push(message);
    this.outbox.set(agentId, queue);
    return message;
  }

  async pullInbox(agentId: string, limit = 20): Promise<AgentMailboxMessage[]> {
    const queue = this.inbox.get(agentId) ?? [];
    return queue.filter((message) => !message.ackedAt).slice(0, limit);
  }

  async listOutbox(agentId: string, limit = 20): Promise<AgentMailboxMessage[]> {
    const queue = this.outbox.get(agentId) ?? [];
    return queue.slice(Math.max(0, queue.length - limit));
  }

  async ackInbox(agentId: string, messageId: string): Promise<void> {
    const queue = this.inbox.get(agentId) ?? [];
    const index = queue.findIndex((message) => message.id === messageId);
    if (index >= 0) {
      const current = queue[index];
      if (!current) {
        return;
      }

      queue[index] = {
        ...current,
        ackedAt: Date.now(),
      };
      this.inbox.set(agentId, queue);
    }
  }

  private createMessage(
    agentId: string,
    direction: "inbox" | "outbox",
    topic: string,
    payload: unknown,
  ): AgentMailboxMessage {
    return {
      id: generateId("msg"),
      agentId,
      direction,
      topic,
      payload,
      createdAt: Date.now(),
    };
  }
}
