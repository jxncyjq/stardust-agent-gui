package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestGetAgentModelInfo(t *testing.T) {
	dir := t.TempDir()
	main := `{"maas":{"default_profile":"dev","profiles":{"dev":{"model":"deepseek-v4-flash","context_length":128000},"fast":{"model":"deepseek-v4-pro","context_length":64000}}},"agents":{"researcher":"researcher.json"}}`
	if err := os.WriteFile(filepath.Join(dir, "agent.json"), []byte(main), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "researcher.json"), []byte(`{"id":"researcher","maas_profile":"fast"}`), 0o644); err != nil {
		t.Fatal(err)
	}
	a := NewApp(filepath.Join(dir, "agent.json"))

	info, err := a.GetAgentModelInfo("researcher")
	if err != nil {
		t.Fatalf("researcher: %v", err)
	}
	if info.Model != "deepseek-v4-pro" || info.ContextLength != 64000 || info.Profile != "fast" {
		t.Fatalf("researcher info = %+v", info)
	}

	info, err = a.GetAgentModelInfo("默认")
	if err != nil {
		t.Fatalf("default agent: %v", err)
	}
	if info.Model != "deepseek-v4-flash" || info.ContextLength != 128000 || info.Profile != "dev" {
		t.Fatalf("default info = %+v", info)
	}
}

func TestGetAgentModelInfoProfileMissingFailsLoud(t *testing.T) {
	dir := t.TempDir()
	main := `{"maas":{"default_profile":"dev","profiles":{"dev":{"model":"m","context_length":1000}}},"agents":{"x":"x.json"}}`
	if err := os.WriteFile(filepath.Join(dir, "agent.json"), []byte(main), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "x.json"), []byte(`{"id":"x","maas_profile":"nonexistent"}`), 0o644); err != nil {
		t.Fatal(err)
	}
	a := NewApp(filepath.Join(dir, "agent.json"))
	if _, err := a.GetAgentModelInfo("x"); err == nil {
		t.Fatal("expected error when resolved profile not in maas.profiles")
	}
}
