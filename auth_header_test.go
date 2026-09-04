package main

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"testing"

	"github.com/stardust/legion-agent/serve"
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

// --- token scope -------------------------------------------------------------
//
// The token the embedded serve mints drives the user's agent: it lists
// sessions, reads the workspace through /v1/files and runs tasks. The transport
// used to attach it to EVERY request without looking at where the request was
// going, and this client is shared with chromium.Install, which fetches its
// install script from raw.githubusercontent.com — so the credential was being
// handed to a third-party public host. (GitHub answers a request carrying a
// credential it cannot validate with 404, not 401, which is why the symptom
// looked like "the script does not exist" and the built-in browser's install
// never once worked.)
//
// These four tests pin the scope: the header goes to the serve this app
// started, and nowhere else.

// stubRoundTripper records the request it was handed and answers it without
// touching the network, so a request to an arbitrary host can be observed.
type stubRoundTripper struct {
	got *http.Request
}

func (s *stubRoundTripper) RoundTrip(req *http.Request) (*http.Response, error) {
	s.got = req
	return &http.Response{
		StatusCode: http.StatusOK,
		Header:     make(http.Header),
		Body:       io.NopCloser(strings.NewReader("{}")),
		Request:    req,
	}, nil
}

// TestTokenGoesToTheEmbeddedServe: the existing behaviour, stated directly on
// the transport rather than through a call site.
func TestTokenGoesToTheEmbeddedServe(t *testing.T) {
	backend := newRecordingBackend(nil)
	a := newFakeBackendApp(t, backend.handler)
	a.serve.tokens = serve.NewTokens("test-token")

	resp, err := a.client.Get(a.BaseURL() + "/v1/sessions")
	if err != nil {
		t.Fatalf("GET own serve: %v", err)
	}
	_ = resp.Body.Close()

	if got := backend.authOf(t, "GET /v1/sessions"); got != "Bearer test-token" {
		t.Errorf("Authorization to own serve = %q, want %q", got, "Bearer test-token")
	}
}

// TestTokenIsNotSentToOtherHosts is the core evidence for this fix: a request
// that is not addressed to the embedded serve carries no credential. The
// external server is on loopback too, one port over — a "starts with 127."
// check would still leak the token to it, and to every other local service.
func TestTokenIsNotSentToOtherHosts(t *testing.T) {
	external := newRecordingBackend(nil)
	externalSrv := httptest.NewServer(http.HandlerFunc(external.handler))
	t.Cleanup(externalSrv.Close)

	backend := newRecordingBackend(nil)
	a := newFakeBackendApp(t, backend.handler)
	a.serve.tokens = serve.NewTokens("test-token")

	u, err := url.Parse(externalSrv.URL)
	if err != nil {
		t.Fatalf("parse external url %q: %v", externalSrv.URL, err)
	}
	if u.Port() == strconv.Itoa(a.serve.Port()) {
		t.Fatalf("external server landed on the serve's own port %s; the test proves nothing", u.Port())
	}

	resp, err := a.client.Get(externalSrv.URL + "/install.sh")
	if err != nil {
		t.Fatalf("GET external host: %v", err)
	}
	_ = resp.Body.Close()

	if got := external.authOf(t, "GET /install.sh"); got != "" {
		t.Errorf("Authorization sent to an external host = %q, want none", got)
	}
	// And the real destination chromium.Install dials, without a network call.
	stub := &stubRoundTripper{}
	rt := &loopbackAuthTransport{base: stub, token: a.serve.Token, baseURL: a.BaseURL}
	req, err := http.NewRequest(http.MethodGet, "https://raw.githubusercontent.com/o/r/main/install.sh", nil)
	if err != nil {
		t.Fatalf("NewRequest: %v", err)
	}
	resp, err = rt.RoundTrip(req)
	if err != nil {
		t.Fatalf("RoundTrip to github: %v", err)
	}
	_ = resp.Body.Close()
	if got := stub.got.Header.Get("Authorization"); got != "" {
		t.Errorf("Authorization sent to raw.githubusercontent.com = %q, want none", got)
	}
}

// TestCallerSuppliedAuthorizationIsLeftAlone: a call site that authenticated
// itself keeps its own credential, on any host.
func TestCallerSuppliedAuthorizationIsLeftAlone(t *testing.T) {
	backend := newRecordingBackend(nil)
	a := newFakeBackendApp(t, backend.handler)
	a.serve.tokens = serve.NewTokens("test-token")

	req, err := http.NewRequest(http.MethodGet, a.BaseURL()+"/v1/sessions", nil)
	if err != nil {
		t.Fatalf("NewRequest: %v", err)
	}
	req.Header.Set("Authorization", "Bearer caller-token")
	resp, err := a.client.Do(req)
	if err != nil {
		t.Fatalf("GET own serve: %v", err)
	}
	_ = resp.Body.Close()

	if got := backend.authOf(t, "GET /v1/sessions"); got != "Bearer caller-token" {
		t.Errorf("Authorization = %q, want the caller's own %q", got, "Bearer caller-token")
	}
}

// TestNoServeAddressMeansNoHeader: with the serve down there is no trustworthy
// address to compare a request against, so nothing is attached — even though a
// token is still held. Fail-closed, not fallback.
func TestNoServeAddressMeansNoHeader(t *testing.T) {
	external := newRecordingBackend(nil)
	externalSrv := httptest.NewServer(http.HandlerFunc(external.handler))
	t.Cleanup(externalSrv.Close)

	a := NewApp("") // serve never started: port 0
	a.serve.tokens = serve.NewTokens("test-token")
	if a.serve.Port() != 0 {
		t.Fatalf("serve port = %d, want 0 for a serve that never started", a.serve.Port())
	}

	resp, err := a.client.Get(externalSrv.URL + "/v1/sessions")
	if err != nil {
		t.Fatalf("GET: %v", err)
	}
	_ = resp.Body.Close()

	if got := external.authOf(t, "GET /v1/sessions"); got != "" {
		t.Errorf("Authorization = %q with no serve address, want none", got)
	}
}
