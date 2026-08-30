package main

import (
	"encoding/json"
	"github.com/stardust/legion-agent/serve"
	"net/http"
	"sync"
	"testing"
)

// Every request this app makes to its own serve must carry the loopback bearer
// token, because the serve the GUI starts mints one and refuses what does not
// have it. Reads did; WRITES DID NOT — a real-machine walkthrough found that
// creating a session (the first thing sending a message does) came back 401,
// which means the GUI could not send a single message in its own default
// configuration.
//
// The regression this file prevents is not "one call forgot": it is that each
// new call site had to remember, and six of them did not.

// recordingBackend captures the Authorization header of every request.
type recordingBackend struct {
	mu      sync.Mutex
	seen    map[string]string // "METHOD /path" -> Authorization
	respond func(w http.ResponseWriter, r *http.Request)
}

func newRecordingBackend(respond func(w http.ResponseWriter, r *http.Request)) *recordingBackend {
	return &recordingBackend{seen: map[string]string{}, respond: respond}
}

func (b *recordingBackend) handler(w http.ResponseWriter, r *http.Request) {
	b.mu.Lock()
	b.seen[r.Method+" "+r.URL.Path] = r.Header.Get("Authorization")
	b.mu.Unlock()
	if b.respond != nil {
		b.respond(w, r)
		return
	}
	if r.Method == http.MethodPost && r.URL.Path == "/v1/sessions" {
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte(`{"id":"s1"}`))
		return
	}
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(`{}`))
}

func (b *recordingBackend) authOf(t *testing.T, key string) string {
	t.Helper()

	b.mu.Lock()
	defer b.mu.Unlock()
	auth, ok := b.seen[key]
	if !ok {
		t.Fatalf("no request recorded for %q; recorded: %v", key, b.seen)
	}
	return auth
}

// TestEveryWritePathCarriesTheLoopbackToken drives the write calls a user
// reaches through the UI and asserts each one authenticated. A table, because
// the defect was six call sites each doing their own thing.
func TestEveryWritePathCarriesTheLoopbackToken(t *testing.T) {
	backend := newRecordingBackend(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/v1/sessions" && r.Method == http.MethodPost:
			w.WriteHeader(http.StatusCreated)
			_, _ = w.Write([]byte(`{"id":"s1"}`))
		case r.URL.Path == "/v1/tasks" && r.Method == http.MethodPost:
			w.WriteHeader(http.StatusCreated)
			_, _ = w.Write([]byte(`{"id":"t1"}`))
		default:
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{}`))
		}
	})
	a := newFakeBackendApp(t, backend.handler)
	a.serve.tokens = serve.NewTokens("test-token")

	if _, err := a.NewSession("proj", "hello"); err != nil {
		t.Fatalf("NewSession: %v", err)
	}
	if _, err := a.SubmitTask("hello", "s1", nil, "default-agent"); err != nil {
		t.Fatalf("SubmitTask: %v", err)
	}
	if err := a.InterruptTask("t1"); err != nil {
		t.Fatalf("InterruptTask: %v", err)
	}
	if err := a.SetSessionMode("s1", "manual"); err != nil {
		t.Fatalf("SetSessionMode: %v", err)
	}
	if err := a.DeleteSession("s1"); err != nil {
		t.Fatalf("DeleteSession: %v", err)
	}

	for _, key := range []string{
		"POST /v1/sessions",
		"POST /v1/tasks",
		"POST /v1/tasks/t1/interrupt",
		"PATCH /v1/sessions/s1",
		"DELETE /v1/sessions/s1",
	} {
		if got := backend.authOf(t, key); got != "Bearer test-token" {
			t.Errorf("%s sent Authorization %q, want the loopback token", key, got)
		}
	}
}

// TestPluginConsentWritesCarryTheLoopbackToken: the plugin grant/deny path
// goes through postJSON, whose doc comment claimed it mirrored apiGet's auth
// while it in fact sent none.
func TestPluginConsentWritesCarryTheLoopbackToken(t *testing.T) {
	backend := newRecordingBackend(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"view":{"name":"p"},"pending_convergence":false}`))
	})
	a := newFakeBackendApp(t, backend.handler)
	a.serve.tokens = serve.NewTokens("test-token")

	if _, err := a.GrantPlugin("p", []string{"log"}, nil, nil, nil); err != nil {
		t.Fatalf("GrantPlugin: %v", err)
	}
	if got := backend.authOf(t, "POST /v1/plugins/p/grant"); got != "Bearer test-token" {
		t.Errorf("grant sent Authorization %q, want the loopback token", got)
	}
}

// TestNoTokenMeansNoHeader keeps the non-hardened path unchanged: a serve that
// minted no token gets requests with no Authorization at all, not an empty
// bearer.
func TestNoTokenMeansNoHeader(t *testing.T) {
	backend := newRecordingBackend(nil)
	a := newFakeBackendApp(t, backend.handler)

	if _, err := a.NewSession("proj", "hello"); err != nil {
		t.Fatalf("NewSession: %v", err)
	}
	if got := backend.authOf(t, "POST /v1/sessions"); got != "" {
		t.Errorf("Authorization = %q with no token minted, want none", got)
	}
}

var _ = json.Marshal
