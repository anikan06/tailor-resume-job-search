---
name: add-api-endpoint
description: Add or change an HTTP endpoint end-to-end in this repo - Express route in server/src/httpServer.ts, shared types in server/src/types.ts mirrored to web/src/app/core/models.ts, and the ApiService method plus component usage in Angular. Use when a feature needs new data between server and web.
---
# Add an API endpoint

Touch points, in order:

1. **Types.** Add the request and response interfaces to `server/src/types.ts`, then
   copy them *exactly* into `web/src/app/core/models.ts`. Web uses single quotes and
   the same field names and optionality.
2. **Logic.** Put the work in the relevant module (`jobsStore.ts`, `resume/*`,
   `tracker.ts`, and so on), not in the route handler. Use `db.ts` helpers for storage.
3. **Route.** In `server/src/httpServer.ts`, use `app.get|post|put|delete("/api/...", async (req: Request, res: Response) => …)`.
   - Follow the neighbouring handlers for validation, error responses, and status codes.
   - Never return API keys. The profile route masks them through `keepKey`/`keysConfigured`.
4. **Client.** Add a method to `web/src/app/core/api.service.ts`
   (`this.http.<verb><T>(`${BASE}/...`)`) and add the new types to its import list.
5. **UI.** Call it from the feature component and hold the result in a signal.
   Show loading and error states the way the neighbouring code does.
6. **Check.** Run `.ai/scripts/verify.sh`. With `./start.sh` running, curl
   `http://localhost:4000/api/...` to confirm the shape.

If the endpoint is also useful to the MCP server, add a matching tool in
`server/src/index.ts` (zod `inputSchema` and a `case` in the handler switch).
