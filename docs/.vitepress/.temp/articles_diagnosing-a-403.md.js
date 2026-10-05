import { ssrRenderAttrs, ssrRenderStyle } from "vue/server-renderer";
import { useSSRContext } from "vue";
import { _ as _export_sfc } from "./plugin-vue_export-helper.1tPrXgE0.js";
const __pageData = JSON.parse('{"title":"Find the policy behind an API 403","description":"","frontmatter":{},"headers":[],"relativePath":"articles/diagnosing-a-403.md","filePath":"articles/diagnosing-a-403.md","lastUpdated":1791149551000}');
const _sfc_main = { name: "articles/diagnosing-a-403.md" };
function _sfc_ssrRender(_ctx, _push, _parent, _attrs, $props, $setup, $data, $options) {
  _push(`<div${ssrRenderAttrs(_attrs)}><h1 id="find-the-policy-behind-an-api-403" tabindex="-1">Find the policy behind an API 403 <a class="header-anchor" href="#find-the-policy-behind-an-api-403" aria-label="Permalink to &quot;Find the policy behind an API 403&quot;">​</a></h1><p>An HTTP status tells a client what happened; it rarely tells the maintainer which authorization rule caused it. Orvaxis records policy decisions on the request trace, so a denied request can identify the terminal policy and confirm that the handler was skipped.</p><h2 id="reproduce-the-denial" tabindex="-1">Reproduce the denial <a class="header-anchor" href="#reproduce-the-denial" aria-label="Permalink to &quot;Reproduce the denial&quot;">​</a></h2><p>Clone the repository, install its dependencies, and run the diagnostics example:</p><div class="language-bash vp-adaptive-theme"><button title="Copy Code" class="copy"></button><span class="lang">bash</span><pre class="shiki shiki-themes github-light github-dark vp-code" tabindex="0"><code><span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#6F42C1", "--shiki-dark": "#B392F0" })}">pnpm</span><span style="${ssrRenderStyle({ "--shiki-light": "#032F62", "--shiki-dark": "#9ECBFF" })}"> install</span></span>
<span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#6F42C1", "--shiki-dark": "#B392F0" })}">pnpm</span><span style="${ssrRenderStyle({ "--shiki-light": "#032F62", "--shiki-dark": "#9ECBFF" })}"> exec</span><span style="${ssrRenderStyle({ "--shiki-light": "#032F62", "--shiki-dark": "#9ECBFF" })}"> tsx</span><span style="${ssrRenderStyle({ "--shiki-light": "#032F62", "--shiki-dark": "#9ECBFF" })}"> examples/policy-diagnostics.ts</span></span></code></pre></div><p>The denied case prints a summary like this:</p><div class="language-text vp-adaptive-theme"><button title="Copy Code" class="copy"></button><span class="lang">text</span><pre class="shiki shiki-themes github-light github-dark vp-code" tabindex="0"><code><span class="line"><span>=== DENIED (403) ===</span></span>
<span class="line"><span>GET /:id</span></span>
<span class="line"><span>Outcome: denied (403)</span></span>
<span class="line"><span>Policy decisions:</span></span>
<span class="line"><span>  [route.preValidation #1] document-owner: deny, terminal</span></span>
<span class="line"><span>Stopped by: document-owner</span></span>
<span class="line"><span>Not reached: beforePipeline → globalPipeline → groupMiddleware → routeMiddleware → validation → global.postValidation → group.postValidation → route.postValidation → beforeHandler → handler</span></span></code></pre></div><p><code>formatExecutionSummary()</code> formats decisions already captured by the runtime. It does not call policy code a second time, and its default output omits request values and free-form denial reasons. A maintainer can see that <code>document-owner</code> denied this request before any middleware or handler ran.</p><h2 id="fix-the-cause-then-keep-a-regression-case" tabindex="-1">Fix the cause, then keep a regression case <a class="header-anchor" href="#fix-the-cause-then-keep-a-regression-case" aria-label="Permalink to &quot;Fix the cause, then keep a regression case&quot;">​</a></h2><p>Inspect the named policy and its inputs: the route template, authenticated identity, resource owner, and any tenant boundary. Avoid changing a policy based only on the status code. Add the failing request as a permission-matrix scenario and assert the terminal policy and <code>handlerExecuted: false</code> as well as the status.</p><p>The companion <a href="./../guide/multi-tenant-demo.html">multi-tenant task demo</a> demonstrates a user who belongs to the tenant but does not own the requested task. Run <code>pnpm check:tenant-demo</code> to see the <code>task-owner-or-admin</code> denial and the separate <code>tenant-access</code> denial for a user from another tenant.</p><p>Keep detailed reasons out of normal traces if they can contain user-controlled or private data. Orvaxis summary traces retain the policy name, layer, phase, order, and outcome; detailed mode requires an explicit reason redactor.</p></div>`);
}
const _sfc_setup = _sfc_main.setup;
_sfc_main.setup = (props, ctx) => {
  const ssrContext = useSSRContext();
  (ssrContext.modules || (ssrContext.modules = /* @__PURE__ */ new Set())).add("articles/diagnosing-a-403.md");
  return _sfc_setup ? _sfc_setup(props, ctx) : void 0;
};
const diagnosingA403 = /* @__PURE__ */ _export_sfc(_sfc_main, [["ssrRender", _sfc_ssrRender]]);
export {
  __pageData,
  diagnosingA403 as default
};
