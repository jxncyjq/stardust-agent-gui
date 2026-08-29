package main

import (
	"embed"
	"os"
	"path/filepath"

	"github.com/stardust/legion-agent/serve"
	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	// Resolve to an absolute path but DO NOT chdir here. Wails runs this same
	// main() (and wails.Run) during binding generation WITHOUT calling OnStartup;
	// chdir'ing in main would move the cwd away from the wails project directory
	// and break "wails.json: cannot find the file" during `wails dev`/`build`.
	// The chdir to the config dir happens in app.startup (a real run only).
	cfgPath := resolveConfigPath()
	if cfgPath != "" {
		if abs, err := filepath.Abs(cfgPath); err == nil {
			cfgPath = abs
		}
	}

	app := NewApp(cfgPath)
	err := wails.Run(&options.App{
		Title:  "Legion Agent",
		Width:  1280,
		Height: 800,
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		OnStartup:  app.startup,
		OnShutdown: app.shutdown,
		Bind: []interface{}{
			app,
		},
	})
	if err != nil {
		println("Error:", err.Error())
	}
}

// resolveConfigPath picks the legion-agent config to load. Priority:
//  1. explicit CLI arg (os.Args[1])
//  2. LEGION_CONFIG env var
//  3. auto-discovery: search the working dir and the executable dir (walking up
//     a few levels) for agent.json or legionAgent/agent.json
//  4. the per-user default: <STARDUST_HOME or ~/.stardust>/agent.json
//
// The local search comes BEFORE the per-user default on purpose: someone who
// starts the GUI from inside a checkout that has its own agent.json means that
// one — the more specific answer wins, and that is also what every existing
// developer setup relies on. The home directory is the fallback for an
// installed GUI started from anywhere.
//
// Returns "" when nothing is found, in which case the service uses built-in
// defaults (demo response).
func resolveConfigPath() string {
	// Only honour an explicit CLI arg when it actually points to an existing
	// file. Wails / the WebView2 runtime inject their own flags as os.Args[1],
	// so a naive os.Args[1] would feed garbage to the config loader and the
	// embedded service would silently fail to start.
	for _, arg := range os.Args[1:] {
		if arg != "" && fileExists(arg) {
			return arg
		}
	}
	if env := os.Getenv("LEGION_CONFIG"); env != "" {
		return env
	}

	var roots []string
	if cwd, err := os.Getwd(); err == nil {
		roots = append(roots, cwd)
	}
	if exe, err := os.Executable(); err == nil {
		roots = append(roots, filepath.Dir(exe))
	}

	rels := []string{
		"agent.json",
		filepath.Join("legionAgent", "agent.json"),
		filepath.Join("..", "legionAgent", "agent.json"),
	}

	for _, root := range roots {
		dir := root
		for range 6 {
			for _, rel := range rels {
				cand := filepath.Join(dir, rel)
				if fileExists(cand) {
					return cand
				}
			}
			parent := filepath.Dir(dir)
			if parent == dir {
				break
			}
			dir = parent
		}
	}

	// The per-user default, shared with the CLI through the serve package
	// rather than re-derived here: two spellings of "~/.stardust/agent.json"
	// would eventually disagree.
	if fromHome := serve.DefaultConfigPathIfPresent(); fromHome != "" {
		return fromHome
	}
	return ""
}

func fileExists(p string) bool {
	info, err := os.Stat(p)
	return err == nil && !info.IsDir()
}
