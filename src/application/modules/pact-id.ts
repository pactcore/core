import type {
  ParticipantRepository,
  ReputationService,
  WorkerRepository,
} from "../contracts";
import type { GeoPoint, Participant, ParticipantRole, WorkerProfile } from "../../domain/types";

export interface RegisterParticipantInput {
  id: string;
  role: ParticipantRole;
  displayName: string;
  skills?: string[];
  location?: GeoPoint;
  capacity?: number;
  initialReputation?: number;
}

const defaultLocation: GeoPoint = {
  latitude: 0,
  longitude: 0,
};

export class PactID {
  constructor(
    private readonly participantRepository: ParticipantRepository,
    private readonly workerRepository: WorkerRepository,
    private readonly reputationService: ReputationService,
  ) {}

  async registerParticipant(input: RegisterParticipantInput): Promise<Participant> {
    const participant: Participant = {
      id: input.id,
      role: input.role,
      displayName: input.displayName,
      skills: input.skills ?? [],
      location: input.location ?? defaultLocation,
    };

    await this.participantRepository.save(participant);
    await this.reputationService.setScore(
      participant.id,
      participant.role,
      input.initialReputation ?? 60,
    );

    if (participant.role === "worker") {
      const worker: WorkerProfile = {
        id: participant.id,
        skills: participant.skills,
        reputation: input.initialReputation ?? 60,
        location: participant.location,
        capacity: input.capacity ?? 1,
        activeTaskIds: [],
      };
      await this.workerRepository.save(worker);
    }

    return participant;
  }

  async getWorker(workerId: string): Promise<WorkerProfile | undefined> {
    return this.workerRepository.getById(workerId);
  }

  async listWorkers(): Promise<WorkerProfile[]> {
    return this.workerRepository.list();
  }
}
