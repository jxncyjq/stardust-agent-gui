package main

import (
	"bufio"
	"context"
	"fmt"
	"net/http"
	"strings"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// StartSSEBridge opens a persistent SSE connection to the local agent serve
// and forwards each event to React via runtime.EventsEmit.
func StartSSEBridge(ctx context.Context, appCtx context.Context, baseURL string) {
	go func() {
		url := baseURL + "/v1/events"
		for {
			if err := ctx.Err(); err != nil {
				return
			}
			if err := consumeSSE(ctx, appCtx, url); err != nil {
				// retry silently; serve may not be ready yet
				select {
				case <-ctx.Done():
					return
				default:
				}
			}
		}
	}()
}

func consumeSSE(ctx context.Context, appCtx context.Context, url string) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "text/event-stream")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	scanner := bufio.NewScanner(resp.Body)
	var eventType string
	for scanner.Scan() {
		line := scanner.Text()
		switch {
		case strings.HasPrefix(line, "event:"):
			eventType = strings.TrimSpace(strings.TrimPrefix(line, "event:"))
		case strings.HasPrefix(line, "data:"):
			data := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
			if eventType != "" && data != "" {
				runtime.EventsEmit(appCtx, "agent:event", map[string]any{
					"type": eventType,
					"data": data,
				})
				// Token events get a dedicated channel for the chat stream
				if eventType == "runtime.token" || eventType == "token" {
					runtime.EventsEmit(appCtx, "agent:token", data)
				}
			}
			eventType = ""
		case line == "":
			eventType = ""
		}
	}
	return fmt.Errorf("SSE stream ended: %w", scanner.Err())
}
