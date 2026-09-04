package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
)

// GetSessionEvents 拉一条会话的原始事件，供轨迹视图的首屏与翻页使用。
//
// 它直通 P4a 的 GET /v1/sessions/{id}/events：响应里的 next_seq 由服务端给出，
// 截断时指向**被截掉的第一条**，前端据此续读不会漏事件。
//
// 走 Go 绑定而不是前端 fetch：WebView2 里跨源请求要处理 CORS 预检，而本仓已有
// 的绑定路径没有这个问题（app.go 的 apiGet 同源直连内嵌 serve）。
//
// fromSeq/limit 为 0 时不带该参数，由服务端用它的默认值——参数缺席是端点契约里
// 显式允许的可选，不是兜底。
//
// 请求走 apiGetStatusChecked 而不是 apiGet：apiGet 不看状态码，会把 404 的错误
// 体当成正常响应返回，前端于是把「会话不存在」读成「这条会话没有事件」——而
// P4a 特意把这两件事分成 404 与空列表，正是为了让前端能区分。
func (a *App) GetSessionEvents(sessionID string, fromSeq int64, limit int) (map[string]any, error) {
	sessionID = strings.TrimSpace(sessionID)
	if sessionID == "" {
		return nil, fmt.Errorf("session id is required")
	}
	q := url.Values{}
	if fromSeq > 0 {
		q.Set("from_seq", strconv.FormatInt(fromSeq, 10))
	}
	if limit > 0 {
		q.Set("limit", strconv.Itoa(limit))
	}
	path := "/v1/sessions/" + url.PathEscape(sessionID) + "/events"
	if encoded := q.Encode(); encoded != "" {
		path += "?" + encoded
	}
	body, err := a.apiGetStatusChecked(path)
	if err != nil {
		return nil, fmt.Errorf("read session events for %q: %w", sessionID, err)
	}
	var page map[string]any
	if err := json.Unmarshal(body, &page); err != nil {
		return nil, fmt.Errorf("decode session events for %q: %w", sessionID, err)
	}
	return page, nil
}

// apiGetStatusChecked GETs path from the local serve and returns the body only
// for a 2xx response, turning any other status into an error carrying the
// status and the (truncated) body.
//
// It exists because apiGet deliberately returns the body for every status: its
// callers decode a list and a malformed body fails at json.Unmarshal, so the
// missing status check never surfaced. That is not enough here — a 404 body is
// {"error":...}, which unmarshals into map[string]any without complaint and
// would reach the trajectory view as a page with no events. The bearer token is
// attached by the shared client's transport (loopbackAuthTransport), so this
// helper does not repeat it.
func (a *App) apiGetStatusChecked(path string) ([]byte, error) {
	req, err := http.NewRequest(http.MethodGet, a.BaseURL()+path, nil)
	if err != nil {
		return nil, fmt.Errorf("build GET %s request: %w", path, err)
	}
	resp, err := a.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("get %s: %w", path, err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read %s response body: %w", path, err)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("get %s: status %d: %s", path, resp.StatusCode, truncateErrorBody(string(body)))
	}
	return body, nil
}

// maxErrorBodyRunes bounds how much of a failed response's body reaches the
// error string.
//
// The bound exists because this error is USER-FACING: it travels through the
// Wails binding into the trajectory view's failure notice. A server answering
// 500 with a stack trace or an HTML error page would otherwise put all of it
// on screen — the plugin panel has already been through this once, with a
// 305-character chain rendered raw (fixed in #48). 512 runes is enough for the
// {"error":...} bodies this service actually returns, and short enough that a
// pathological one cannot take over the panel.
const maxErrorBodyRunes = 512

// truncateErrorBody trims a response body for inclusion in an error string,
// cutting it to maxErrorBodyRunes and SAYING SO when it does.
//
// Announcing the cut is the point: a body that was silently shortened reads as
// the whole of what the server said, and someone diagnosing a failure would
// take a truncated JSON document for a malformed one. Runes, not bytes, so a
// cut never lands inside a multi-byte character and produces mojibake in the
// notice.
func truncateErrorBody(body string) string {
	trimmed := strings.TrimSpace(body)
	runes := []rune(trimmed)
	if len(runes) <= maxErrorBodyRunes {
		return trimmed
	}
	return fmt.Sprintf("%s… (truncated, %d of %d characters shown)",
		string(runes[:maxErrorBodyRunes]), maxErrorBodyRunes, len(runes))
}
