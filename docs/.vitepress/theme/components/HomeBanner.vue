<script setup lang="ts">
// One source for README and site; the file is also served from raw.githubusercontent.com.
import banner from "../../../../assets/orvaxis-banner.webp"
</script>

<template>
  <figure class="home-banner">
    <img
      :src="banner"
      alt="Orvaxis organizes Node.js API execution with routing, policies, middleware and hooks, typed input and response contracts, OpenAPI, tracing and testing, using Express or Fastify transport."
      width="1536"
      height="1024"
    />
    <figcaption>Structure request execution, validate contracts, and observe and test your API.</figcaption>
  </figure>
</template>

<style scoped>
.home-banner {
  margin: 1rem 0 3rem;
  overflow: hidden;
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
  background: #080d1d;
}

.home-banner img {
  display: block;
  width: 100%;
  height: auto;
}

.home-banner figcaption {
  padding: 0.75rem 1rem;
  color: var(--vp-c-text-2);
  font-size: 0.875rem;
  text-align: center;
}
</style>
