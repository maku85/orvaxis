import { ssrRenderAttrs } from "vue/server-renderer";
import { useSSRContext } from "vue";
import { _ as _export_sfc } from "./plugin-vue_export-helper.1tPrXgE0.js";
const __pageData = JSON.parse('{"title":"Examples","description":"","frontmatter":{},"headers":[],"relativePath":"examples/index.md","filePath":"examples/index.md","lastUpdated":null}');
const _sfc_main = { name: "examples/index.md" };
function _sfc_ssrRender(_ctx, _push, _parent, _attrs, $props, $setup, $data, $options) {
  _push(`<div${ssrRenderAttrs(_attrs)}><h1 id="examples" tabindex="-1">Examples <a class="header-anchor" href="#examples" aria-label="Permalink to &quot;Examples&quot;">​</a></h1><p>The examples are executable repository sources. They are not copied into this page, so the commands and implementation can be reviewed together.</p><table tabindex="0"><thead><tr><th>Goal</th><th>Guide or source</th><th>Run/check</th></tr></thead><tbody><tr><td>Protect a route and inspect a denial</td><td><a href="https://github.com/maku85/orvaxis/blob/main/examples/quickstart.ts" target="_blank" rel="noreferrer">Quickstart source</a></td><td><code>pnpm exec tsx examples/quickstart.ts</code></td></tr><tr><td>Wrap an existing Express route</td><td><a href="/orvaxis/guide/integrate-existing-route.html">Integration guide</a></td><td>Run the example command documented in the guide</td></tr><tr><td>Diagnose a terminal 403</td><td><a href="/orvaxis/guide/diagnose-403.html">403 guide</a></td><td><code>pnpm exec tsx examples/policy-diagnostics.ts</code></td></tr><tr><td>Enforce tenant membership and task ownership</td><td><a href="/orvaxis/guide/multi-tenant-demo.html">Multi-tenant demo</a></td><td><code>pnpm check:tenant-demo</code>; server: <code>pnpm exec tsx examples/tenant-tasks-server.ts</code></td></tr><tr><td>Review execution costs</td><td><a href="/orvaxis/benchmarks.html">Benchmarks</a></td><td><code>pnpm bench:run</code></td></tr></tbody></table><p>The Express demo uses in-memory fixtures and demonstration credentials. Do not treat them as production authentication, authorization data, or persistent storage.</p></div>`);
}
const _sfc_setup = _sfc_main.setup;
_sfc_main.setup = (props, ctx) => {
  const ssrContext = useSSRContext();
  (ssrContext.modules || (ssrContext.modules = /* @__PURE__ */ new Set())).add("examples/index.md");
  return _sfc_setup ? _sfc_setup(props, ctx) : void 0;
};
const index = /* @__PURE__ */ _export_sfc(_sfc_main, [["ssrRender", _sfc_ssrRender]]);
export {
  __pageData,
  index as default
};
