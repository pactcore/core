import { ConstraintViolationError } from "./errors";
import type { Task, WorkerProfile } from "./types";

export interface MatchAssignment {
  taskId: string;
  workerId: string;
  score: number;
}

export interface MatchResult {
  assignments: MatchAssignment[];
  unmatchedTaskIds: string[];
}

interface RankedWorker {
  workerId: string;
  taskScore: number;
}

function toRadians(value: number): number {
  return (value * Math.PI) / 180;
}

function distanceKm(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number {
  const earthRadiusKm = 6371;
  const dLat = toRadians(b.latitude - a.latitude);
  const dLon = toRadians(b.longitude - a.longitude);
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);

  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLon / 2) * Math.sin(dLon / 2) * Math.cos(lat1) * Math.cos(lat2);

  return 2 * earthRadiusKm * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function hasRequiredSkills(requiredSkills: string[], workerSkills: string[]): boolean {
  return requiredSkills.every((skill) => workerSkills.includes(skill));
}

function taskUtility(task: Task, worker: WorkerProfile): number {
  const distance = distanceKm(task.location, worker.location);
  const distanceScore = Math.max(0, 1 - distance / Math.max(task.constraints.maxDistanceKm, 1));
  const reputationScore = worker.reputation / 100;
  const availableCapacity = Math.max(0, worker.capacity - worker.activeTaskIds.length);
  const capacityScore = Math.min(1, availableCapacity / Math.max(worker.capacity, 1));
  const skillScore = task.constraints.requiredSkills.length === 0
    ? 1
    : task.constraints.requiredSkills.filter((skill) => worker.skills.includes(skill)).length /
      task.constraints.requiredSkills.length;

  return skillScore * 0.4 + distanceScore * 0.2 + reputationScore * 0.25 + capacityScore * 0.15;
}

function workerUtility(task: Task, worker: WorkerProfile): number {
  const distance = distanceKm(task.location, worker.location);
  const payoutScore = Math.min(1, task.paymentCents / 10000);
  const distancePenalty = Math.min(1, distance / Math.max(task.constraints.maxDistanceKm, 1));
  return payoutScore * 0.7 + (1 - distancePenalty) * 0.3;
}

export class GaleShapleyMatcher {
  private feasibleWorkersForTask(task: Task, workers: WorkerProfile[]): RankedWorker[] {
    return workers
      .filter((worker) => worker.capacity > worker.activeTaskIds.length)
      .filter((worker) => worker.reputation >= task.constraints.minReputation)
      .filter((worker) => hasRequiredSkills(task.constraints.requiredSkills, worker.skills))
      .filter((worker) => distanceKm(task.location, worker.location) <= task.constraints.maxDistanceKm)
      .map((worker) => ({ workerId: worker.id, taskScore: taskUtility(task, worker) }))
      .sort((a, b) => b.taskScore - a.taskScore);
  }

  match(tasks: Task[], workers: WorkerProfile[]): MatchResult {
    const taskMap = new Map(tasks.map((task) => [task.id, task]));
    const workerMap = new Map(workers.map((worker) => [worker.id, worker]));

    const preferences = new Map<string, RankedWorker[]>();
    for (const task of tasks) {
      preferences.set(task.id, this.feasibleWorkersForTask(task, workers));
    }

    const nextChoiceIndex = new Map<string, number>();
    const unmatchedQueue = tasks.map((task) => task.id);
    const workerAssignments = new Map<string, string[]>();

    while (unmatchedQueue.length > 0) {
      const taskId = unmatchedQueue.shift();
      if (!taskId) {
        continue;
      }

      const task = taskMap.get(taskId);
      if (!task) {
        continue;
      }

      const rankedWorkers = preferences.get(taskId) ?? [];
      const choiceIndex = nextChoiceIndex.get(taskId) ?? 0;

      if (choiceIndex >= rankedWorkers.length) {
        continue;
      }

      const choice = rankedWorkers[choiceIndex];
      if (!choice) {
        continue;
      }

      nextChoiceIndex.set(taskId, choiceIndex + 1);

      const worker = workerMap.get(choice.workerId);
      if (!worker) {
        unmatchedQueue.push(taskId);
        continue;
      }

      const assignedTasks = workerAssignments.get(worker.id) ?? [];
      const effectiveCapacity = Math.max(0, worker.capacity - worker.activeTaskIds.length);

      if (effectiveCapacity <= 0) {
        unmatchedQueue.push(taskId);
        continue;
      }

      if (assignedTasks.length < effectiveCapacity) {
        workerAssignments.set(worker.id, [...assignedTasks, taskId]);
        continue;
      }

      let worstTaskId = assignedTasks[0];
      if (!worstTaskId) {
        unmatchedQueue.push(taskId);
        continue;
      }
      let worstScore = Number.POSITIVE_INFINITY;
      for (const currentTaskId of assignedTasks) {
        const currentTask = taskMap.get(currentTaskId);
        if (!currentTask) {
          continue;
        }

        const score = workerUtility(currentTask, worker);
        if (score < worstScore) {
          worstScore = score;
          worstTaskId = currentTaskId;
        }
      }

      const proposedScore = workerUtility(task, worker);
      if (proposedScore > worstScore) {
        workerAssignments.set(
          worker.id,
          assignedTasks.filter((id) => id !== worstTaskId).concat(taskId),
        );
        unmatchedQueue.push(worstTaskId);
      } else {
        unmatchedQueue.push(taskId);
      }
    }

    const assignments: MatchAssignment[] = [];
    for (const [workerId, taskIds] of workerAssignments.entries()) {
      for (const taskId of taskIds) {
        const rankedWorkers = preferences.get(taskId) ?? [];
        const ranked = rankedWorkers.find((entry) => entry.workerId === workerId);
        assignments.push({
          taskId,
          workerId,
          score: ranked?.taskScore ?? 0,
        });
      }
    }

    const assignedTaskIds = new Set(assignments.map((entry) => entry.taskId));
    const unmatchedTaskIds = tasks
      .map((task) => task.id)
      .filter((taskId) => !assignedTaskIds.has(taskId));

    return {
      assignments,
      unmatchedTaskIds,
    };
  }

  assertAssignable(task: Task, worker: WorkerProfile): void {
    if (!hasRequiredSkills(task.constraints.requiredSkills, worker.skills)) {
      throw new ConstraintViolationError("Worker does not satisfy required skills");
    }
    if (worker.reputation < task.constraints.minReputation) {
      throw new ConstraintViolationError("Worker reputation below task requirement");
    }
    if (worker.capacity <= worker.activeTaskIds.length) {
      throw new ConstraintViolationError("Worker has no available capacity");
    }

    const distance = distanceKm(task.location, worker.location);
    if (distance > task.constraints.maxDistanceKm) {
      throw new ConstraintViolationError("Worker distance exceeds task maxDistanceKm");
    }
  }
}
