package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const (
	validMain    = `{"storage":{"driver":"memory"}}`
	validAgent   = `{"id":"researcher","role":"researcher","maas_profile":"dev"}`
	invalidAgent = `{"id":"researcher","workspace":"not-an-object"}`
)

// newTestApp writes a valid main config into a temp dir and returns an App
// pointed at it, plus the config path.
func newTestApp(t *testing.T) (*App, string) {
	t.Helper()
	dir := t.TempDir()
	p := filepath.Join(dir, "agent.json")
	if err := os.WriteFile(p, []byte(validMain), 0o644); err != nil {
		t.Fatal(err)
	}
	return NewApp(p), p
}

// assertNoTempFiles fails when a staging temp file was left behind in dir.
func assertNoTempFiles(t *testing.T, dir string) {
	t.Helper()
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range entries {
		if strings.Contains(e.Name(), ".tmp-") {
			t.Fatalf("temp file left behind: %s", e.Name())
		}
	}
}

func TestGetConfigReturnsRawFile(t *testing.T) {
	a, _ := newTestApp(t)
	got, err := a.GetConfig()
	if err != nil {
		t.Fatalf("GetConfig: %v", err)
	}
	if got != validMain {
		t.Fatalf("GetConfig = %q, want %q", got, validMain)
	}
}

func TestGetConfigEmptyPathErrors(t *testing.T) {
	a := NewApp("")
	if _, err := a.GetConfig(); err == nil {
		t.Fatal("expected error for empty config path")
	}
}

func TestGetConfigPath(t *testing.T) {
	a, p := newTestApp(t)
	got, err := a.GetConfigPath()
	if err != nil {
		t.Fatal(err)
	}
	if got != p {
		t.Fatalf("GetConfigPath = %q, want %q", got, p)
	}
}

func TestWriteAllReplacesMainAndBacksUp(t *testing.T) {
	a, p := newTestApp(t)
	newRaw := `{"storage":{"driver":"memory"},"runtime":{"max_tool_rounds":7}}`
	if err := a.writeAll(newRaw, nil); err != nil {
		t.Fatalf("writeAll: %v", err)
	}
	got, _ := os.ReadFile(p)
	if string(got) != newRaw {
		t.Fatalf("main config not replaced: %s", got)
	}
	bak, err := os.ReadFile(p + ".bak")
	if err != nil {
		t.Fatalf("backup missing: %v", err)
	}
	if string(bak) != validMain {
		t.Fatalf("backup wrong: %s", bak)
	}
}

func TestWriteAllRejectsInvalidMainLeavingFileUntouched(t *testing.T) {
	a, p := newTestApp(t)
	if err := a.writeAll(`{"storage":"not-an-object"}`, nil); err == nil {
		t.Fatal("invalid main config accepted")
	}
	got, _ := os.ReadFile(p)
	if string(got) != validMain {
		t.Fatalf("live file changed on rejected save: %s", got)
	}
	if _, err := os.Stat(p + ".bak"); !os.IsNotExist(err) {
		t.Fatal("backup written for a rejected save")
	}
	assertNoTempFiles(t, filepath.Dir(p))
}

func TestWriteAllCreatesNewAgentFile(t *testing.T) {
	a, p := newTestApp(t)
	dir := filepath.Dir(p)
	// The agent config lives in a subdirectory that does not exist yet — the
	// "added a sub-agent from the UI" case.
	if err := a.writeAll(validMain, map[string]string{"configs/agents/researcher.json": validAgent}); err != nil {
		t.Fatalf("writeAll with new agent file: %v", err)
	}
	agentPath := filepath.Join(dir, "configs", "agents", "researcher.json")
	got, err := os.ReadFile(agentPath)
	if err != nil {
		t.Fatalf("agent config not created: %v", err)
	}
	if string(got) != validAgent {
		t.Fatalf("agent config content = %s", got)
	}
	// A brand-new file has nothing to back up.
	if _, err := os.Stat(agentPath + ".bak"); !os.IsNotExist(err) {
		t.Fatal("backup written for a brand-new agent file")
	}
}

