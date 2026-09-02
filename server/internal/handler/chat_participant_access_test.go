package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestChatSessionAgentOwnerCanReadAndContinue(t *testing.T) {
	if testHandler == nil || testPool == nil {
		t.Skip("database not available")
	}

	agentID, agentOwnerID, unrelatedMemberID := privateAgentTestFixture(t)
	sessionID := insertChatSessionAs(t, agentID, testUserID)
	if _, err := testPool.Exec(context.Background(), `
		INSERT INTO chat_message (chat_session_id, role, content)
		VALUES ($1, 'user', 'message from the original creator')
	`, sessionID); err != nil {
		t.Fatalf("insert creator message: %v", err)
	}

	ownerRequest := func(method, path string, body any) *http.Request {
		req := newRequestAs(agentOwnerID, method, path, body)
		return chatPendingCtxAs(t, req, agentOwnerID)
	}

	listW := httptest.NewRecorder()
	testHandler.ListChatSessions(listW, ownerRequest(http.MethodGet, "/api/chat/sessions?status=all", nil))
	if listW.Code != http.StatusOK {
		t.Fatalf("ListChatSessions as agent owner: got %d: %s", listW.Code, listW.Body.String())
	}
	var sessions []ChatSessionResponse
	if err := json.Unmarshal(listW.Body.Bytes(), &sessions); err != nil {
		t.Fatalf("decode owner session list: %v", err)
	}
	if !chatSessionListContains(sessions, sessionID) {
		t.Fatalf("agent owner session list did not include creator's session %s", sessionID)
	}

	getW := httptest.NewRecorder()
	getReq := withURLParam(ownerRequest(http.MethodGet, "/api/chat/sessions/"+sessionID, nil), "sessionId", sessionID)
	testHandler.GetChatSession(getW, getReq)
	if getW.Code != http.StatusOK {
		t.Fatalf("GetChatSession as agent owner: got %d: %s", getW.Code, getW.Body.String())
	}

	messagesW := httptest.NewRecorder()
	messagesReq := withURLParam(ownerRequest(http.MethodGet, "/api/chat/sessions/"+sessionID+"/messages", nil), "sessionId", sessionID)
	testHandler.ListChatMessages(messagesW, messagesReq)
	if messagesW.Code != http.StatusOK {
		t.Fatalf("ListChatMessages as agent owner: got %d: %s", messagesW.Code, messagesW.Body.String())
	}
	var messages []ChatMessageResponse
	if err := json.Unmarshal(messagesW.Body.Bytes(), &messages); err != nil {
		t.Fatalf("decode owner message history: %v", err)
	}
	if len(messages) != 1 || messages[0].Content != "message from the original creator" {
		t.Fatalf("agent owner did not receive full history: %+v", messages)
	}

	sendW := httptest.NewRecorder()
	sendReq := withURLParam(ownerRequest(http.MethodPost, "/api/chat/sessions/"+sessionID+"/messages", map[string]any{
		"content": "reply from the agent owner",
	}), "sessionId", sessionID)
	testHandler.SendChatMessage(sendW, sendReq)
	if sendW.Code != http.StatusCreated {
		t.Fatalf("SendChatMessage as agent owner: got %d: %s", sendW.Code, sendW.Body.String())
	}
	var sent SendChatMessageResponse
	if err := json.Unmarshal(sendW.Body.Bytes(), &sent); err != nil {
		t.Fatalf("decode owner send response: %v", err)
	}
	var initiatorUserID string
	if err := testPool.QueryRow(context.Background(), `
		SELECT initiator_user_id FROM agent_task_queue WHERE id = $1
	`, sent.TaskID).Scan(&initiatorUserID); err != nil {
		t.Fatalf("load owner-created chat task: %v", err)
	}
	if initiatorUserID != agentOwnerID {
		t.Fatalf("task initiator = %s, want agent owner %s", initiatorUserID, agentOwnerID)
	}

	cancelW := httptest.NewRecorder()
	cancelReq := withURLParam(ownerRequest(http.MethodPost, "/api/tasks/"+sent.TaskID+"/cancel", nil), "taskId", sent.TaskID)
	testHandler.CancelTaskByUser(cancelW, cancelReq)
	if cancelW.Code != http.StatusOK {
		t.Fatalf("CancelTaskByUser as agent owner: got %d: %s", cancelW.Code, cancelW.Body.String())
	}

	creatorW := httptest.NewRecorder()
	creatorReq := withURLParam(withChatTestWorkspaceCtx(t, newRequest(http.MethodGet, "/api/chat/sessions/"+sessionID, nil)), "sessionId", sessionID)
	testHandler.GetChatSession(creatorW, creatorReq)
	if creatorW.Code != http.StatusOK {
		t.Fatalf("GetChatSession as creator: got %d: %s", creatorW.Code, creatorW.Body.String())
	}

	peerListW := httptest.NewRecorder()
	peerListReq := chatPendingCtxAs(t, newRequestAs(unrelatedMemberID, http.MethodGet, "/api/chat/sessions?status=all", nil), unrelatedMemberID)
	testHandler.ListChatSessions(peerListW, peerListReq)
	if peerListW.Code != http.StatusOK {
		t.Fatalf("ListChatSessions as unrelated member: got %d: %s", peerListW.Code, peerListW.Body.String())
	}
	var peerSessions []ChatSessionResponse
	if err := json.Unmarshal(peerListW.Body.Bytes(), &peerSessions); err != nil {
		t.Fatalf("decode unrelated member session list: %v", err)
	}
	if chatSessionListContains(peerSessions, sessionID) {
		t.Fatalf("unrelated member session list exposed session %s", sessionID)
	}

	peerGetW := httptest.NewRecorder()
	peerGetReq := withURLParam(chatPendingCtxAs(t, newRequestAs(unrelatedMemberID, http.MethodGet, "/api/chat/sessions/"+sessionID, nil), unrelatedMemberID), "sessionId", sessionID)
	testHandler.GetChatSession(peerGetW, peerGetReq)
	if peerGetW.Code != http.StatusForbidden {
		t.Fatalf("GetChatSession as unrelated member: got %d, want 403: %s", peerGetW.Code, peerGetW.Body.String())
	}
}

func chatSessionListContains(sessions []ChatSessionResponse, sessionID string) bool {
	for _, session := range sessions {
		if session.ID == sessionID {
			return true
		}
	}
	return false
}
