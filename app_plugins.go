package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
)

// PluginDTO is one plugin deployment entry as the settings UI's plugin
// consent panel needs to see it, mirroring legionAgent's
// internal/server/plugins.go PluginView JSON shape field-for-field.
//
// Declared and Granted are kept as separate field groups (not merged), for
// the same reason the server keeps them separate: the consent checklist
// renders from what the plugin DECLARES it wants, and marks current state
// from what is already GRANTED — collapsing them would make "this plugin
// wants http" indistinguishable from "http is authorized".
//
// DeclaredUnresolved has no omitempty on purpose: it is meaningful both when
// false ("this plugin declares nothing") and when true ("the server could
// not determine what this plugin declares"), and those two states must not
// collapse into the same absent-field JSON.
//
// DeclaredError carries the reason when DeclaredUnresolved is true because
// the declaration failed to load (a corrupted plugin.wasm, a package
// directory removed from disk, …) — it is empty when DeclaredUnresolved is
// true for the other reason (an uncached remote package, an expected
// not-yet-fetched state, not a failure). Mirrors legionAgent's
// internal/server/plugins.go PluginView.DeclaredError field-for-field; see
// its doc comment for the full case breakdown.
type PluginDTO struct {
	Name                 string   `json:"name"`
	Version              string   `json:"version"`
	State                string   `json:"state"`
	Detail               string   `json:"detail,omitempty"`
	Tools                []string `json:"tools"`
	DeclaredCapabilities []string `json:"declared_capabilities"`
	DeclaredAllowedHosts []string `json:"declared_allowed_hosts"`
	DeclaredAllowedPaths []string `json:"declared_allowed_paths"`
	DeclaredUnresolved   bool     `json:"declared_unresolved"`
	DeclaredError        string   `json:"declared_error,omitempty"`
	GrantedCapabilities  []string `json:"granted_capabilities"`
	GrantedAllowedHosts  []string `json:"granted_allowed_hosts"`
	GrantedAllowedPaths  []string `json:"granted_allowed_paths"`
}

// ConsentResultDTO is the response body of GrantPlugin/DenyPlugin: the
// resulting PluginDTO plus whether the write to the deployment manifest has
// already taken effect.
//
// PendingConvergence has no omitempty, for the same reason as
// PluginDTO.DeclaredUnresolved: false ("already in effect") and true
// ("written to disk, not yet applied") are both meaningful and must both
// decode rather than one of them vanishing as an absent field. This layer
// must pass it through verbatim — never collapse it into a plain boolean
// success — because the settings UI has to tell "authorized and already in
// effect" apart from "authorized, awaiting convergence". See legionAgent's
// internal/server/plugins.go ConsentResult doc comment for the three states
// this field and View.State together distinguish.
type ConsentResultDTO struct {
	PluginDTO
	PendingConvergence bool   `json:"pending_convergence"`
	ConvergenceDetail  string `json:"convergence_detail,omitempty"`
}

// pluginsGet performs an authenticated GET against the embedded serve and
// returns the response body, failing loud on any non-2xx status. It reads
// a.BaseURL() and a.serve.Token() on every call (not captured once) for the
// same reason apiGet/browserPost do: ServeManager.Restart rebinds the
// embedded serve on a new port and mints a fresh bearer token, so a value
// captured earlier would silently 403 or dial a dead port after a restart.
func (a *App) pluginsGet(path string) ([]byte, error) {
	req, err := http.NewRequest(http.MethodGet, a.BaseURL()+path, nil)
	if err != nil {
		return nil, fmt.Errorf("build request for %s: %w", path, err)
	}
	if tok := a.serve.Token(); tok != "" {
		req.Header.Set("Authorization", "Bearer "+tok)
	}
	resp, err := a.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("get %s: %w", path, err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read response from %s: %w", path, err)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("get %s failed: status %d: %s", path, resp.StatusCode, strings.TrimSpace(string(body)))
	}
	return body, nil
}

