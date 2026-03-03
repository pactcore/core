import type { DomainEvent, EventJournal, EventJournalRecord } from "../../application/contracts";

export class InMemoryEventJournal implements EventJournal {
  private readonly records: EventJournalRecord[] = [];

  async append(event: DomainEvent<unknown>): Promise<EventJournalRecord> {
    const record: EventJournalRecord = {
      offset: this.records.length,
      event,
    };
    this.records.push(record);
    return record;
  }

  async replay(fromOffset = 0, limit = 100): Promise<EventJournalRecord[]> {
    return this.records.slice(fromOffset, fromOffset + limit);
  }

  async latestOffset(): Promise<number> {
    return this.records.length - 1;
  }
}
