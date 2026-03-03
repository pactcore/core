import type { DomainEvent, EventBus, EventHandler } from "../../application/contracts";

export class InMemoryEventBus implements EventBus {
  private readonly handlers = new Map<string, EventHandler<unknown>[]>();

  subscribe<TPayload>(eventName: string, handler: EventHandler<TPayload>): void {
    const list = this.handlers.get(eventName) ?? [];
    list.push(handler as EventHandler<unknown>);
    this.handlers.set(eventName, list);
  }

  async publish<TPayload>(event: DomainEvent<TPayload>): Promise<void> {
    const handlers = this.handlers.get(event.name) ?? [];
    for (const handler of handlers) {
      await handler(event as DomainEvent<unknown>);
    }
  }
}
