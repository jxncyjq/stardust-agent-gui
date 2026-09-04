# legionAgentGUI

Legion Agent 的桌面界面（Wails v2 + React + TypeScript）。它在自己的进程里起一个
legion-agent 服务，界面通过 Go 绑定与它对话。

工程配置见 `wails.json`（字段说明：https://wails.io/docs/reference/project-config）。

## 开发运行

```
wails dev -m
```

或者用仓里的启动器（它还会顺带检查 node / wails CLI / 工作区）：

```
run.bat dev
```

**`-m` 不是省时间，是必需的。** `wails dev` 与 `wails build` 默认先跑
`go mod tidy`（wails 的 `build.go`：`GoModTidy = !SkipModTidy`），而
**`go mod tidy` 不认工作区的 replace**——它按单模块模式解析，于是会去公网拉那个
从未发布的兄弟模块 `github.com/stardust/legion-agent@v0.0.0`，报
`Repository not found` 后直接退出。裸跑 `wails dev` 今天必挂。

那条 replace 写在 `../go.work` 而不是本模块的 `go.mod` 里，是有意的：一个工作区内
两个模块之间的依赖不属于任何一个模块自身。代价就是这条——**只要 legion-agent 没有
发布，本模块就跑不了 `go mod tidy`，`go.mod` 的依赖增减要手工维护**。

`wails dev` 起来之后：桌面窗口是主界面；同一份前端也挂在
http://localhost:34115，用浏览器打开可以直接调 Go 绑定，适合调试。前端自身的
热更新由 Vite 提供（http://localhost:5173）。

指定配置文件（默认走配置发现链）：

```
run.bat run -Config agent.json
```

也可以用环境变量 `LEGION_CONFIG=<path>`，`wails dev` 会把它传给内嵌的服务。

## 打包

```
wails build -m
```

三平台打包由 `.github/workflows/package.yml` 负责（Linux 上另需
`-tags webkit2_41`，理由写在该文件的注释里）。

## 测试

前端测试**必须在 `frontend/` 目录里跑**——仓根另有一个没有配 jsdom 的 vitest，
在那里跑会得到 `document is not defined` 这种假失败：

```
cd frontend && npx vitest run
```

Go 侧：

```
go build ./... && go test ./...
```
