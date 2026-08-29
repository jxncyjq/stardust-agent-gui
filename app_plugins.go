package main

import (
	"encoding/json"
	"errors"
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
//
// DeclaredUnresolvedReason says WHICH situation set DeclaredUnresolved, and
// the panel keys its 取回声明 (fetch) button on it rather than on the bare
// boolean: a remote package merely not cached yet IS fetchable, while a
// deployment with no plugins.cache configured, and a package that fails to
// load, are not — offering a fetch on those is a control that can never
// work. Mirrors legionAgent's internal/server/plugins.go
// PluginView.DeclaredUnresolvedReason field-for-field; the values it can
// take are that package's DeclaredUnresolved* constants.
type PluginDTO struct {
	Name                     string   `json:"name"`
	Version                  string   `json:"version"`
	State                    string   `json:"state"`
	Detail                   string   `json:"detail,omitempty"`
	Tools                    []string `json:"tools"`
	DeclaredCapabilities     []string `json:"declared_capabilities"`
	DeclaredAllowedHosts     []string `json:"declared_allowed_hosts"`
	DeclaredAllowedPaths     []string `json:"declared_allowed_paths"`
	DeclaredExtensions       []string `json:"declared_extensions"`
	DeclaredUnresolved       bool     `json:"declared_unresolved"`
	DeclaredUnresolvedReason string   `json:"declared_unresolved_reason,omitempty"`
	DeclaredError            string   `json:"declared_error,omitempty"`
	GrantedCapabilities      []string `json:"granted_capabilities"`
	GrantedAllowedHosts      []string `json:"granted_allowed_hosts"`
	GrantedAllowedPaths      []string `json:"granted_allowed_paths"`
	GrantedExtensions        []string `json:"granted_extensions"`
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

// errServeNotReady is what the plugin bindings report when the embedded serve
// has not bound a port yet. BaseURL() formats whatever Port() returns, so
// before the listener exists it yields "http://127.0.0.1:0" — a syntactically
// fine URL that can never connect. Dialling it surfaced
// "dial tcp 127.0.0.1:0: connectex: The requested address is not valid in its
// context" in the settings panel, which tells an operator nothing about what
// actually happened. Caught on a real machine by opening the plugin tab
// immediately after launch, before the serve had finished starting.
var errServeNotReady = errors.New("内嵌服务尚未就绪（端口未分配），请稍候重试")

// requireServePort fails loud when the embedded serve has no port yet, instead
// of letting a caller dial port 0 and report a transport error for what is
// really a not-started-yet condition.
func (a *App) requireServePort() error {
	if a.serve.Port() == 0 {
		return errServeNotReady
	}
	return nil
}

func (a *App) pluginsGet(path string) ([]byte, error) {
	if err := a.requireServePort(); err != nil {
		return nil, err
	}
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

// httpStatusError wraps a non-2xx response from pluginsPost with the numeric
// HTTP status, so a caller that must branch on one specific status (like
// ResolvePlugin distinguishing 422 from every other failure) can use
// errors.As instead of parsing the status back out of an error string.
type httpStatusError struct {
	status int
	err    error
}

func (e *httpStatusError) Error() string { return e.err.Error() }

func (e *httpStatusError) Unwrap() error { return e.err }

// pluginsPost performs an authenticated POST against the embedded serve and
// returns the response body, failing loud on any non-2xx status. body is
// marshalled as the JSON request body when non-nil, or sent as an empty body
// when nil (the deny endpoint takes no body). Token/BaseURL are read per call
// for the same restart-safety reason as pluginsGet.
func (a *App) pluginsPost(path string, body any) ([]byte, error) {
	if err := a.requireServePort(); err != nil {
		return nil, err
	}
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
		return nil, &httpStatusError{
			status: resp.StatusCode,
			err:    fmt.Errorf("post %s failed: status %d: %s", path, resp.StatusCode, strings.TrimSpace(string(respBody))),
		}
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
func (a *App) GrantPlugin(name string, capabilities, allowedHosts, allowedPaths, extensions []string) (ConsentResultDTO, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return ConsentResultDTO{}, fmt.Errorf("plugin name is required")
	}
	reqBody := map[string]any{
		"capabilities":  capabilities,
		"allowed_hosts": allowedHosts,
		"allowed_paths": allowedPaths,
		// extensions is a SUBSET grant, unlike capabilities: an empty list is
		// a complete answer (the plugin contributes its tools and is consulted
		// at no seam), which is why it is sent even when empty rather than
		// omitted.
		"extensions": extensions,
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

// errPluginUntrusted marks a 422 from the resolve endpoint: the package was
// obtained but is not trustworthy (unsigned, corruptly signed, or signed by
// an untrusted key). The settings panel must not offer a retry for it —
// retrying cannot make an untrusted package trusted, and a control that can
// never work is the class of lie this panel exists to avoid.
//
// ITS MESSAGE TEXT IS A CROSS-LANGUAGE CONTRACT. CHANGING THE STRING IS A
// BREAKING CHANGE. This repo configures no Wails ErrorFormatter, so a
// binding's error crosses to JS as nothing but this error chain's Error()
// string — no status code, no type, no structured payload survives. The
// panel therefore identifies the untrusted class by matching this exact
// text: see UNTRUSTED_MARKER in
// frontend/src/components/settings/PluginsPage.tsx, whose own comment
// explains why substring matching is the only mechanism available there.
// Rewording this message without editing UNTRUSTED_MARKER in the same commit
// silently turns the no-retry alert back into a retry button — a trust
// verdict presented as a transient failure — with no compile error on either
// side. TestErrPluginUntrustedMessageIsTheContractTheGUIMatches pins the
// literal so a rename fails loudly here instead.
var errPluginUntrusted = errors.New("插件包不被信任")

// ResolvePlugin fetches and verifies one plugin's package so the panel can
// show what it declares, without authorizing anything, via
// POST /v1/plugins/{name}/resolve. On success the response decodes into the
// same PluginDTO shape GET /v1/plugins returns per element, including
// DeclaredUnresolved and DeclaredError.
//
// A non-2xx status is always returned as an error, never a zero-value
// PluginDTO with a nil error. A 422 specifically means the package was
// obtained but could not be trusted (unsigned, corruptly signed, or signed
// by an untrusted key); that case is additionally wrapped with
// errPluginUntrusted so the caller can distinguish "will never succeed by
// retrying" from every other failure (404 unknown plugin or no plugin
// loader assembled, 409 concurrent manifest edit, 500 storage failure, 503
// unavailable, 403 RBAC denial) via errors.Is. Called by React via the
// Wails bindings.
func (a *App) ResolvePlugin(name string) (PluginDTO, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return PluginDTO{}, fmt.Errorf("plugin name is required")
	}
	body, err := a.pluginsPost("/v1/plugins/"+name+"/resolve", nil)
	if err != nil {
		var statusErr *httpStatusError
		if errors.As(err, &statusErr) && statusErr.status == http.StatusUnprocessableEntity {
			return PluginDTO{}, fmt.Errorf("resolve plugin %q: %w: %w", name, errPluginUntrusted, err)
		}
		return PluginDTO{}, fmt.Errorf("resolve plugin %q: %w", name, err)
	}
	var result PluginDTO
	if err := json.Unmarshal(body, &result); err != nil {
		return PluginDTO{}, fmt.Errorf("decode resolve response for plugin %q: %w", name, err)
	}
	return result, nil
}
