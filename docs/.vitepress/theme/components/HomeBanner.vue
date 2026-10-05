<script setup lang="ts">
import banner from "./orvaxis-banner.png"
</script>

<template>
  <figure class="home-banner">
    <img
      :src="banner"
      alt="An API request is denied by the report-owner policy. The diagnostic trace identifies the policy and shows that the route handler did not run."
      width="1536"
      height="1024"
    />
    <figcaption>Follow a denied request from its policy decision to the handler it prevented.</figcaption>
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
