# REST API

## Health

`GET /health`

## Identity

`POST /id/participants`

Example payload:

```json
{
  "id": "worker-1",
  "role": "worker",
  "displayName": "Alice",
  "skills": ["photo", "gps"],
  "capacity": 2,
  "initialReputation": 90,
  "location": { "latitude": 37.77, "longitude": -122.41 }
}
```

`GET /id/workers`

## Tasks

`POST /tasks`

`POST /tasks/:id/assign`

- With `workerId`: explicit assignment
- Without `workerId`: automatic matching

`POST /tasks/:id/submit`

Submitting evidence triggers validation + settlement orchestration.

`GET /tasks`

`GET /tasks/:id`

## Payments

`GET /payments/ledger`

## Heartbeat Supervision

`POST /heartbeat/tasks`

Registers a heartbeat control task.

Example payload:

```json
{
  "name": "mission-health-check",
  "intervalMs": 60000,
  "payload": { "kind": "health" }
}
```

`GET /heartbeat/tasks`

Lists registered heartbeat tasks.

`POST /heartbeat/tasks/:id/enable`

`POST /heartbeat/tasks/:id/disable`

`POST /heartbeat/tick`

Executes due heartbeat tasks (optional body `{ "now": <timestamp> }`).

## Other Modules

- `POST /compute/jobs`
- `POST /data/assets`
- `POST /dev/integrations`
