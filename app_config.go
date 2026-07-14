package main

import (
	"context"
	"fmt"
	"os"
	"path/filepath"

	"github.com/stardust/legion-agent/serve"
)

// GetConfig returns the raw JSON bytes of the active config file as a string.
// The settings form renders this verbatim (not passed through config.Load), so
// "what you see is what's in the file" — no env overrides or defaults leak in.
// Called by React via the Wails bindings.
func (a *App) GetConfig() (string, error) {
	if a.cfgPath == "" {
		return "", fmt.Errorf("no config path resolved; cannot read config")
	}
	data, err := os.ReadFile(a.cfgPath)
	if err != nil {
		return "", fmt.Errorf("read config %q: %w", a.cfgPath, err)
	}
	return string(data), nil
}

// GetConfigPath returns the absolute path of the active config file so the UI
// can show which file it is editing. Called by React via the Wails bindings.
func (a *App) GetConfigPath() (string, error) {
	if a.cfgPath == "" {
		return "", fmt.Errorf("no config path resolved")
	}
	return a.cfgPath, nil
}

// writeConfig validates raw against the authoritative loader and, only if valid,
// atomically replaces the config file — backing the current one up to
// <file>.bak first. It performs no service restart, so it is safe to unit-test.
// Any failure before the rename leaves the live config file untouched.
func (a *App) writeConfig(raw string) error {
	if a.cfgPath == "" {
		return fmt.Errorf("no config path resolved; cannot save config")
	}
	dir := filepath.Dir(a.cfgPath)
	tmp, err := os.CreateTemp(dir, "agent.json.tmp-*")
	if err != nil {
		return fmt.Errorf("create temp config in %q: %w", dir, err)
	}
	tmpPath := tmp.Name()
	// Remove the temp file on any early return; a successful rename consumes it
	// first, making this a harmless no-op.
	defer os.Remove(tmpPath)

	if _, err := tmp.WriteString(raw); err != nil {
		tmp.Close()
		return fmt.Errorf("write temp config %q: %w", tmpPath, err)
	}
	if err := tmp.Close(); err != nil {
		return fmt.Errorf("close temp config %q: %w", tmpPath, err)
	}

	// Authoritative validation through the serve bridge (GUI cannot import
	// internal/config). Reject malformed/type-mismatched config before the live
	// file is touched.
	if err := serve.ValidateConfig(context.Background(), tmpPath); err != nil {
		return fmt.Errorf("validate new config: %w", err)
	}

	// Preserve the live file's permission bits for both the backup and the
	// replacement. agent.json holds secrets (api_key, admin_token), so the backup
	// must not be more permissive than the original, and the atomic replace must
	// not silently relax the live file's mode (os.CreateTemp defaults to 0600).
	info, err := os.Stat(a.cfgPath)
	if err != nil {
		return fmt.Errorf("stat current config %q: %w", a.cfgPath, err)
	}
	mode := info.Mode().Perm()

	// Back up the current file so a loadable-but-service-breaking config (e.g. an
	// unreachable storage path) can be restored by hand.
	current, err := os.ReadFile(a.cfgPath)
	if err != nil {
		return fmt.Errorf("read current config %q for backup: %w", a.cfgPath, err)
	}
	bakPath := a.cfgPath + ".bak"
	if err := os.WriteFile(bakPath, current, mode); err != nil {
		return fmt.Errorf("write config backup %q: %w", bakPath, err)
	}

	// Match the temp file's mode to the original so the atomic replace preserves
	// permissions rather than leaving the restrictive CreateTemp default.
	if err := os.Chmod(tmpPath, mode); err != nil {
		return fmt.Errorf("chmod temp config %q: %w", tmpPath, err)
	}

	if err := os.Rename(tmpPath, a.cfgPath); err != nil {
		return fmt.Errorf("replace config %q: %w", a.cfgPath, err)
	}
	return nil
}

// SaveConfig persists a new config and restarts the embedded service so the
// change takes effect without an app restart. On a restart failure the new file
// is already in place and the previous one is at <file>.bak; the error names the
// backup and a serve:error event is emitted so the badge explains the outage.
// Called by React via the Wails bindings from the settings modal.
func (a *App) SaveConfig(raw string) error {
	if err := a.writeConfig(raw); err != nil {
		return err
	}
	if err := a.serve.Restart(a.ctx, a.cfgPath); err != nil {
		a.serve.emit(a.ctx, "serve:error", map[string]any{"error": err.Error()})
		return fmt.Errorf("config saved but serve restart failed (backup at %q): %w", a.cfgPath+".bak", err)
	}
	return nil
}
