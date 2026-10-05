<script setup lang="ts">
import { computed, onMounted, ref } from "vue"

type PolicyDecision = {
  policy: string
  layer: string
  phase: string
  outcome: string
  terminal: boolean
}

type PolicyScenario = {
  id: string
  label: string
  description: string
  method: string
  route: string
  status: number
  outcome: "completed" | "denied" | "error"
  terminalPolicy: string | null
  handlerExecuted: boolean
  decisions: PolicyDecision[]
  notReachedStages: string[]
  formattedSummary: string
}

const scenarios = ref<PolicyScenario[]>([])
const selectedId = ref("denied")
const loadingError = ref(false)
const selectedScenario = computed(
  () => scenarios.value.find((scenario) => scenario.id === selectedId.value) ?? scenarios.value[0]
)

onMounted(async () => {
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}demo/policy-scenarios.json`)
    if (!response.ok) throw new Error("Scenario data is unavailable")
    scenarios.value = (await response.json()) as PolicyScenario[]
  } catch {
    loadingError.value = true
  }
})
</script>

<template>
  <section class="trace-explorer" aria-labelledby="trace-explorer-title">
    <div class="trace-controls">
      <label for="trace-scenario">Choose a recorded request</label>
      <select id="trace-scenario" v-model="selectedId" :disabled="scenarios.length === 0">
        <option v-for="scenario in scenarios" :key="scenario.id" :value="scenario.id">
          {{ scenario.label }} · {{ scenario.method }} {{ scenario.route }}
        </option>
      </select>
    </div>

    <p v-if="loadingError" class="trace-error" role="alert">
      The recorded trace file could not be loaded. Build the site with <code>pnpm docs:build</code>
      so the demo data is generated.
    </p>
    <p v-else-if="scenarios.length === 0" class="trace-loading" role="status">
      Loading recorded traces…
    </p>

    <template v-if="selectedScenario">
      <div class="trace-result">
        <div>
          <p class="trace-eyebrow">{{ selectedScenario.method }} {{ selectedScenario.route }}</p>
          <h2 id="trace-explorer-title">{{ selectedScenario.label }}</h2>
          <p>{{ selectedScenario.description }}</p>
        </div>
        <div
          class="trace-status"
          :class="`is-${selectedScenario.outcome}`"
          :aria-label="`${selectedScenario.outcome}, HTTP ${selectedScenario.status}`"
        >
          <strong>{{ selectedScenario.status }}</strong>
          <span>{{ selectedScenario.outcome }}</span>
        </div>
      </div>

      <dl class="trace-facts">
        <div>
          <dt>Terminal policy</dt>
          <dd>{{ selectedScenario.terminalPolicy ?? "None — policies allowed the request" }}</dd>
        </div>
        <div>
          <dt>Route handler</dt>
          <dd>{{ selectedScenario.handlerExecuted ? "Executed" : "Skipped" }}</dd>
        </div>
      </dl>

      <div class="trace-decisions">
        <h3>Policy decisions</h3>
        <ol v-if="selectedScenario.decisions.length > 0">
          <li v-for="(decision, index) in selectedScenario.decisions" :key="`${decision.policy}-${index}`">
            <span class="decision-location">{{ decision.layer }} · {{ decision.phase }}</span>
            <strong>{{ decision.policy }}</strong>
            <span class="decision-outcome" :class="`is-${decision.outcome}`">
              {{ decision.outcome }}<template v-if="decision.terminal"> · terminal</template>
            </span>
          </li>
        </ol>
        <p v-else>No policy decision was recorded for this request.</p>
      </div>

      <details v-if="selectedScenario.notReachedStages.length > 0" class="trace-skipped">
        <summary>Stages not reached</summary>
        <p>{{ selectedScenario.notReachedStages.join(" → ") }}</p>
      </details>

      <details class="trace-output">
        <summary>Sanitized diagnostic output</summary>
        <pre>{{ selectedScenario.formattedSummary }}</pre>
      </details>
    </template>

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

.trace-controls {
  display: grid;
  gap: 0.45rem;
  max-width: 32rem;
}

.trace-controls label,
.trace-facts dt {
  color: var(--vp-c-text-2);
  font-size: 0.875rem;
  font-weight: 600;
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

.trace-result {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  margin-top: 1.5rem;
}

.trace-result h2 {
  margin: 0.25rem 0;
  border: 0;
  padding: 0;
  font-size: 1.35rem;
}

.trace-result p {
  margin: 0.4rem 0;
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
  min-width: 5rem;
  justify-items: center;
  border: 1px solid var(--vp-c-divider);
  border-radius: 10px;
  padding: 0.5rem 0.75rem;
  background: var(--vp-c-bg);
  text-transform: capitalize;
}

.trace-status strong {
  font-size: 1.25rem;
}

.trace-status span {
  font-size: 0.75rem;
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

.trace-decisions h3 {
  margin-bottom: 0.5rem;
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
.trace-output {
  margin-top: 0.75rem;
  border-top: 1px solid var(--vp-c-divider);
  padding-top: 0.75rem;
}

.trace-skipped summary,
.trace-output summary {
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
    align-items: center;
  }

  .trace-decisions li {
    grid-template-columns: 1fr auto;
  }

  .decision-location {
    grid-column: 1 / -1;
  }
}
</style>
