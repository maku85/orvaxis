import DefaultTheme from "vitepress/theme"
import HomeBanner from "./components/HomeBanner.vue"
import TraceExplorer from "./components/TraceExplorer.vue"

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component("HomeBanner", HomeBanner)
    app.component("TraceExplorer", TraceExplorer)
  },
}
