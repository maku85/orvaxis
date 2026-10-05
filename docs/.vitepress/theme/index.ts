import DefaultTheme from "vitepress/theme"
import TraceExplorer from "./components/TraceExplorer.vue"

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component("TraceExplorer", TraceExplorer)
  },
}
