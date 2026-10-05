import { ssrRenderAttrs } from "vue/server-renderer";
import { useSSRContext } from "vue";
import { _ as _export_sfc } from "./plugin-vue_export-helper.1tPrXgE0.js";
const __pageData = JSON.parse('{"title":"Request lifecycle and policy order","description":"","frontmatter":{},"headers":[],"relativePath":"reference/lifecycle.md","filePath":"reference/lifecycle.md","lastUpdated":1791148898000}');
const _sfc_main = { name: "reference/lifecycle.md" };
function _sfc_ssrRender(_ctx, _push, _parent, _attrs, $props, $setup, $data, $options) {
  _push(`<div${ssrRenderAttrs(_attrs)}><h1 id="request-lifecycle-and-policy-order" tabindex="-1">Request lifecycle and policy order <a class="header-anchor" href="#request-lifecycle-and-policy-order" aria-label="Permalink to &quot;Request lifecycle and policy order&quot;">​</a></h1><p>Orvaxis separates authorization decisions, request flow, lifecycle hooks, and route handling. The runtime executes these stages in this order for a matched request:</p><ol><li>Validate the request and run <code>onRequest</code>.</li><li>Match a route; unmatched paths and wrong methods go through <code>onNotFound</code> or <code>onMethodNotAllowed</code>.</li><li>Evaluate pre-validation policies: global, group, then route. Within each layer, higher <code>priority</code> runs first; equal priorities retain declaration order.</li><li>Run <code>beforePipeline</code>, the global <code>app.use()</code> pipeline, group middleware, and route middleware.</li><li>Run <code>onValidation</code>; <code>schemaValidationPlugin</code> parses declared request fields here.</li><li>Evaluate post-validation policies in global, group, route order.</li><li>Run <code>beforeHandler</code>, the route handler, <code>afterHandler</code>, finalize the trace, then run <code>afterPipeline</code>.</li></ol><p>Any denial or unhandled error stops the remaining stages. A successful short-circuit response from a hook or middleware also stops later stages and completes through <code>afterPipeline</code>. <code>afterHandler</code> runs only when the route handler has run and completed. Errors before completion finalize the trace before <code>onError</code> and skip <code>afterPipeline</code>.</p><div class="language-text vp-adaptive-theme"><button title="Copy Code" class="copy"></button><span class="lang">text</span><pre class="shiki shiki-themes github-light github-dark vp-code" tabindex="0"><code><span class="line"><span>onRequest → route match → pre-validation policies</span></span>
<span class="line"><span>          → beforePipeline → global → group → route middleware</span></span>
<span class="line"><span>          → onValidation → post-validation policies</span></span>
<span class="line"><span>          → beforeHandler → handler → afterHandler</span></span>
<span class="line"><span>          → trace finalization → afterPipeline</span></span></code></pre></div><p>Post-validation policies must declare a non-empty <code>requires</code> list (<code>body</code>, <code>params</code>, <code>query</code>, or <code>headers</code>). The matching route must declare every required schema, and <code>schemaValidationPlugin</code> must be registered. Otherwise Orvaxis returns a configuration error rather than evaluating against unvalidated data.</p><p>Policy scopes filter a policy by method and path. String path scopes match the named path and its descendants at segment boundaries; regular expressions and predicates are evaluated per request. A policy can deny with a status and reason. The first denial is terminal; subsequent policies do not execute.</p><p>Policy trace collection defaults to a bounded summary of at most 100 decisions. It excludes request values and free-form denial reasons. Use <code>formatExecutionSummary(ctx)</code> to identify the terminal policy and skipped stages. Detailed traces require an explicit reason redactor. See the <a href="./../guide/diagnose-403.html">403 diagnostic guide</a> for a practical workflow.</p></div>`);
}
const _sfc_setup = _sfc_main.setup;
_sfc_main.setup = (props, ctx) => {
  const ssrContext = useSSRContext();
  (ssrContext.modules || (ssrContext.modules = /* @__PURE__ */ new Set())).add("reference/lifecycle.md");
  return _sfc_setup ? _sfc_setup(props, ctx) : void 0;
};
const lifecycle = /* @__PURE__ */ _export_sfc(_sfc_main, [["ssrRender", _sfc_ssrRender]]);
export {
  __pageData,
  lifecycle as default
};
