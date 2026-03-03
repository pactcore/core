import { createApp } from "./api/app";

const app = createApp();
const port = Number(process.env.PORT ?? 3000);

Bun.serve({
  port,
  fetch: app.fetch,
});

console.log(`PACT Network Core listening on http://localhost:${port}`);
