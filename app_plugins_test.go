package main

import (
	"errors"
	"io"
	"net/http"
	"testing"
)

// TestListPluginsDecodesResponse verifies a normal 200 response is decoded
// into PluginDTO with DeclaredUnresolved (which has no omitempty) surviving
// as an explicit false.
func TestListPluginsDecodesResponse(t *testing.T) {
	a := newFakeBackendApp(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Path != "/v1/plugins" {
			t.Errorf("unexpected request: %s %s", r.Method, r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"plugins":[{"name":"weather","version":"1.0.0","state":"running","tools":["get_weather"],"declared_capabilities":["http"],"declared_allowed_hosts":["api.weather.example"],"declared_allowed_paths":[],"declared_unresolved":false,"granted_capabilities":["http"],"granted_allowed_hosts":["api.weather.example"],"granted_allowed_paths":[]}]}`))
	})

	plugins, err := a.ListPlugins()
	if err != nil {
		t.Fatalf("ListPlugins: %v", err)
	}
	if len(plugins) != 1 {
		t.Fatalf("want 1 plugin, got %d", len(plugins))
	}
	p := plugins[0]
	if p.Name != "weather" || p.Version != "1.0.0" || p.State != "running" {
		t.Errorf("plugin fields wrong: %+v", p)
	}
	if len(p.Tools) != 1 || p.Tools[0] != "get_weather" {
		t.Errorf("tools = %v", p.Tools)
	}
	if p.DeclaredUnresolved != false {
		t.Errorf("DeclaredUnresolved = %v, want explicit false", p.DeclaredUnresolved)
	}
	if len(p.GrantedCapabilities) != 1 || p.GrantedCapabilities[0] != "http" {
		t.Errorf("GrantedCapabilities = %v", p.GrantedCapabilities)
	}
}

// TestListPluginsPreservesDeclaredUnresolvedTrue verifies the "server could
// not determine what this plugin declares" state (as opposed to "declares
// nothing") survives decoding.
func TestListPluginsPreservesDeclaredUnresolvedTrue(t *testing.T) {
	a := newFakeBackendApp(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"plugins":[{"name":"remote-thing","version":"0.0.0","state":"pending","tools":[],"declared_capabilities":[],"declared_allowed_hosts":[],"declared_allowed_paths":[],"declared_unresolved":true,"granted_capabilities":[],"granted_allowed_hosts":[],"granted_allowed_paths":[]}]}`))
	})

	plugins, err := a.ListPlugins()
	if err != nil {
		t.Fatalf("ListPlugins: %v", err)
	}
	if len(plugins) != 1 || plugins[0].DeclaredUnresolved != true {
		t.Fatalf("DeclaredUnresolved not preserved: %+v", plugins)
	}
}

// TestListPluginsFailsLoudOnNon2xx is the fail-loud regression: a 404
// response (this deployment assembled no plugin loader) must surface as an
// error, never as an empty slice with a nil error.
func TestListPluginsFailsLoudOnNon2xx(t *testing.T) {
	// The body is valid JSON shaped like the real server's writeError output
	// ({"error": "..."}), not plain text: an unmarshal failure alone would
	// mask whether the status-code check is actually doing its job, since
	// this body does not carry a "plugins" key either way.
	a := newFakeBackendApp(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNotFound)
		w.Write([]byte(`{"error":"this process assembled no plugin loader; plugins are not enabled"}`))
	})

	plugins, err := a.ListPlugins()
	if err == nil {
		t.Fatalf("ListPlugins on 404 = (%v, nil), want error", plugins)
	}
	if plugins != nil {
		t.Errorf("ListPlugins on 404 returned non-nil slice %v alongside an error", plugins)
	}
}

// TestListPluginsFailsLoudOnRBACDenial covers the 403 status distinctly from
// 404, since callers may want to tell the two apart.
func TestListPluginsFailsLoudOnRBACDenial(t *testing.T) {
	a := newFakeBackendApp(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusForbidden)
		w.Write([]byte(`{"error":"plugin access denied"}`))
	})
	if _, err := a.ListPlugins(); err == nil {
		t.Fatal("ListPlugins on 403 = nil error, want error")
	}
}

