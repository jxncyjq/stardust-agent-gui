package main

import (
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
