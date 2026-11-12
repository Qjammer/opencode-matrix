// Builds the GUI part (gui.tsx) into the single CommonJS file that OpenCode 2.2+ loads: `npm run build`.
import { gui } from "@opencode/plugin/gui/vite"
import { defineConfig } from "vite"

export default defineConfig({ plugins: [gui({ entry: "gui.tsx", outFile: "dist/gui-experimental.cjs" })] })
