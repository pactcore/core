export const DomainEvents = {
  TaskCreated: "task.created",
  TaskAssigned: "task.assigned",
  TaskSubmitted: "task.submitted",
  TaskVerified: "task.verified",
  TaskCompleted: "task.completed",
  TaskValidationFailed: "task.validation_failed",

  MissionCreated: "mission.created",
  MissionClaimed: "mission.claimed",
  MissionExecutionStepAppended: "mission.execution_step_appended",
  MissionEvidenceSubmitted: "mission.evidence_submitted",
  MissionVerdictRecorded: "mission.verdict_recorded",
  MissionSettled: "mission.settled",
  MissionFailed: "mission.failed",
} as const;
