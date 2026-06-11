---
name: Express TypeScript strict-mode patterns
description: How to make middleware generic, type rawBody correctly, and avoid ParamsDictionary clobbering per-route inference.
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

## rawBody typing — single declaration wins

`server/index.ts` augments `http.IncomingMessage` with `rawBody`. This must be `rawBody?: string | Buffer` (the actual runtime type set by body-parser). If declared as `rawBody: unknown`, then `req.rawBody ?? fallback` widens to `{}` which is not assignable to `string | Buffer`.

**Fix:** in `server/index.ts`:
```ts
declare module "http" {
  interface IncomingMessage {
    rawBody?: string | Buffer;
  }
}
```
Do NOT duplicate this on `Express.Request` — one declaration on `IncomingMessage` propagates to `Request<P>` since Express Request extends IncomingMessage.

**Why:** conflicting declarations (`unknown` vs `string | Buffer`) cause TypeScript to widen `??` expressions to `{}`, which is not assignable to `string | Buffer`.

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
