package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/multica-ai/multica/server/internal/events"
	"github.com/multica-ai/multica/server/pkg/protocol"
)

func TestCreateChatSessionPublishesCreatedAfterCommit(t *testing.T) {
	if testHandler == nil || testPool == nil {
		t.Skip("database not available")
	}

	h := *testHandler
	h.Bus = events.New()
	agentID := createHandlerTestAgent(t, "ChatSessionCreatedEventAgent", []byte("[]"))

	published := make(chan events.Event, 1)
	var visibleAtPublish bool
	h.Bus.Subscribe(protocol.EventChatSessionCreated, func(event events.Event) {
		payload, ok := event.Payload.(protocol.ChatSessionCreatedPayload)
		if !ok {
			return
		}
		var count int
		if err := testPool.QueryRow(
			context.Background(),
			`SELECT count(*) FROM chat_session WHERE id = $1`,
			payload.ChatSessionID,
		).Scan(&count); err == nil && count == 1 {
			visibleAtPublish = true
		}
		published <- event
	})

	w := httptest.NewRecorder()
	req := withChatTestWorkspaceCtx(t, newRequest(http.MethodPost, "/api/chat/sessions", map[string]any{
		"agent_id": agentID,
		"title":    "created on another device",
	}))
	h.CreateChatSession(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("CreateChatSession: expected 201, got %d: %s", w.Code, w.Body.String())
	}

	var response ChatSessionResponse
	if err := json.NewDecoder(w.Body).Decode(&response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	t.Cleanup(func() {
		_, _ = testPool.Exec(context.Background(), `DELETE FROM chat_session WHERE id = $1`, response.ID)
	})

	event := <-published
	payload, ok := event.Payload.(protocol.ChatSessionCreatedPayload)
	if !ok {
		t.Fatalf("payload type = %T, want ChatSessionCreatedPayload", event.Payload)
	}
	if payload.ChatSessionID != response.ID || payload.WorkspaceID != testWorkspaceID {
		t.Fatalf("payload = %+v, want session %s in workspace %s", payload, response.ID, testWorkspaceID)
	}
	if event.ActorID != testUserID || event.ActorType != "member" {
		t.Fatalf("actor = %s/%s, want member/%s", event.ActorType, event.ActorID, testUserID)
	}
	if !visibleAtPublish {
		t.Fatal("chat:session_created fired before the transaction was externally visible")
	}
}
