<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue"
import type { PolicyDiagnosticSnapshot } from "../../../../examples/policy-diagnostics-types"

type Scenario = PolicyDiagnosticSnapshot

const REPO = "https://github.com/maku85/orvaxis/blob/main/"
const identityOrder = ["anonymous", "alice", "bob", "maya", "admin"]
const resourceOrder = ["task-1", "task-2", "task-3", "overview"]

const scenarios = ref<Scenario[]>([])
const loadingError = ref(false)
const group = ref<"basics" | "tenant">("basics")
const basicId = ref("denied")
const identity = ref("bob")
const resource = ref("task-1")
const copied = ref("")

const basics = computed(() => scenarios.value.filter((scenario) => scenario.group === "basics"))
const tenant = computed(() => scenarios.value.filter((scenario) => scenario.group === "tenant"))
const tenantById = computed(() => new Map(tenant.value.map((scenario) => [scenario.id, scenario])))

const identities = computed(() =>
  identityOrder
    .map((id) => ({ id, label: tenantById.value.get(`tenant:${id}:task-1`)?.identity?.label ?? "No API key" }))
    .filter((entry) => tenantById.value.has(`tenant:${entry.id}:task-1`))
)
const resources = computed(() =>
  resourceOrder
    .map((id) => ({ id, label: tenantById.value.get(`tenant:anonymous:${id}`)?.label.split(" → ")[1] ?? id }))
    .filter((entry) => tenantById.value.has(`tenant:anonymous:${entry.id}`))
)

const selected = computed<Scenario | undefined>(() =>
  group.value === "basics"
    ? (basics.value.find((scenario) => scenario.id === basicId.value) ?? basics.value[0])
    : (tenantById.value.get(`tenant:${identity.value}:${resource.value}`) ?? tenant.value[0])
)

const outcomeLabel = (scenario: Scenario) =>
  scenario.id === "validation-failed"
    ? "Validation failed"
    : scenario.report.terminalDecision.state === "recorded" && scenario.report.terminalDecision.kind === "error"
      ? "Policy error"
      : scenario.outcome === "denied"
        ? "Denied"
        : scenario.outcome === "completed"
          ? "Allowed"
          : "Error"
const outcomeGlyph = (scenario: Scenario) =>
  scenario.outcome === "completed" ? "✓" : scenario.outcome === "denied" ? "✕" : "!"
const decisionGlyph = (outcome: string) =>
  ({ allow: "✓", deny: "✕", error: "!", skipped: "–" })[outcome] ?? "?"

const terminalText = (scenario: Scenario) => {
  const terminal = scenario.report.terminalDecision
  if (terminal.state === "recorded") {
    const where = `${terminal.layer} · ${terminal.phase}${terminal.policyId ? ` · ${terminal.policyId}` : ""}`
    return `${terminal.policy} (${terminal.kind === "deny" ? "denied" : "evaluation error"}; ${where})`
  }
  return terminal.state === "none" ? "None — no policy stopped the request" : "Unknown"
}

const traceText = (scenario: Scenario) => {
  const trace = scenario.report.trace
  const state = trace.truncated
    ? `truncated: ${trace.droppedDecisions} decision${trace.droppedDecisions === 1 ? "" : "s"} not recorded (limit ${trace.maxEvents})`
    : "complete"
  return `${trace.recordedDecisions} recorded, ${state}`
}

async function copy(text: string, key: string) {
  try {
    await navigator.clipboard.writeText(text)
    copied.value = key
  } catch {
    copied.value = ""
  }
}
watch([group, basicId, identity, resource], () => {
  copied.value = ""
})

