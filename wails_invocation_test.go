package main

import (
	"os"
	"strings"
	"testing"
)

// TestEveryWailsCommandLineSkipsModTidy pins the one flag this module cannot be
// built or run without.
//
// `wails dev` and `wails build` run `go mod tidy` first (build.go: GoModTidy =
// !SkipModTidy), and **go mod tidy does not honour a workspace replace** — it
// resolves in single-module mode, so it tries to fetch the unpublished sibling
// github.com/stardust/legion-agent@v0.0.0 and dies with "Repository not found".
// The replace lives in go.work on purpose (a dependency between two modules of
// one workspace is not a property of either module), so -m is not a
// convenience: without it nothing in this repo starts.
//
// CI and run.bat already knew this; the README did not, which is how the
// 2026-09-04 walkthrough lost its first twenty minutes to the command the
// project's own front page tells people to run. This checks every file that
// hands someone a command line, so fixing one and missing the others fails
// here rather than on a newcomer's machine.
//
// It reads a COMMAND LINE only: a line whose first word (after an optional
// shell-script "run:" or list-item marker) is `wails`. Prose that merely names
// the command, an `echo` describing it, and a CI job title are not commands and
// must not be forced to carry the flag — a guard that made people write -m in a
// sentence would be trained around within a week.
func TestEveryWailsCommandLineSkipsModTidy(t *testing.T) {
	for _, path := range []string{"README.md", "run.bat", ".github/workflows/package.yml"} {
		content, err := os.ReadFile(path)
		if err != nil {
			t.Fatalf("read %s: %v", path, err)
		}
		commands := wailsCommandLines(string(content))
		if len(commands) == 0 {
			t.Errorf("%s carries no wails dev/build command line; if the instructions moved, move this check with them", path)
			continue
		}
		for _, line := range commands {
			if !hasSkipModTidyFlag(line) {
				t.Errorf("%s runs %q without -m; go mod tidy cannot resolve the workspace replace, so this command fails with \"Repository not found\"", path, line)
			}
		}
	}
}

// wailsCommandLines returns the lines of content that RUN wails dev/build,
// stripped of leading shell/YAML decoration.
func wailsCommandLines(content string) []string {
	var out []string
	for _, raw := range strings.Split(content, "\n") {
		line := strings.TrimSpace(strings.ReplaceAll(raw, "\r", ""))
		line = strings.TrimPrefix(line, "run: ")
		line = strings.TrimPrefix(line, "$ ")
		fields := strings.Fields(line)
		if len(fields) < 2 || fields[0] != "wails" {
			continue
		}
		if fields[1] != "dev" && fields[1] != "build" {
			continue
		}
		out = append(out, line)
	}
	return out
}

// hasSkipModTidyFlag reports whether a wails command line carries -m as its own
// argument, not as a prefix of some other flag.
func hasSkipModTidyFlag(line string) bool {
	for _, field := range strings.Fields(line) {
		if field == "-m" {
			return true
		}
	}
	return false
}
