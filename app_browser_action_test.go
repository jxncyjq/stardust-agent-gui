package main

import (
	"encoding/json"
	"io"
	"net/http"
	"testing"
)

// TestBrowserTakeoverPostsThroughGo verifies the takeover toggle reaches the
// serve as a plain POST (no CORS preflight — the whole point of routing through
// Go) with the {"enabled":bool} body the backend expects.
func TestBrowserTakeoverPostsThroughGo(t *testing.T) {
	var gotMethod, gotPath string
	var gotBody map[string]any
	a := newFakeBackendApp(t, func(w http.ResponseWriter, r *http.Request) {
		gotMethod = r.Method
		gotPath = r.URL.Path
		raw, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(raw, &gotBody)
		w.WriteHeader(http.StatusOK)
	})

	if err := a.BrowserTakeover("sess-3", true); err != nil {
		t.Fatalf("BrowserTakeover: %v", err)
	}
	if gotMethod != http.MethodPost {
		t.Errorf("method = %q, want POST", gotMethod)
	}
	if gotPath != "/v1/browser/sessions/sess-3/takeover" {
		t.Errorf("path = %q", gotPath)
	}
	if gotBody["enabled"] != true {
		t.Errorf("body enabled = %v, want true", gotBody["enabled"])
	}
}

// TestBrowserInputForwardsEventsVerbatim verifies the input batch is embedded
// under "events" verbatim and posted through Go.
func TestBrowserInputForwardsEventsVerbatim(t *testing.T) {
	var gotPath string
	var gotBody map[string]any
	a := newFakeBackendApp(t, func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		raw, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(raw, &gotBody)
		w.WriteHeader(http.StatusOK)
	})

	events := `[{"type":"click","x":0.5,"y":0.5,"button":"left"}]`
	if err := a.BrowserInput("sess-3", events); err != nil {
		t.Fatalf("BrowserInput: %v", err)
	}
	if gotPath != "/v1/browser/sessions/sess-3/input" {
		t.Errorf("path = %q", gotPath)
	}
	evs, ok := gotBody["events"].([]any)
	if !ok || len(evs) != 1 {
		t.Fatalf("events = %v, want one-element array", gotBody["events"])
	}
	ev := evs[0].(map[string]any)
	if ev["type"] != "click" || ev["button"] != "left" {
		t.Errorf("event forwarded wrong: %v", ev)
	}
}

// TestBrowserActionsValidateInput guards the fail-loud argument checks.
func TestBrowserActionsValidateInput(t *testing.T) {
	a := NewApp("") // no backend: validation short-circuits before any HTTP call
	if err := a.BrowserTakeover("", true); err == nil {
		t.Error("BrowserTakeover(empty session) = nil, want error")
	}
	if err := a.BrowserInput("", "[]"); err == nil {
		t.Error("BrowserInput(empty session) = nil, want error")
	}
	if err := a.BrowserInput("sess-3", "{not json"); err == nil {
		t.Error("BrowserInput(bad JSON) = nil, want error")
	}
}

// TestBrowserActionsSurfaceNon2xx verifies a non-2xx serve response becomes an
// error the React handler can show, rather than a silently-swallowed failure.
func TestBrowserActionsSurfaceNon2xx(t *testing.T) {
	a := newFakeBackendApp(t, func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "session not under takeover", http.StatusConflict)
	})
	if err := a.BrowserTakeover("sess-3", false); err == nil {
		t.Error("BrowserTakeover on 409 = nil, want error")
	}
}
