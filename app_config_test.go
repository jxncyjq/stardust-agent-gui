package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestGetConfigReturnsRawFile(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "agent.json")
	content := `{"storage":{"driver":"memory"}}`
	if err := os.WriteFile(p, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	a := NewApp(p)
	got, err := a.GetConfig()
	if err != nil {
		t.Fatalf("GetConfig: %v", err)
	}
	if got != content {
		t.Fatalf("GetConfig = %q, want %q", got, content)
	}
}

func TestGetConfigEmptyPathErrors(t *testing.T) {
	a := NewApp("")
	if _, err := a.GetConfig(); err == nil {
		t.Fatal("expected error for empty config path")
	}
}

func TestGetConfigPath(t *testing.T) {
	a := NewApp("/tmp/x/agent.json")
	got, err := a.GetConfigPath()
	if err != nil {
		t.Fatal(err)
	}
	if got != "/tmp/x/agent.json" {
		t.Fatalf("GetConfigPath = %q", got)
	}
}

func TestWriteConfigReplacesAndBacksUp(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "agent.json")
	original := `{"storage":{"driver":"memory"}}`
	if err := os.WriteFile(p, []byte(original), 0o644); err != nil {
		t.Fatal(err)
	}
	a := NewApp(p)
	newRaw := `{"storage":{"driver":"memory"},"runtime":{"max_tool_rounds":7}}`
	if err := a.writeConfig(newRaw); err != nil {
		t.Fatalf("writeConfig: %v", err)
	}
	got, _ := os.ReadFile(p)
	if string(got) != newRaw {
		t.Fatalf("config not replaced: %s", got)
	}
	bak, err := os.ReadFile(p + ".bak")
	if err != nil {
		t.Fatalf("backup missing: %v", err)
	}
	if string(bak) != original {
		t.Fatalf("backup wrong: %s", bak)
	}
}

func TestWriteConfigRejectsInvalidLeavingFileUntouched(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "agent.json")
	original := `{"storage":{"driver":"memory"}}`
	if err := os.WriteFile(p, []byte(original), 0o644); err != nil {
		t.Fatal(err)
	}
	a := NewApp(p)
	if err := a.writeConfig(`{"storage":"not-an-object"}`); err == nil {
		t.Fatal("invalid config accepted")
	}
	got, _ := os.ReadFile(p)
	if string(got) != original {
		t.Fatalf("live file changed on invalid save: %s", got)
	}
	if _, err := os.Stat(p + ".bak"); !os.IsNotExist(err) {
		t.Fatal("backup written for a rejected save")
	}
	entries, _ := os.ReadDir(dir)
	for _, e := range entries {
		if strings.HasPrefix(e.Name(), "agent.json.tmp-") {
			t.Fatalf("temp file left behind: %s", e.Name())
		}
	}
}
