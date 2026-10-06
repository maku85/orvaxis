# Response contracts

A route can declare what it answers, per HTTP status. With `responseValidationPlugin` registered, Orvaxis checks the value passed to `ctx.res.json()` or `ctx.res.send()` against the contract for the status it is sending, and sends the **validator's output**. Like request validation, this is opt-in.

## Declare and register

<!-- snippet: examples/contracts.ts#response-routes -->
```ts
app.group({
  prefix: "/api/contracts",
  routes: [
    {
      // The schema is chosen by the status the handler sets; 404 has its own contract.
      method: "GET",
      path: "/lookup/:id",
      responses: {
        200: z.object({ id: z.string(), name: z.string() }),
        404: z.object({ error: z.string() }),
      },
      handler: (ctx) => {
        if (ctx.params.id === "missing")
          return ctx.res.status(404).json({ error: "No such item" })
        if (ctx.params.id === "teapot") return ctx.res.status(418).json({ anything: true })
        ctx.res.json({ id: ctx.params.id, name: ctx.params.id === "bad" ? 42 : "Example" })
      },
    },
    {
      // Validator output is what the client receives, so transforms apply to responses too.
      method: "GET",
      path: "/price",
      responses: { 200: z.object({ price: z.number().transform((n) => n.toFixed(2)) }) },
      handler: (ctx) => ctx.res.json({ price: 5 }),
    },
    {
      // Streaming is never buffered, so a declared schema cannot be checked.
      method: "GET",
      path: "/stream",
      responses: { 200: z.string() },
      handler: (ctx) => {
        ctx.res.write("data: hello\n\n")
        ctx.res.end()
      },
    },
  ],
})
```

```ts
app.register(responseValidationPlugin({ mode: "strict" })) // or "warn"
```

## How a schema is chosen

The schema is selected by the **status code at the moment the response is sent**: `ctx.res.status(404).json(...)` is checked against `responses[404]`, a plain `ctx.res.json(...)` against `responses[200]` (the default status). A status with no declared contract is not checked at all.

<!-- contract: lookup-ok status,body -->
```json
{
  "status": 200,
  "body": {
    "id": "a",
    "name": "Example"
  }
}
```

<!-- contract: lookup-404 status,body -->
```json
{
  "status": 404,
  "body": {
    "error": "No such item"
  }
}
```

<!-- contract: lookup-undeclared status,body -->
```json
{
  "status": 418,
  "body": {
    "anything": true
  }
}
```

## Transforms apply to what is sent

The parsed value replaces the original, so a transform in the contract changes the response. In the `/price` route the handler sends `{ price: 5 }` and the client receives:

<!-- contract: transformed status,body -->
```json
{
  "status": 200,
  "body": {
    "price": "5.00"
  }
}
```

## Strict and warn

| Mode | An invalid response |
|---|---|
| `strict` (default) | becomes an HTTP `500` (`Response validation failed for status 200`); the invalid body is not sent |
| `warn` | is sent unchanged; `onViolation` receives safe metadata |

<!-- contract: lookup-invalid-strict status,envelope -->
```json
{
  "status": 500,
  "envelope": {
    "error": "Response validation failed for status 200",
    "requestId": "req-1"
  }
}
```

<!-- contract: lookup-invalid-warn status,body,events -->
```json
{
  "status": 200,
  "body": {
    "id": "bad",
    "name": 42
  },
  "events": [
    "violation invalid-response status 200"
  ]
}
```

`warn` is meant for migrating existing handlers: count violations first, switch to `strict` later. `onViolation(issue)` receives `{ method, path, status, kind }` where `kind` is `invalid-response` or `stream-not-validated`. It never receives the response body or the validator's error messages, so it is safe to log. `path` is the route's declared path, without its group prefix. Without `onViolation`, the plugin writes the issue with `console.warn`. A throwing callback is ignored.

## What is outside the contract

- **Only values sent through the Orvaxis response API** (`json` and `send`) are validated. Errors thrown by the handler, errors created by the adapters (for example a malformed JSON body rejected by `express.json()`), and failures before the handler ever runs are not response-validated.
- **Streaming is never buffered.** If the status being streamed has a declared schema, `strict` fails the first `write`, `pipe` or chunked `end` with a `500`, and `warn` reports `stream-not-validated` once and lets the stream through. Leave streaming routes without a response schema.

<!-- contract: stream-strict status,envelope -->
```json
{
  "status": 500,
  "envelope": {
    "error": "Streaming response for GET /stream cannot be validated against a response schema",
    "requestId": "req-1"
  }
}
```

<!-- contract: stream-warn status,chunks,events -->
```json
{
  "status": 200,
  "chunks": [
    "data: hello\n\n"
  ],
  "events": [
    "violation stream-not-validated status 200"
  ]
}
```

- **OpenAPI** reads the same `responses` declarations; see [OpenAPI export](/guide/openapi). The contract itself cannot express the streaming restriction, so document streaming media types separately.

Run every scenario on this page with `pnpm exec tsx examples/contracts.ts`.