func TestWriteAllUpdatesExistingAgentFileAndBacksUp(t *testing.T) {
	a, p := newTestApp(t)
	agentPath := filepath.Join(filepath.Dir(p), "sub.json")
	original := `{"id":"old","role":"old","maas_profile":"dev"}`
	if err := os.WriteFile(agentPath, []byte(original), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := a.writeAll(validMain, map[string]string{"sub.json": validAgent}); err != nil {
		t.Fatalf("writeAll: %v", err)
	}
	got, _ := os.ReadFile(agentPath)
	if string(got) != validAgent {
		t.Fatalf("agent config not replaced: %s", got)
	}
	bak, err := os.ReadFile(agentPath + ".bak")
	if err != nil {
		t.Fatalf("agent backup missing: %v", err)
	}
	if string(bak) != original {
		t.Fatalf("agent backup wrong: %s", bak)
	}
}

// An invalid sub-agent file must abort the whole save: the main config here is
// valid, but nothing at all may be written, since the save is one unit.
func TestWriteAllRejectsInvalidAgentAndWritesNothing(t *testing.T) {
	a, p := newTestApp(t)
	newMain := `{"storage":{"driver":"memory"},"runtime":{"max_tool_rounds":9}}`
	if err := a.writeAll(newMain, map[string]string{"sub.json": invalidAgent}); err == nil {
		t.Fatal("invalid agent config accepted")
	}
	got, _ := os.ReadFile(p)
	if string(got) != validMain {
		t.Fatalf("main config was written despite an invalid agent file: %s", got)
	}
	if _, err := os.Stat(p + ".bak"); !os.IsNotExist(err) {
		t.Fatal("backup written for a rejected save")
	}
	if _, err := os.Stat(filepath.Join(filepath.Dir(p), "sub.json")); !os.IsNotExist(err) {
		t.Fatal("invalid agent file was written")
	}
	assertNoTempFiles(t, filepath.Dir(p))
}

func TestWriteAllRejectsAgentPathEscapingConfigDir(t *testing.T) {
	a, p := newTestApp(t)
	err := a.writeAll(validMain, map[string]string{"../escape.json": validAgent})
	if err == nil {
		t.Fatal("agent path escaping the config dir accepted")
	}
	if !strings.Contains(err.Error(), "escapes the config directory") {
		t.Fatalf("error = %v, want an escape rejection", err)
	}
	got, _ := os.ReadFile(p)
	if string(got) != validMain {
		t.Fatalf("main config written despite a rejected agent path: %s", got)
	}
	assertNoTempFiles(t, filepath.Dir(p))
}

func TestResolveAgentPathRejectsEscapes(t *testing.T) {
	a, _ := newTestApp(t)
	for _, rel := range []string{"../outside.json", "..", ""} {
		if _, err := a.resolveAgentPath(rel); err == nil {
			t.Fatalf("resolveAgentPath(%q) accepted; want error", rel)
		}
	}
}

func TestGetAgentConfigMissingFileReportsNotExists(t *testing.T) {
	a, _ := newTestApp(t)
	res, err := a.GetAgentConfig("configs/agents/nope.json")
	if err != nil {
		t.Fatalf("GetAgentConfig on a missing file returned an error: %v", err)
	}
	if res.Exists {
		t.Fatal("Exists = true for a missing file")
	}
	if res.Content != "" {
		t.Fatalf("Content = %q, want empty for a missing file", res.Content)
	}
}

func TestGetAgentConfigReturnsRawFile(t *testing.T) {
	a, p := newTestApp(t)
	agentPath := filepath.Join(filepath.Dir(p), "sub.json")
	if err := os.WriteFile(agentPath, []byte(validAgent), 0o644); err != nil {
		t.Fatal(err)
	}
	res, err := a.GetAgentConfig("sub.json")
	if err != nil {
		t.Fatalf("GetAgentConfig: %v", err)
	}
	if !res.Exists || res.Content != validAgent {
		t.Fatalf("GetAgentConfig = %+v, want the raw agent JSON", res)
	}
}
