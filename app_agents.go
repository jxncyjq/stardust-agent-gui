package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/stardust/legion-agent/serve"
)

// GateableToolDTO is one tool the per-agent config UI can allow or disable.
type GateableToolDTO struct {
	Name        string `json:"name"`
	Description string `json:"description"`
}

// ListGateableTools returns every tool a per-agent config may disable, each with
// a one-line description, for the tool-authorization checklist. It reads the
// public serve seam (serve.GateableTools) because this module cannot import
// legionAgent's internal/toolauth directly. Meta-tools are excluded — they are
// always resident and cannot be disabled.
func (a *App) ListGateableTools() []GateableToolDTO {
	tools := serve.GateableTools()
	out := make([]GateableToolDTO, 0, len(tools))
	for _, t := range tools {
		out = append(out, GateableToolDTO{Name: t.Name, Description: t.Description})
	}
	return out
}

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

// ModelInfo is the active model an agent uses plus its context window, for the
// GUI's model badge.
type ModelInfo struct {
	Model         string `json:"model"`
	ContextLength int    `json:"context_length"`
	Profile       string `json:"profile"`
}

// mainConfigModelView / agentConfigProfileView are the minimal JSON subsets this
// binding reads. legionAgentGUI cannot import legionAgent/internal/config, so it
// parses the raw config JSON directly (same "read the file verbatim" approach as
// GetConfig).
type mainConfigModelView struct {
	Maas struct {
		DefaultProfile string `json:"default_profile"`
		Profiles       map[string]struct {
			Model         string `json:"model"`
			ContextLength int    `json:"context_length"`
		} `json:"profiles"`
	} `json:"maas"`
	Agents map[string]string `json:"agents"`
}

type agentConfigProfileView struct {
	MaasProfile string `json:"maas_profile"`
}

// GetAgentModelInfo resolves the model + context window agentName actually uses:
// the agent's maas_profile (empty, or agent not in the agents map → maas.default_profile)
// → maas.profiles[profile]. Returns an error (fail-loud) when the resolved
// profile is not in maas.profiles — a misconfiguration the UI must surface.
// Called by React via the Wails bindings.
func (a *App) GetAgentModelInfo(agentName string) (ModelInfo, error) {
	raw, err := a.GetConfig()
	if err != nil {
		return ModelInfo{}, err
	}
	var main mainConfigModelView
	if err := json.Unmarshal([]byte(raw), &main); err != nil {
		return ModelInfo{}, fmt.Errorf("parse main config for model info: %w", err)
	}

	profile := ""
	if rel, ok := main.Agents[agentName]; ok && strings.TrimSpace(rel) != "" {
		ac, err := a.GetAgentConfig(rel)
		if err != nil {
			return ModelInfo{}, err
		}
		if ac.Exists {
			var av agentConfigProfileView
			if err := json.Unmarshal([]byte(ac.Content), &av); err != nil {
				return ModelInfo{}, fmt.Errorf("parse agent config %q for model info: %w", rel, err)
			}
			profile = strings.TrimSpace(av.MaasProfile)
		}
	}
	if profile == "" {
		profile = strings.TrimSpace(main.Maas.DefaultProfile)
	}
	if profile == "" {
		return ModelInfo{}, fmt.Errorf("agent %q: no maas_profile and no maas.default_profile configured", agentName)
	}
	p, ok := main.Maas.Profiles[profile]
	if !ok {
		return ModelInfo{}, fmt.Errorf("agent %q resolved profile %q not found in maas.profiles", agentName, profile)
	}
	return ModelInfo{Model: p.Model, ContextLength: p.ContextLength, Profile: profile}, nil
}
