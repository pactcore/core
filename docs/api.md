# REST API

## Health

`GET /health`

## Identity

`POST /id/participants`

Request example:

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

- 指定 `workerId` 为显式指派
- 不传 `workerId` 则触发自动匹配

`POST /tasks/:id/submit`

提交证据后自动触发三层验证与结算编排。

`GET /tasks`

`GET /tasks/:id`

## Payments

`GET /payments/ledger`

## Other Modules

- `POST /compute/jobs`
- `POST /data/assets`
- `POST /dev/integrations`