// TestGrantPluginPostsBodyAndPreservesPendingConvergence verifies GrantPlugin
// posts the expected JSON body to the expected path, and that
// pending_convergence=true is not collapsed into a plain success — the exact
// defect this endpoint exists to prevent from reaching the UI.
func TestGrantPluginPostsBodyAndPreservesPendingConvergence(t *testing.T) {
	var gotPath, gotMethod, gotBody string
	a := newFakeBackendApp(t, func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotMethod = r.Method
		raw, _ := io.ReadAll(r.Body)
		gotBody = string(raw)
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"name":"weather","version":"1.0.0","state":"running","tools":["get_weather"],"declared_capabilities":["http"],"declared_allowed_hosts":["api.weather.example"],"declared_allowed_paths":[],"declared_unresolved":false,"granted_capabilities":["http"],"granted_allowed_hosts":["api.weather.example"],"granted_allowed_paths":[],"pending_convergence":true,"convergence_detail":"a concurrent apply is already running"}`))
	})

	result, err := a.GrantPlugin("weather", []string{"http"}, []string{"api.weather.example"}, nil)
	if err != nil {
		t.Fatalf("GrantPlugin: %v", err)
	}
	if gotMethod != http.MethodPost || gotPath != "/v1/plugins/weather/grant" {
		t.Errorf("request = %s %s, want POST /v1/plugins/weather/grant", gotMethod, gotPath)
	}
	if gotBody == "" {
		t.Error("grant request body was empty")
	}
	if result.PendingConvergence != true {
		t.Errorf("PendingConvergence = %v, want true (must not be collapsed into plain success)", result.PendingConvergence)
	}
	if result.ConvergenceDetail != "a concurrent apply is already running" {
		t.Errorf("ConvergenceDetail = %q", result.ConvergenceDetail)
	}
	if result.Name != "weather" {
		t.Errorf("Name = %q, want the row-matching name even while pending", result.Name)
	}
}

// TestGrantPluginPendingConvergenceFalse verifies the "already in effect"
// state (PendingConvergence=false) also survives decoding as an explicit
// value, not merely as a Go zero-value coincidence.
func TestGrantPluginPendingConvergenceFalse(t *testing.T) {
	a := newFakeBackendApp(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"name":"weather","version":"1.0.0","state":"running","tools":[],"declared_capabilities":[],"declared_allowed_hosts":[],"declared_allowed_paths":[],"declared_unresolved":false,"granted_capabilities":[],"granted_allowed_hosts":[],"granted_allowed_paths":[],"pending_convergence":false}`))
	})
	result, err := a.GrantPlugin("weather", nil, nil, nil)
	if err != nil {
		t.Fatalf("GrantPlugin: %v", err)
	}
	if result.PendingConvergence != false {
		t.Errorf("PendingConvergence = %v, want false", result.PendingConvergence)
	}
	if result.State != "running" {
		t.Errorf("State = %q, want running", result.State)
	}
}

// TestGrantPluginFailsLoudOnConflict verifies a 409 (concurrent deployment
// manifest edit) is returned as an error rather than a zero-value result with
// a nil error.
func TestGrantPluginFailsLoudOnConflict(t *testing.T) {
	a := newFakeBackendApp(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusConflict)
		w.Write([]byte(`{"error":"the plugin deployment manifest changed while this request was running"}`))
	})
	result, err := a.GrantPlugin("weather", []string{"http"}, nil, nil)
	if err == nil {
		t.Fatalf("GrantPlugin on 409 = (%+v, nil), want error", result)
	}
}

