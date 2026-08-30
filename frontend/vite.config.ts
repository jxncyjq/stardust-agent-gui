import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vitejs.dev/config/
// defineConfig comes from 'vitest/config' (a superset of vite's) so the
// `test` block below type-checks; the `plugins`/build config still applies
// to the plain `vite build` used by `npm run build`.
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  // Vite's default esbuild target (es2020 baseline) predates top-level await.
  // src/lib/highlighter.ts builds its Shiki highlighter with a module-level
  // `await`, and this app only ships inside Wails' bundled Chromium/WebKit
  // webview (not arbitrary older browsers), so es2022 — the first target with
  // TLA support — is safe here.
  build: {
    target: 'es2022',
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    // 每个测试文件一个 forked 子进程 + 一个 jsdom；vitest 默认按 CPU 数开（这台机器
    // 28 个）。开满时**大约六成的运行会有一个子进程原生崩掉**，症状是
    // "Worker exited unexpectedly"：那个文件里的用例一条都没跑，而汇总行照样是
    // "all passed"，只是文件数从 50 变成 49——一次 CI 绿灯下少跑十几个用例，比一条
    // 红线危险得多。
    //
    // 实测（本机 28 核）：不限 60% 崩、8 个 1/5 崩、**4 个 8/8 干净**、串行 6/6 干净。
    // 时间代价：不限 ~5s、4 个 ~13.5s、串行 ~46s。取 4。
    //
    // 这是把并发压到资源够用的水位，不是修好了那个原生崩溃——真正的根因（哪一层在
    // 高并发 jsdom 下崩）还没查到，所以这里写下的是测量结果而不是结论。
    maxWorkers: 4,
    minWorkers: 1,
  },
})