onMounted(async () => {
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}demo/policy-scenarios.json`)
    if (!response.ok) throw new Error("Scenario data is unavailable")
    scenarios.value = (await response.json()) as Scenario[]
  } catch {
    loadingError.value = true
  }
})

const cellText = (id: string) => {
  const scenario = tenantById.value.get(id)
  return scenario ? `${outcomeGlyph(scenario)} ${scenario.status}` : ""
}
</script>

<template>
  <section class="trace-explorer" aria-labelledby="trace-explorer-title">
    <h2 id="trace-explorer-title" class="visually-hidden">Recorded request explorer</h2>

    <fieldset class="trace-groups">
      <legend>Scenario set</legend>
      <label><input v-model="group" type="radio" value="basics" /> Single-purpose scenarios</label>
      <label><input v-model="group" type="radio" value="tenant" /> Multi-tenant fixtures</label>
    </fieldset>

    <p v-if="loadingError" class="trace-error" role="alert">
      The recorded trace file could not be loaded. Build the site with <code>pnpm docs:build</code>
      so the demo data is generated.
    </p>
    <p v-else-if="scenarios.length === 0" class="trace-loading" role="status">
      Loading recorded traces…
    </p>

    <div v-if="group === 'basics' && basics.length > 0" class="trace-controls">
      <label for="trace-scenario">Recorded request</label>
      <select id="trace-scenario" v-model="basicId">
        <option v-for="scenario in basics" :key="scenario.id" :value="scenario.id">
          {{ scenario.label }}
        </option>
      </select>
    </div>

    <template v-if="group === 'tenant' && tenant.length > 0">
      <p class="trace-note">
        Demonstration tenants, roles and tasks from <code>examples/tenant-tasks.ts</code>. The
        selectors choose between results generated from those fixtures when the site was built;
        no backend is simulated and nothing is evaluated in your browser.
      </p>
      <div class="trace-controls trace-controls-pair">
        <div>
          <label for="trace-identity">Who is asking</label>
          <select id="trace-identity" v-model="identity">
            <option v-for="entry in identities" :key="entry.id" :value="entry.id">{{ entry.label }}</option>
          </select>
        </div>
        <div>
          <label for="trace-resource">What they ask for</label>
          <select id="trace-resource" v-model="resource">
            <option v-for="entry in resources" :key="entry.id" :value="entry.id">{{ entry.label }}</option>
          </select>
        </div>
      </div>

      <table class="trace-matrix">
        <caption>
          All combinations: symbol and HTTP status (✓ allowed, ✕ denied, ! error). Select a cell to
          show its trace.
        </caption>
        <thead>
          <tr>
            <th scope="col">Identity</th>
            <th v-for="entry in resources" :key="entry.id" scope="col">{{ entry.label }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in identities" :key="row.id">
            <th scope="row">{{ row.label }}</th>
            <td v-for="column in resources" :key="column.id">
              <button
                type="button"
                :aria-pressed="identity === row.id && resource === column.id"
                :aria-label="`${row.label}, ${column.label}: ${cellText(`tenant:${row.id}:${column.id}`)}`"
                @click="(identity = row.id), (resource = column.id)"
              >
                {{ cellText(`tenant:${row.id}:${column.id}`) }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </template>

    <div v-if="selected" class="trace-live" aria-live="polite">
      <div class="trace-result">
        <div>
          <p class="trace-eyebrow">{{ selected.method }} {{ selected.route }}</p>
          <h3>{{ selected.label }}</h3>
          <p>{{ selected.description }}</p>
        </div>
        <div class="trace-status" :class="`is-${selected.outcome}`">
          <strong><span aria-hidden="true">{{ outcomeGlyph(selected) }}</span> {{ selected.status }}</strong>
          <span>{{ outcomeLabel(selected) }}</span>
        </div>
      </div>

      <p class="trace-explanation">{{ selected.explanation }}</p>

      <dl class="trace-facts">
        <div>
          <dt>Route</dt>
          <dd>{{ selected.report.route?.method }} {{ selected.report.route?.template }}</dd>
        </div>
        <div>
          <dt>Terminal decision</dt>
          <dd>{{ terminalText(selected) }}</dd>
        </div>
        <div>
          <dt>Route handler</dt>
          <dd>{{ selected.report.handler === "executed" ? "Executed" : selected.report.handler === "not-executed" ? "Not executed" : "Unknown" }}</dd>
        </div>
        <div>
          <dt>Policy trace</dt>
          <dd>{{ traceText(selected) }}</dd>
        </div>
        <div v-if="selected.identity">
          <dt>Fixture identity</dt>
          <dd>{{ selected.identity.userId }} · {{ selected.identity.role }} · tenant {{ selected.identity.tenantId }}</dd>
        </div>
      </dl>

      <div class="trace-decisions">
        <h4>Policy decisions</h4>
        <ol v-if="selected.decisions.length > 0">
          <li v-for="(decision, index) in selected.decisions" :key="`${decision.policy}-${index}`">
            <span class="decision-location">{{ decision.layer }} · {{ decision.phase }}<template v-if="decision.policyId"> · {{ decision.policyId }}</template></span>
            <strong>{{ decision.policy }}</strong>
            <span class="decision-outcome" :class="`is-${decision.outcome}`">
              <span aria-hidden="true">{{ decisionGlyph(decision.outcome) }}</span>
              {{ decision.outcome }}<template v-if="decision.terminal"> · terminal</template>
            </span>
          </li>
        </ol>
        <p v-else>No policy decision was recorded for this request.</p>
      </div>

      <details v-if="selected.notReachedStages.length > 0" class="trace-skipped">
        <summary>Stages not reached</summary>
        <p>{{ selected.notReachedStages.join(" → ") }}</p>
      </details>

      <details class="trace-output">
        <summary>Sanitized diagnostic output</summary>
        <pre>{{ selected.formattedSummary }}</pre>
      </details>

      <div class="trace-reproduce">
        <h4>Reproduce it locally</h4>
        <p>From a repository checkout (<code>pnpm install</code> first):</p>
        <div class="trace-command">
          <pre><code>{{ selected.command }}</code></pre>
          <button type="button" @click="copy(selected.command, 'command')">
            {{ copied === "command" ? "Copied" : "Copy" }}<span class="visually-hidden"> command</span>
          </button>
        </div>
        <template v-if="selected.curl">
          <p>
            Or against the running demo server (<code>pnpm exec tsx examples/tenant-tasks-server.ts</code>,
            demonstration key only):
          </p>
          <div class="trace-command">
            <pre><code>{{ selected.curl }}</code></pre>
            <button type="button" @click="copy(selected.curl, 'curl')">
              {{ copied === "curl" ? "Copied" : "Copy" }}<span class="visually-hidden"> curl command</span>
            </button>
          </div>
        </template>
        <p class="trace-links">
          Source: <a :href="`${REPO}${selected.source}`">{{ selected.source }}</a> · Test:
          <a :href="`${REPO}${selected.test}`">{{ selected.test }}</a>
        </p>
      </div>
    </div>

    <p class="trace-disclaimer">
      Pre-recorded data generated from the real Orvaxis runtime during the site build. Selecting a
      scenario does not send a request or execute application code in your browser.
    </p>
  </section>
</template>

<style scoped>
.trace-explorer {
  margin: 1.5rem 0 2rem;
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
  padding: 1.25rem;
  background: var(--vp-c-bg-soft);
}

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}

.trace-groups {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem 1.5rem;
  margin: 0 0 1rem;
  border: 0;
  padding: 0;
}

.trace-groups legend,
.trace-controls label,
.trace-facts dt {
  color: var(--vp-c-text-2);
  font-size: 0.875rem;
  font-weight: 600;
}

.trace-groups label {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  min-height: 2.75rem;
  color: var(--vp-c-text-1);
  font-size: 0.95rem;
  font-weight: 500;
}

.trace-groups legend {
  margin-bottom: 0.25rem;
}

.trace-controls {
  display: grid;
  gap: 0.45rem;
  max-width: 32rem;
}

.trace-controls-pair {
  grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
  max-width: none;
  gap: 0.75rem;
}

.trace-controls-pair > div {
  display: grid;
  gap: 0.45rem;
}

.trace-controls select {
  width: 100%;
  min-height: 2.75rem;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  padding: 0.5rem 0.75rem;
  color: var(--vp-c-text-1);
  background: var(--vp-c-bg);
  font: inherit;
}

.trace-note {
  margin: 0 0 0.75rem;
  color: var(--vp-c-text-2);
  font-size: 0.9rem;
}

.trace-matrix {
  display: block;
  overflow-x: auto;
  margin: 1rem 0;
  font-size: 0.85rem;
}

.trace-matrix caption {
  caption-side: top;
  padding-bottom: 0.5rem;
  color: var(--vp-c-text-2);
  text-align: left;
}

.trace-matrix th,
.trace-matrix td {
  padding: 0.25rem 0.4rem;
  white-space: nowrap;
}

.trace-matrix button {
  min-width: 4rem;
  min-height: 2.75rem;
  border: 1px solid var(--vp-c-divider);
  border-radius: 6px;
  color: var(--vp-c-text-1);
  background: var(--vp-c-bg);
  font: inherit;
  cursor: pointer;
}

.trace-matrix button[aria-pressed="true"] {
  border: 2px solid var(--vp-c-brand-1);
  font-weight: 700;
}

.trace-explorer :is(select, input, button, summary, a):focus-visible {
  outline: 2px solid var(--vp-c-brand-1);
  outline-offset: 2px;
}

.trace-result {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  margin-top: 1.5rem;
}

.trace-result h3 {
  margin: 0.25rem 0;
  border: 0;
  padding: 0;
  font-size: 1.35rem;
}

.trace-result p {
  margin: 0.4rem 0;
}

.trace-explanation {
  margin: 0.75rem 0 0;
  border-left: 3px solid var(--vp-c-brand-1);
  padding-left: 0.75rem;
}

.trace-eyebrow,
.decision-location {
  color: var(--vp-c-text-2);
  font-family: var(--vp-font-family-mono);
  font-size: 0.8rem;
}

.trace-status {
  display: grid;
  flex: 0 0 auto;
  min-width: 6rem;
  justify-items: center;
  border: 2px solid currentColor;
  border-radius: 10px;
  padding: 0.5rem 0.75rem;
  background: var(--vp-c-bg);
  text-align: center;
}

.trace-status strong {
  font-size: 1.25rem;
}

.trace-status span {
  font-size: 0.8rem;
  font-weight: 600;
}

.is-completed,
.is-allow {
  color: var(--vp-c-green-1);
}

.is-denied,
.is-deny {
  color: var(--vp-c-warning-1);
}

.is-error {
  color: var(--vp-c-danger-1);
}

.trace-facts {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr));
  gap: 0.75rem;
  margin: 1.25rem 0;
}

.trace-facts div {
  min-width: 0;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  padding: 0.75rem;
  background: var(--vp-c-bg);
}

.trace-facts dd {
  margin: 0.35rem 0 0;
  overflow-wrap: anywhere;
  font-weight: 600;
}

.trace-decisions h4,
.trace-reproduce h4 {
  margin: 0 0 0.5rem;
  font-size: 1rem;
}

.trace-decisions ol {
  display: grid;
  gap: 0.5rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.trace-decisions li {
  display: grid;
  grid-template-columns: minmax(8rem, 1fr) minmax(8rem, 1fr) auto;
  align-items: baseline;
  gap: 0.4rem 0.8rem;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  padding: 0.65rem 0.75rem;
  background: var(--vp-c-bg);
}

.decision-outcome {
  justify-self: end;
  font-size: 0.85rem;
  font-weight: 600;
  text-transform: capitalize;
}

.trace-skipped,
.trace-output,
.trace-reproduce {
  margin-top: 0.75rem;
  border-top: 1px solid var(--vp-c-divider);
  padding-top: 0.75rem;
}

.trace-skipped summary,
.trace-output summary {
  min-height: 2.75rem;
  cursor: pointer;
  font-weight: 600;
}

.trace-skipped p {
  overflow-wrap: anywhere;
  color: var(--vp-c-text-2);
  font-family: var(--vp-font-family-mono);
  font-size: 0.8rem;
}

.trace-output pre {
  overflow-x: auto;
  margin-bottom: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.trace-command {
  display: flex;
  align-items: stretch;
  gap: 0.5rem;
  margin: 0.4rem 0 0.75rem;
}

.trace-command pre {
  flex: 1;
  min-width: 0;
  overflow-x: auto;
  margin: 0;
  border-radius: 8px;
  padding: 0.6rem 0.75rem;
  background: var(--vp-c-bg);
  font-size: 0.8rem;
}

.trace-command button {
  min-width: 4.5rem;
  min-height: 2.75rem;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  color: var(--vp-c-text-1);
  background: var(--vp-c-bg);
  font: inherit;
  cursor: pointer;
}

.trace-links {
  margin: 0.25rem 0 0;
  overflow-wrap: anywhere;
  font-size: 0.85rem;
}

.trace-disclaimer,
.trace-loading,
.trace-error {
  margin: 1rem 0 0;
  color: var(--vp-c-text-2);
  font-size: 0.85rem;
}

.trace-error {
  color: var(--vp-c-danger-1);
}

@media (max-width: 600px) {
  .trace-explorer {
    padding: 0.85rem;
  }

  .trace-result {
    flex-direction: column-reverse;
    align-items: stretch;
  }

  .trace-status {
    justify-self: start;
  }

  .trace-decisions li {
    grid-template-columns: 1fr auto;
  }

  .decision-location {
    grid-column: 1 / -1;
  }

  .trace-command {
    flex-direction: column;
  }
}
</style>