// TestGrantPluginFailsLoudOnNotFound verifies a 404 (unknown plugin name) is
// returned as an error.
func TestGrantPluginFailsLoudOnNotFound(t *testing.T) {
	a := newFakeBackendApp(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNotFound)
		w.Write([]byte(`{"error":"no such plugin in the deployment manifest"}`))
	})
	if _, err := a.GrantPlugin("ghost", nil, nil, nil); err == nil {
		t.Fatal("GrantPlugin on 404 = nil error, want error")
	}
}

// TestGrantPluginValidatesName guards the fail-loud argument check: an empty
// plugin name must error before any HTTP call is attempted.
func TestGrantPluginValidatesName(t *testing.T) {
	a := NewApp("") // no backend: validation must short-circuit before any HTTP call
	if _, err := a.GrantPlugin("", nil, nil, nil); err == nil {
		t.Error("GrantPlugin(empty name) = nil, want error")
	}
}

// TestDenyPluginPostsNoBodyAndPreservesPendingConvergence verifies DenyPlugin
// hits the deny path with no request body, and that pending_convergence is
// preserved the same way GrantPlugin's is.
func TestDenyPluginPostsNoBodyAndPreservesPendingConvergence(t *testing.T) {
	var gotPath, gotMethod string
	var gotContentLength int64
	a := newFakeBackendApp(t, func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotMethod = r.Method
		gotContentLength = r.ContentLength
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"name":"weather","version":"1.0.0","state":"stopped","tools":[],"declared_capabilities":[],"declared_allowed_hosts":[],"declared_allowed_paths":[],"declared_unresolved":false,"granted_capabilities":[],"granted_allowed_hosts":[],"granted_allowed_paths":[],"pending_convergence":true,"convergence_detail":"waiting for the current task to finish"}`))
	})

	result, err := a.DenyPlugin("weather")
	if err != nil {
		t.Fatalf("DenyPlugin: %v", err)
	}
	if gotMethod != http.MethodPost || gotPath != "/v1/plugins/weather/deny" {
		t.Errorf("request = %s %s, want POST /v1/plugins/weather/deny", gotMethod, gotPath)
	}
	if gotContentLength > 0 {
		t.Errorf("deny request sent a body of length %d, want none", gotContentLength)
	}
	if result.PendingConvergence != true {
		t.Errorf("PendingConvergence = %v, want true", result.PendingConvergence)
	}
}

// TestDenyPluginFailsLoudOnServerError verifies a 500 (manifest could not be
// written) is returned as an error, never an empty ConsentResultDTO with a
// nil error.
func TestDenyPluginFailsLoudOnServerError(t *testing.T) {
	a := newFakeBackendApp(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte(`{"error":"the plugin deployment manifest could not be read or written"}`))
	})
	result, err := a.DenyPlugin("weather")
	if err == nil {
		t.Fatalf("DenyPlugin on 500 = (%+v, nil), want error", result)
	}
}

// TestDenyPluginValidatesName guards the fail-loud argument check.
func TestDenyPluginValidatesName(t *testing.T) {
	a := NewApp("")
	if _, err := a.DenyPlugin(""); err == nil {
		t.Error("DenyPlugin(empty name) = nil, want error")
	}
}

// TestResolvePluginDecodesTheView verifies a normal 200 from the resolve
// endpoint decodes into the same PluginDTO shape GET /v1/plugins uses.
func TestResolvePluginDecodesTheView(t *testing.T) {
	a := newFakeBackendApp(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/v1/plugins/weather/resolve" {
			t.Errorf("unexpected request: %s %s", r.Method, r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"name":"weather","version":"1.0.0","state":"unauthorized","tools":[],"declared_capabilities":["http"],"declared_allowed_hosts":[],"declared_allowed_paths":[],"declared_unresolved":false,"granted_capabilities":[],"granted_allowed_hosts":[],"granted_allowed_paths":[]}`))
	})

	view, err := a.ResolvePlugin("weather")
	if err != nil {
		t.Fatalf("ResolvePlugin: %v", err)
	}
	if view.DeclaredUnresolved {
		t.Error("DeclaredUnresolved = true after a successful resolve, want false")
	}
	if len(view.DeclaredCapabilities) != 1 || view.DeclaredCapabilities[0] != "http" {
		t.Errorf("DeclaredCapabilities = %v, want [http]", view.DeclaredCapabilities)
	}
}

