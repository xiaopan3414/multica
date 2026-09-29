package handler

import (
	"net/http"
	"testing"

	"github.com/multica-ai/multica/server/internal/testutil"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

func chatFolderTestRequest(t *testing.T, method, path string, body any) *http.Request {
	t.Helper()
	return withChatTestWorkspaceCtx(t, newRequest(method, path, body))
}

func TestChatFolderResponseIsCreatorOnly(t *testing.T) {
	creatorID := "11111111-1111-1111-1111-111111111111"
	folderID := "22222222-2222-2222-2222-222222222222"
	session := db.ChatSession{
		CreatorID: parseUUID(creatorID),
		FolderID:  parseUUID(folderID),
	}

	creatorResponse := chatSessionToResponseForUser(session, creatorID)
	if creatorResponse.FolderID == nil || *creatorResponse.FolderID != folderID {
		t.Fatalf("creator folder_id = %v, want %s", creatorResponse.FolderID, folderID)
	}
	participantResponse := chatSessionToResponseForUser(session, "33333333-3333-3333-3333-333333333333")
	if participantResponse.FolderID != nil {
		t.Fatalf("participant folder_id = %v, want nil", participantResponse.FolderID)
	}
}

func TestChatFolderLifecycle(t *testing.T) {
	if testHandler == nil || testPool == nil {
		t.Skip("database not available")
	}
	dbfx.Cleanup(t, `DELETE FROM chat_folder WHERE workspace_id = $1 AND creator_id = $2`, testWorkspaceID, testUserID)

	create := func(name string) ChatFolderResponse {
		t.Helper()
		return testutil.Decode[ChatFolderResponse](t, testHandler.CreateChatFolder,
			chatFolderTestRequest(t, http.MethodPost, "/api/chat/folders", map[string]any{"name": name}),
			http.StatusCreated,
		)
	}

	first := create("  Code reviews  ")
	if first.Name != "Code reviews" || first.Position != 0 {
		t.Fatalf("first folder = %#v, want trimmed name at position 0", first)
	}
	second := create("Operations")
	if second.Position != 1 {
		t.Fatalf("second position = %d, want 1", second.Position)
	}

	renameReq := withURLParam(
		chatFolderTestRequest(t, http.MethodPatch, "/api/chat/folders/"+first.ID, map[string]any{"name": "Reviews"}),
		"folderId",
		first.ID,
	)
	renamed := testutil.Decode[ChatFolderResponse](t, testHandler.UpdateChatFolder, renameReq, http.StatusOK)
	if renamed.Name != "Reviews" {
		t.Fatalf("renamed folder name = %q, want Reviews", renamed.Name)
	}

	testutil.Call(t, testHandler.ReorderChatFolders,
		chatFolderTestRequest(t, http.MethodPut, "/api/chat/folders/order", map[string]any{
			"folder_ids": []string{second.ID, first.ID},
		}),
	).Want(http.StatusNoContent)

	folders := testutil.Decode[[]ChatFolderResponse](t, testHandler.ListChatFolders,
		chatFolderTestRequest(t, http.MethodGet, "/api/chat/folders", nil),
		http.StatusOK,
	)
	if len(folders) != 2 || folders[0].ID != second.ID || folders[1].ID != first.ID {
		t.Fatalf("reordered folders = %#v, want [%s, %s]", folders, second.ID, first.ID)
	}

	agentID := dbfx.Agent(t, "Chat folder agent", handlerTestRuntimeID(t))
	sessionID := dbfx.ChatSession(t, agentID, testutil.Cols{"title": "Grouped chat"})
	moveReq := withURLParam(
		chatFolderTestRequest(t, http.MethodPatch, "/api/chat/sessions/"+sessionID, map[string]any{
			"folder_id": second.ID,
		}),
		"sessionId",
		sessionID,
	)
	moved := testutil.Decode[ChatSessionResponse](t, testHandler.UpdateChatSession, moveReq, http.StatusOK)
	if moved.FolderID == nil || *moved.FolderID != second.ID {
		t.Fatalf("moved folder_id = %v, want %s", moved.FolderID, second.ID)
	}

	deleteReq := withURLParam(
		chatFolderTestRequest(t, http.MethodDelete, "/api/chat/folders/"+second.ID, nil),
		"folderId",
		second.ID,
	)
	testutil.Call(t, testHandler.DeleteChatFolder, deleteReq).Want(http.StatusNoContent)

	var storedFolderID *string
	dbfx.QueryRow(t, `SELECT folder_id::text FROM chat_session WHERE id = $1`, sessionID).Scan(&storedFolderID)
	if storedFolderID != nil {
		t.Fatalf("folder_id after group delete = %v, want null", storedFolderID)
	}
}

func TestChatFolderReorderRequiresExactOwnedSet(t *testing.T) {
	if testHandler == nil || testPool == nil {
		t.Skip("database not available")
	}
	dbfx.Cleanup(t, `DELETE FROM chat_folder WHERE workspace_id = $1 AND creator_id = $2`, testWorkspaceID, testUserID)

	testutil.Decode[ChatFolderResponse](t, testHandler.CreateChatFolder,
		chatFolderTestRequest(t, http.MethodPost, "/api/chat/folders", map[string]any{"name": "One"}),
		http.StatusCreated,
	)
	testutil.Call(t, testHandler.ReorderChatFolders,
		chatFolderTestRequest(t, http.MethodPut, "/api/chat/folders/order", map[string]any{
			"folder_ids": []string{},
		}),
	).Want(http.StatusBadRequest)
}
