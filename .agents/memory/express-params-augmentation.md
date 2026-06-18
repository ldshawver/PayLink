---
name: Express TypeScript strict-mode patterns
description: Generic middleware, rawBody typing, ParamsDictionary augmentation, and call-site cast patterns for strict TypeScript on Express backend.
---

## Generic middleware pattern

Non-generic `RequestHandler<ParamsDictionary>` middleware in a route chain forces `P = ParamsDictionary` for ALL handlers in that chain, clobbering the per-route `RouteParameters<Route>` default and causing `req.params.id: string | string[]` errors.

**Fix:** make every middleware function generic:
```ts
function requireAuth<P extends ParamsDictionary>(req: Request<P>, res: Response, next: NextFunction) { ... }
// OR for factory middleware:
function requireRole(...roles: string[]) {
  return async <P extends ParamsDictionary>(req: Request<P>, res: Response, next: NextFunction) => { ... };
}
```
Import `ParamsDictionary` from `express-serve-static-core`.

**Why:** `IRouterMatcher` uses `P = RouteParameters<Route>` as a DEFAULT not a constraint. When all middleware in the chain is generic over P, TypeScript falls back to the route-specific default.

**Do NOT add `: Promise<void>` to inner async arrow functions** — `return res.json()` returns `Response` not `void`, causing TS2322. Omit the return type annotation and let TypeScript infer.

## ParamsDictionary augmentation — required named props

`server/express-params.d.ts` declares named params (id, workerId, companyId, etc.) as **REQUIRED** (not optional `?`).

**Why:** Making them optional (`id?: string`) causes `string | undefined` errors at 500+ call sites. TypeScript's `IRouterMatcher` falls back to `P = ParamsDictionary` for all routes, making every `req.params.id` typed as `string | undefined`.

**How to apply:** Keep all named properties as `id: string` (required). This works because TypeScript's overload resolution selects `P = ParamsDictionary` for routes without named params when required props break `{}` assignability.

## app.use lambda cast pattern

`app.use("/api", (req, res, next) => {...})` lambdas infer `req: Request<{}>` (no path params). Passing this `req` to helpers typed as `(req: Request<ParamsDictionary>)` fails.

**Fix:** Cast at the call site — `blockDemoWrites(req as Request, res, next)`. Do NOT change the helper signatures to `Request<{}>` — that breaks all parameterized routes. Same pattern applies to wildcard routes (`app.use("/{*path}", ...)`) in `server/static.ts` and `server/vite.ts`.

## rawBody typing — single declaration wins

`server/index.ts` augments `http.IncomingMessage` with `rawBody`. Must be `rawBody?: string | Buffer` (the actual runtime type set by body-parser). If declared as `rawBody: unknown`, then `req.rawBody ?? fallback` widens to `{}` which is not assignable to `string | Buffer`.

**Fix:** in `server/index.ts`:
```ts
declare module "http" {
  interface IncomingMessage {
    rawBody?: string | Buffer;
  }
}
```
Do NOT duplicate this on `Express.Request` — one declaration on `IncomingMessage` propagates to `Request<P>`.

## Structural helpers — avoid req as Request casts

```ts
function getAppBaseUrl(req: Pick<Request, "headers" | "protocol">): string { ... }
function sendAppShell(req: Pick<Request, "path">, res: Response): void { ... }
```
Pass `req` directly — no cast needed since `Request<P>` satisfies any `Pick<Request, ...>`.

## Array routes and multer force P = ParamsDictionary

- `app.get(["/a/:id", "/b/:id"], ...)` — TypeScript can't infer RouteParameters from an array of paths
- Multer: `upload.single("file")` is `RequestHandler<ParamsDictionary>` — forces P on the whole chain

**Fix:** use `String(req.params.id)` at the specific call sites.

**Fix:** in `server/index.ts`:
```ts
declare module "http" {
  interface IncomingMessage {
    rawBody?: string | Buffer;
  }
}
```
Do NOT duplicate this on `Express.Request` — one declaration on `IncomingMessage` propagates to `Request<P>` since Express Request extends IncomingMessage.

`remittanceSources.calibrationConfig` is a `json()` column. Drizzle's `$inferInsert` type expects a specific shape, but `InsertRemittanceSource` may have `Json | shape` including plain `string`.

## Structural helpers — avoid req as Request casts

For helper functions that only need a few req properties:
```ts
function getAppBaseUrl(req: Pick<Request, "headers" | "protocol">): string { ... }
function sendAppShell(req: Pick<Request, "path">, res: Response): void { ... }
function apiNotFoundHandler(req: Pick<Request, "originalUrl">, res: Response): void { ... }
```
Pass `req` directly at all call sites — no cast needed since `Request<P>` satisfies any `Pick<Request, ...>`.

## Array routes and multer force P = ParamsDictionary

- `app.get(["/a/:id", "/b/:id"], ...)` — TypeScript can't infer RouteParameters from an array of paths
- Multer: `upload.single("file")` is `RequestHandler<ParamsDictionary>` — forces P on the whole chain

**Fix:** use `String(req.params.id)` at the specific call sites. URL params are always strings at runtime — this is a coercion, not a type lie.