// pluginsPost performs an authenticated POST against the embedded serve and
// returns the response body, failing loud on any non-2xx status. body is
// marshalled as the JSON request body when non-nil, or sent as an empty body
// when nil (the deny endpoint takes no body). Token/BaseURL are read per call
// for the same restart-safety reason as pluginsGet.
func (a *App) pluginsPost(path string, body any) ([]byte, error) {
	var reader io.Reader
	if body != nil {
		payload, err := json.Marshal(body)
		if err != nil {
			return nil, fmt.Errorf("marshal request for %s: %w", path, err)
		}
		reader = strings.NewReader(string(payload))
	}
	req, err := http.NewRequest(http.MethodPost, a.BaseURL()+path, reader)
	if err != nil {
		return nil, fmt.Errorf("build request for %s: %w", path, err)
	}
	req.Header.Set("Content-Type", "application/json")
	if tok := a.serve.Token(); tok != "" {
		req.Header.Set("Authorization", "Bearer "+tok)
	}
	resp, err := a.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("post %s: %w", path, err)
	}
	defer resp.Body.Close()
	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read response from %s: %w", path, err)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("post %s failed: status %d: %s", path, resp.StatusCode, strings.TrimSpace(string(respBody)))
	}
	return respBody, nil
}

// ListPlugins returns every plugin deployment entry via GET /v1/plugins, for
// the settings panel's plugin consent list. A non-2xx response — 404 when
// this deployment has no plugin loader assembled, 403 on RBAC denial, 500 on
// a manifest read failure — is returned as an error rather than an empty
// slice with a nil error: the caller could not otherwise tell "no plugins
// installed" from "the request failed". Called by React via the Wails
// bindings.
func (a *App) ListPlugins() ([]PluginDTO, error) {
	body, err := a.pluginsGet("/v1/plugins")
	if err != nil {
		return nil, fmt.Errorf("list plugins: %w", err)
	}
	var result struct {
		Plugins []PluginDTO `json:"plugins"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, fmt.Errorf("decode plugins list: %w", err)
	}
	return result.Plugins, nil
}

// GrantPlugin authorizes the named plugin to run with the given capabilities,
// allowed hosts and allowed paths, via POST /v1/plugins/{name}/grant. The
// returned ConsentResultDTO — including PendingConvergence — is decoded and
// returned verbatim; this binding performs no capability or allowlist
// judgement of its own and does not collapse the result into a plain
// success/failure boolean. A non-2xx status (404 unknown plugin, 409
// concurrent manifest edit, 500 disk failure, 403 RBAC denial, 400 malformed
// request) is returned as an error, never swallowed. Called by React via the
// Wails bindings.
func (a *App) GrantPlugin(name string, capabilities, allowedHosts, allowedPaths []string) (ConsentResultDTO, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return ConsentResultDTO{}, fmt.Errorf("plugin name is required")
	}
	reqBody := map[string]any{
		"capabilities":  capabilities,
		"allowed_hosts": allowedHosts,
		"allowed_paths": allowedPaths,
	}
	body, err := a.pluginsPost("/v1/plugins/"+name+"/grant", reqBody)
	if err != nil {
		return ConsentResultDTO{}, fmt.Errorf("grant plugin %q: %w", name, err)
	}
	var result ConsentResultDTO
	if err := json.Unmarshal(body, &result); err != nil {
		return ConsentResultDTO{}, fmt.Errorf("decode grant response for plugin %q: %w", name, err)
	}
	return result, nil
}

// DenyPlugin revokes the named plugin's authorization to run, via
// POST /v1/plugins/{name}/deny. Same verbatim pass-through (including
// PendingConvergence) and fail-loud status handling as GrantPlugin. Called
// by React via the Wails bindings.
func (a *App) DenyPlugin(name string) (ConsentResultDTO, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return ConsentResultDTO{}, fmt.Errorf("plugin name is required")
	}
	body, err := a.pluginsPost("/v1/plugins/"+name+"/deny", nil)
	if err != nil {
		return ConsentResultDTO{}, fmt.Errorf("deny plugin %q: %w", name, err)
	}
	var result ConsentResultDTO
	if err := json.Unmarshal(body, &result); err != nil {
		return ConsentResultDTO{}, fmt.Errorf("decode deny response for plugin %q: %w", name, err)
	}
	return result, nil
}