// TestResolvePluginMarksA422AsUntrusted verifies a 422 (package obtained but
// not trustworthy) is classified via errPluginUntrusted, so the panel can
// tell "not trustworthy" apart from every other failure and offer no retry.
func TestResolvePluginMarksA422AsUntrusted(t *testing.T) {
	a := newFakeBackendApp(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnprocessableEntity)
		w.Write([]byte(`{"error":"resolve plugin \"weather\": plugin package is not trusted"}`))
	})

	_, err := a.ResolvePlugin("weather")
	if err == nil {
		t.Fatal("ResolvePlugin on a 422 = nil error, want an untrusted-package error")
	}
	if !errors.Is(err, errPluginUntrusted) {
		t.Errorf("ResolvePlugin error = %v, want it to wrap errPluginUntrusted", err)
	}
}

// TestResolvePluginFailsLoudOnOtherNon2xx verifies a 500 is NOT classified as
// untrusted: only 422 means "cannot be trusted", every other failure is an
// ordinary transient/operational error.
func TestResolvePluginFailsLoudOnOtherNon2xx(t *testing.T) {
	a := newFakeBackendApp(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte(`{"error":"resolve plugin \"weather\": disk on fire"}`))
	})

	_, err := a.ResolvePlugin("weather")
	if err == nil {
		t.Fatal("ResolvePlugin on a 500 = nil error, want an error")
	}
	if errors.Is(err, errPluginUntrusted) {
		t.Errorf("ResolvePlugin error = %v, want a 500 NOT classified as untrusted", err)
	}
}

// TestPluginBindingsFailLoudBeforeServeHasAPort pins the not-ready guard.
//
// Caught on a real machine: opening the plugin tab immediately after launch,
// before the embedded serve had bound its listener, made BaseURL() format
// "http://127.0.0.1:0" — a syntactically valid URL that can never connect —
// and the panel showed the operator
// "dial tcp 127.0.0.1:0: connectex: The requested address is not valid in its
// context". That is a transport error standing in for a not-started-yet
// condition, and it tells the reader nothing about what to do. Formatting a
// port the serve does not have is the "凑个值接着跑" CLAUDE.md section 0
// forbids, so both helpers refuse before dialling.
func TestPluginBindingsFailLoudBeforeServeHasAPort(t *testing.T) {
	a := NewApp("") // no serve started: a.serve.port is still 0

	if _, err := a.ListPlugins(); err == nil {
		t.Fatal("ListPlugins with no serve port = nil error, want a not-ready error")
	} else if !errors.Is(err, errServeNotReady) {
		t.Errorf("ListPlugins error = %v, want it to wrap errServeNotReady", err)
	}

	if _, err := a.GrantPlugin("any", []string{"log"}, nil, nil); err == nil {
		t.Fatal("GrantPlugin with no serve port = nil error, want a not-ready error")
	} else if !errors.Is(err, errServeNotReady) {
		t.Errorf("GrantPlugin error = %v, want it to wrap errServeNotReady", err)
	}

	if _, err := a.DenyPlugin("any"); err == nil {
		t.Fatal("DenyPlugin with no serve port = nil error, want a not-ready error")
	} else if !errors.Is(err, errServeNotReady) {
		t.Errorf("DenyPlugin error = %v, want it to wrap errServeNotReady", err)
	}

	if _, err := a.ResolvePlugin("any"); err == nil {
		t.Fatal("ResolvePlugin with no serve port = nil error, want a not-ready error")
	} else if !errors.Is(err, errServeNotReady) {
		t.Errorf("ResolvePlugin error = %v, want it to wrap errServeNotReady", err)
	}
}
