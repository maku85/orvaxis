import { bench, describe } from "vitest"
import { createContext } from "../core/Context"
import { createMockResponse } from "../core/mockResponse"
import { HookSystem } from "../core/Hook"

function makeHookSystem(n: number): HookSystem {
  const hs = new HookSystem()
  for (let i = 0; i < n; i++) {
    hs.on("onRequest", (_ctx) => {})
  }
  return hs
}

function makeAsyncHookSystem(n: number): HookSystem {
  const hs = new HookSystem()
  for (let i = 0; i < n; i++) {
    hs.on("onRequest", async (_ctx) => {})
  }
  return hs
}

const ctx = createContext({ path: "/", method: "GET", headers: {} }, createMockResponse())
const err = new Error("test error")

const hooks1 = makeHookSystem(1)
const hooks5 = makeHookSystem(5)
const hooks10 = makeHookSystem(10)
const asyncHooks1 = makeAsyncHookSystem(1)
const asyncHooks5 = makeAsyncHookSystem(5)
const asyncHooks10 = makeAsyncHookSystem(10)

const errorHooks = new HookSystem()
errorHooks.on("onError", (_ctx, _err) => {})

describe("HookSystem — sync listeners on onRequest", () => {
  bench("1 listener", async () => {
    await hooks1.trigger("onRequest", ctx)
  })

  bench("5 listeners", async () => {
    await hooks5.trigger("onRequest", ctx)
  })

  bench("10 listeners", async () => {
    await hooks10.trigger("onRequest", ctx)
  })
})

describe("HookSystem — async listeners on onRequest", () => {
  bench("1 listener", async () => {
    await asyncHooks1.trigger("onRequest", ctx)
  })

  bench("5 listeners", async () => {
    await asyncHooks5.trigger("onRequest", ctx)
  })

  bench("10 listeners", async () => {
    await asyncHooks10.trigger("onRequest", ctx)
  })
})

describe("HookSystem — onError hook", () => {
  bench("trigger onError with 1 listener", async () => {
    await errorHooks.trigger("onError", ctx, err)
  })
})
