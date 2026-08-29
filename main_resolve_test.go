package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// TestResolveConfigPath verifies that when the GUI starts from its own package
// directory (the dev cwd), it auto-discovers the sibling legionAgent/agent.json.
func TestResolveConfigPath(t *testing.T) {
	got := resolveConfigPath()
	if got == "" {
		t.Fatal("resolveConfigPath returned empty; expected to find legionAgent/agent.json")
	}
	abs, err := filepath.Abs(got)
	if err != nil {
		t.Fatalf("abs: %v", err)
	}
	if !strings.HasSuffix(filepath.ToSlash(abs), "legionAgent/agent.json") {
		t.Fatalf("resolveConfigPath = %q, want a path ending in legionAgent/agent.json", abs)
	}
	if !fileExists(abs) {
		t.Fatalf("resolved path does not exist: %q", abs)
	}
	t.Logf("resolved config: %s", abs)
}

// TestResolveConfigPathFallsBackToTheUserDefault covers the last link in the
// chain: an installed GUI started from a directory with no agent.json anywhere
// above it still finds <STARDUST_HOME or ~/.stardust>/agent.json.
//
// It runs from a temp directory precisely because the test above proves the
// local search wins when there IS something local — this one must have nothing
// local left to find.
func TestResolveConfigPathFallsBackToTheUserDefault(t *testing.T) {
	home := t.TempDir()
	t.Setenv("STARDUST_HOME", home)
	t.Setenv("LEGION_CONFIG", "")
	t.Chdir(t.TempDir())

	want := filepath.Join(home, "agent.json")
	if err := os.WriteFile(want, []byte(`{}`), 0o600); err != nil {
		t.Fatalf("WriteFile(%q) error = %v, want nil", want, err)
	}

	if got := resolveConfigPath(); got != want {
		t.Errorf("resolveConfigPath() = %q, want the per-user default %q", got, want)
	}
}

// TestResolveConfigPathIsEmptyWithNothingAnywhere pins the supported "no
// config at all" state: the service then runs on built-in defaults, which is
// what a fresh install looks like. Returning some guessed path instead would
// send the loader after a file nobody created.
func TestResolveConfigPathIsEmptyWithNothingAnywhere(t *testing.T) {
	t.Setenv("STARDUST_HOME", t.TempDir())
	t.Setenv("LEGION_CONFIG", "")
	t.Chdir(t.TempDir())

	if got := resolveConfigPath(); got != "" {
		t.Errorf("resolveConfigPath() = %q, want \"\" when nothing exists anywhere", got)
	}
}
