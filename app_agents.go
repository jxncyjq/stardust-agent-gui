package main

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// AgentConfigResult carries a sub-agent config file's contents to the frontend.
// Exists distinguishes a file that is simply not there yet — the legitimate
// state of a just-added agent, whose file the settings form seeds from a
// template and creates on save — from a real read failure, which is reported as
// an error instead.
type AgentConfigResult struct {
	Exists  bool   `json:"exists"`
	Content string `json:"content"`
}

// resolveAgentPath turns a sub-agent config path taken from agent.json into an
// absolute path, resolving relative paths against the main config's directory
// exactly as the agent registry does at startup.
//
// The path comes from user-editable config, so it is confined to the config
// directory subtree: a path that escapes it (via .. or an absolute path
// elsewhere) is refused rather than letting the settings UI read or overwrite
// arbitrary files on disk.
func (a *App) resolveAgentPath(rel string) (string, error) {
	rel = strings.TrimSpace(rel)
	if rel == "" {
		return "", fmt.Errorf("agent config path is required")
	}
	if a.cfgPath == "" {
		return "", fmt.Errorf("no config path resolved; cannot resolve agent config %q", rel)
	}
	dir, err := filepath.Abs(filepath.Dir(a.cfgPath))
	if err != nil {
		return "", fmt.Errorf("resolve config dir for agent config %q: %w", rel, err)
	}
	path := rel
	if !filepath.IsAbs(path) {
		path = filepath.Join(dir, path)
	}
	path, err = filepath.Abs(path)
	if err != nil {
		return "", fmt.Errorf("resolve agent config path %q: %w", rel, err)
	}
	inside, err := filepath.Rel(dir, path)
	if err != nil {
		return "", fmt.Errorf("compare agent config path %q against config dir %q: %w", rel, dir, err)
	}
	if inside == ".." || strings.HasPrefix(inside, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("agent config path %q escapes the config directory %q", rel, dir)
	}
	return path, nil
}

// GetAgentConfig returns the raw JSON of one sub-agent config file, resolved
// relative to the main config's directory. A file that does not exist yet is
// reported via Exists=false (the form then starts from a template); any other
// read failure is an error. Called by React via the Wails bindings.
func (a *App) GetAgentConfig(rel string) (AgentConfigResult, error) {
	path, err := a.resolveAgentPath(rel)
	if err != nil {
		return AgentConfigResult{}, err
	}
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return AgentConfigResult{Exists: false}, nil
	}
	if err != nil {
		return AgentConfigResult{}, fmt.Errorf("read agent config %q: %w", path, err)
	}
	return AgentConfigResult{Exists: true, Content: string(data)}, nil
}
