import { bench, describe } from "vitest"
import { createContext } from "../core/Context"
import { createMockResponse } from "../core/mockResponse"
import { Pipeline } from "../core/Pipeline"
import type { Middleware } from "../types"

const passThrough: Middleware = (_ctx, next) => next()
const stateMutating: Middleware = (ctx, next) => {
  ctx.state.visited = ((ctx.state.visited as number) ?? 0) + 1
  return next()
}

function makePipeline(n: number, mw: Middleware): Pipeline {
  const p = new Pipeline()
  for (let i = 0; i < n; i++) p.use(mw)
  return p
}

const ctx = createContext({ path: "/", method: "GET", headers: {} }, createMockResponse())

const pipeline1 = makePipeline(1, passThrough)
const pipeline5 = makePipeline(5, passThrough)
const pipeline20 = makePipeline(20, passThrough)
const pipeline1Mut = makePipeline(1, stateMutating)
const pipeline5Mut = makePipeline(5, stateMutating)
const pipeline20Mut = makePipeline(20, stateMutating)

describe("Pipeline — pass-through middleware", () => {
  bench("1 middleware", async () => {
    await pipeline1.execute(ctx)
  })

  bench("5 middleware", async () => {
    await pipeline5.execute(ctx)
  })

  bench("20 middleware", async () => {
    await pipeline20.execute(ctx)
  })
})

describe("Pipeline — state-mutating middleware", () => {
  bench("1 middleware", async () => {
    ctx.state = {}
    await pipeline1Mut.execute(ctx)
  })

  bench("5 middleware", async () => {
    ctx.state = {}
    await pipeline5Mut.execute(ctx)
  })

  bench("20 middleware", async () => {
    ctx.state = {}
    await pipeline20Mut.execute(ctx)
  })
})
