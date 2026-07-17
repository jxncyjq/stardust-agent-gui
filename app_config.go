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

// stagedFile is a validated candidate file waiting to replace a live one. The
// temp file always sits in the target's own directory so the final rename is an
// atomic same-volume operation.
type stagedFile struct {
	target string
	tmp    string
}

// stageFile writes raw to a temp file next to target and validates it with the
// authoritative loader. It never touches the live file: a failure here leaves
// the target untouched and removes the temp. The returned stagedFile must be
// passed to commitStaged (to install it) or discardStaged (to drop it).
func stageFile(target string, raw string, validate func(path string) error) (stagedFile, error) {
	dir := filepath.Dir(target)
	// A brand-new sub-agent config may live in a directory that does not exist
	// yet; create it here so the temp file (and the later rename) have a home.
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return stagedFile{}, fmt.Errorf("create directory %q: %w", dir, err)
	}
	tmp, err := os.CreateTemp(dir, filepath.Base(target)+".tmp-*")
	if err != nil {
		return stagedFile{}, fmt.Errorf("create temp file in %q: %w", dir, err)
	}
	tmpPath := tmp.Name()
	if _, err := tmp.WriteString(raw); err != nil {
		tmp.Close()
		os.Remove(tmpPath)
		return stagedFile{}, fmt.Errorf("write temp file %q: %w", tmpPath, err)
	}
	if err := tmp.Close(); err != nil {
		os.Remove(tmpPath)
		return stagedFile{}, fmt.Errorf("close temp file %q: %w", tmpPath, err)
	}
	if err := validate(tmpPath); err != nil {
		os.Remove(tmpPath)
		return stagedFile{}, fmt.Errorf("validate new content for %q: %w", target, err)
	}
	return stagedFile{target: target, tmp: tmpPath}, nil
}

// discardStaged removes the temp files of staged candidates that will not be
// installed, so a rejected save leaves no litter behind.
func discardStaged(staged []stagedFile) {
	for _, f := range staged {
		os.Remove(f.tmp)
	}
}

// commitStaged installs every staged file: the current file (when there is one)
// is copied to <file>.bak first and its permission bits are carried over to the
// replacement, so a secret-bearing config is never made more permissive and the
// atomic replace does not silently relax its mode. A brand-new file (a
// just-added sub-agent) has nothing to back up and keeps the restrictive
// temp-file mode.
func commitStaged(staged []stagedFile) error {
	for _, f := range staged {
		info, err := os.Stat(f.target)
		switch {
		case err == nil:
			mode := info.Mode().Perm()
			current, readErr := os.ReadFile(f.target)
			if readErr != nil {
				return fmt.Errorf("read current file %q for backup: %w", f.target, readErr)
			}
			bakPath := f.target + ".bak"
			if err := os.WriteFile(bakPath, current, mode); err != nil {
				return fmt.Errorf("write backup %q: %w", bakPath, err)
			}
			if err := os.Chmod(f.tmp, mode); err != nil {
				return fmt.Errorf("chmod temp file %q: %w", f.tmp, err)
			}
		case os.IsNotExist(err):
			// New file (e.g. a sub-agent config created from the template):
			// nothing to back up, keep the temp file's restrictive mode. Its
			// directory was created during staging.
		default:
			return fmt.Errorf("stat target %q: %w", f.target, err)
		}
		if err := os.Rename(f.tmp, f.target); err != nil {
			return fmt.Errorf("replace %q: %w", f.target, err)
		}
	}
	return nil
}

// writeAll validates and installs the main config together with every changed
// sub-agent config file as one unit: each candidate is staged and validated
// first, and only when they ALL pass is anything written. A single invalid file
// therefore leaves the whole configuration untouched. agentFiles maps a
// sub-agent config path (as written in agent.json) to its new JSON contents.
// It performs no service restart, so it is safe to unit-test.
func (a *App) writeAll(mainRaw string, agentFiles map[string]string) error {
	if a.cfgPath == "" {
		return fmt.Errorf("no config path resolved; cannot save config")
	}

	var staged []stagedFile

	mainStaged, err := stageFile(a.cfgPath, mainRaw, func(path string) error {
		return serve.ValidateConfig(context.Background(), path)
	})
	if err != nil {
		return err
	}
	staged = append(staged, mainStaged)

	for rel, raw := range agentFiles {
		target, err := a.resolveAgentPath(rel)
		if err != nil {
			discardStaged(staged)
			return err
		}
		agentStaged, err := stageFile(target, raw, func(path string) error {
			return serve.ValidateAgentConfig(context.Background(), path)
		})
		if err != nil {
			discardStaged(staged)
			return err
		}
		staged = append(staged, agentStaged)
	}

	if err := commitStaged(staged); err != nil {
		// A failure part-way through leaves earlier files replaced and their
		// .bak alongside; report loudly rather than pretending the save worked.
		discardStaged(staged)
		return err
	}
	return nil
}

// SaveAll persists the main config plus every changed sub-agent config file and
// restarts the embedded service once so all of it takes effect without an app
// restart. Nothing is written unless every file validates. On a restart failure
// the new files are already in place and the previous ones are at <file>.bak;
// the error says so and a serve:error event is emitted so the badge explains the
// outage. Called by React via the Wails bindings from the settings modal.
func (a *App) SaveAll(mainRaw string, agentFiles map[string]string) error {
	if err := a.writeAll(mainRaw, agentFiles); err != nil {
		return err
	}
	if err := a.serve.Restart(a.ctx, a.cfgPath); err != nil {
		a.serve.emit(a.ctx, "serve:error", map[string]any{"error": err.Error()})
		return fmt.Errorf("config saved but serve restart failed (backup at %q): %w", a.cfgPath+".bak", err)
	}
	return nil
}
