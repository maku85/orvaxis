import { bench, describe } from "vitest"
import { Tracer } from "../core/Tracer"

const META = { layer: "pipeline", route: "/api/users" }

describe("Tracer — event recording", () => {
  bench("single event (no meta)", () => {
    const t = new Tracer("req-1")
    t.event("request.start")
    t.end()
  })

  bench("single event (with meta)", () => {
    const t = new Tracer("req-1")
    t.event("request.start", META)
    t.end()
  })

  bench("5 events", () => {
    const t = new Tracer("req-1")
    t.event("request.start")
    t.event("policy.evaluate")
    t.event("pipeline.execute")
    t.event("handler.run")
    t.event("request.end")
    t.end()
  })

  bench("20 events", () => {
    const t = new Tracer("req-1")
    for (let i = 0; i < 20; i++) t.event(`event.${i}`, META)
    t.end()
  })
})

describe("Tracer — baseline comparison", () => {
  bench("no tracer (equivalent work via plain array)", () => {
    const events: { type: string; timestamp: number }[] = []
    events.push({ type: "request.start", timestamp: Date.now() })
    events.push({ type: "request.end", timestamp: Date.now() })
  })

  bench("Tracer 2 events (matched baseline)", () => {
    const t = new Tracer("req-1")
    t.event("request.start")
    t.event("request.end")
    t.end()
  })
})
