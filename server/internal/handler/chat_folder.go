package handler

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

const chatFolderNameMaxLen = 80

type ChatFolderResponse struct {
	ID          string `json:"id"`
	WorkspaceID string `json:"workspace_id"`
	CreatorID   string `json:"creator_id"`
	Name        string `json:"name"`
	Position    int64  `json:"position"`
	CreatedAt   string `json:"created_at"`
	UpdatedAt   string `json:"updated_at"`
}

type CreateChatFolderRequest struct {
	Name string `json:"name"`
}

type UpdateChatFolderRequest struct {
	Name string `json:"name"`
}

type ReorderChatFoldersRequest struct {
	FolderIDs []string `json:"folder_ids"`
}

func chatFolderToResponse(folder db.ChatFolder) ChatFolderResponse {
	return ChatFolderResponse{
		ID:          uuidToString(folder.ID),
		WorkspaceID: uuidToString(folder.WorkspaceID),
		CreatorID:   uuidToString(folder.CreatorID),
		Name:        folder.Name,
		Position:    folder.Position,
		CreatedAt:   timestampToString(folder.CreatedAt),
		UpdatedAt:   timestampToString(folder.UpdatedAt),
	}
}

func validateChatFolderName(w http.ResponseWriter, name string) (string, bool) {
	name = strings.TrimSpace(name)
	if name == "" {
		writeError(w, http.StatusBadRequest, "name is required")
		return "", false
	}
	if len([]rune(name)) > chatFolderNameMaxLen {
		writeError(w, http.StatusBadRequest, "name is too long")
		return "", false
	}
	return name, true
}

func (h *Handler) ListChatFolders(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}
	workspaceID := ctxWorkspaceID(r.Context())

	folders, err := h.Queries.ListChatFoldersByCreator(r.Context(), db.ListChatFoldersByCreatorParams{
		WorkspaceID: parseUUID(workspaceID),
		CreatorID:   parseUUID(userID),
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list chat folders")
		return
	}

	response := make([]ChatFolderResponse, 0, len(folders))
	for _, folder := range folders {
		response = append(response, chatFolderToResponse(folder))
	}
	writeJSON(w, http.StatusOK, response)
}

func (h *Handler) CreateChatFolder(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}
	workspaceID := ctxWorkspaceID(r.Context())

	var req CreateChatFolderRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	name, ok := validateChatFolderName(w, req.Name)
	if !ok {
		return
	}

	folder, err := h.Queries.CreateChatFolder(r.Context(), db.CreateChatFolderParams{
		WorkspaceID: parseUUID(workspaceID),
		CreatorID:   parseUUID(userID),
		Name:        name,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create chat folder")
		return
	}
	writeJSON(w, http.StatusCreated, chatFolderToResponse(folder))
}

func (h *Handler) UpdateChatFolder(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}
	workspaceID := ctxWorkspaceID(r.Context())
	folderID, ok := parseUUIDOrBadRequest(w, chi.URLParam(r, "folderId"), "chat folder id")
	if !ok {
		return
	}

	var req UpdateChatFolderRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	name, ok := validateChatFolderName(w, req.Name)
	if !ok {
		return
	}

	folder, err := h.Queries.UpdateChatFolderName(r.Context(), db.UpdateChatFolderNameParams{
		ID:          folderID,
		WorkspaceID: parseUUID(workspaceID),
		CreatorID:   parseUUID(userID),
		Name:        name,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "chat folder not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to update chat folder")
		return
	}
	writeJSON(w, http.StatusOK, chatFolderToResponse(folder))
}

func (h *Handler) DeleteChatFolder(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}
	workspaceID := ctxWorkspaceID(r.Context())
	folderID, ok := parseUUIDOrBadRequest(w, chi.URLParam(r, "folderId"), "chat folder id")
	if !ok {
		return
	}
	workspaceUUID := parseUUID(workspaceID)
	userUUID := parseUUID(userID)

	tx, err := h.TxStarter.Begin(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to start transaction")
		return
	}
	defer tx.Rollback(r.Context())
	qtx := h.Queries.WithTx(tx)

	if _, err := qtx.GetChatFolderForCreator(r.Context(), db.GetChatFolderForCreatorParams{
		ID:          folderID,
		WorkspaceID: workspaceUUID,
		CreatorID:   userUUID,
	}); errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "chat folder not found")
		return
	} else if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load chat folder")
		return
	}

	if err := qtx.ClearChatSessionFolderByFolder(r.Context(), db.ClearChatSessionFolderByFolderParams{
		FolderID:    folderID,
		WorkspaceID: workspaceUUID,
		CreatorID:   userUUID,
	}); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to clear chat folder")
		return
	}
	deleted, err := qtx.DeleteChatFolder(r.Context(), db.DeleteChatFolderParams{
		ID:          folderID,
		WorkspaceID: workspaceUUID,
		CreatorID:   userUUID,
	})
	if err != nil || deleted != 1 {
		writeError(w, http.StatusInternalServerError, "failed to delete chat folder")
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to commit chat folder delete")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) ReorderChatFolders(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUserID(w, r)
	if !ok {
		return
	}
	workspaceID := ctxWorkspaceID(r.Context())
	workspaceUUID := parseUUID(workspaceID)
	userUUID := parseUUID(userID)

	var req ReorderChatFoldersRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	tx, err := h.TxStarter.Begin(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to start transaction")
		return
	}
	defer tx.Rollback(r.Context())
	qtx := h.Queries.WithTx(tx)

	folders, err := qtx.ListChatFoldersByCreator(r.Context(), db.ListChatFoldersByCreatorParams{
		WorkspaceID: workspaceUUID,
		CreatorID:   userUUID,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list chat folders")
		return
	}
	if len(req.FolderIDs) != len(folders) {
		writeError(w, http.StatusBadRequest, "folder_ids must contain every chat folder exactly once")
		return
	}
	existing := make(map[string]struct{}, len(folders))
	for _, folder := range folders {
		existing[uuidToString(folder.ID)] = struct{}{}
	}
	seen := make(map[string]struct{}, len(req.FolderIDs))
	for position, rawID := range req.FolderIDs {
		folderID, ok := parseUUIDOrBadRequest(w, rawID, "folder_id")
		if !ok {
			return
		}
		resolvedID := uuidToString(folderID)
		if _, ok := existing[resolvedID]; !ok {
			writeError(w, http.StatusBadRequest, "folder_ids must contain every chat folder exactly once")
			return
		}
		if _, duplicate := seen[resolvedID]; duplicate {
			writeError(w, http.StatusBadRequest, "folder_ids must contain every chat folder exactly once")
			return
		}
		seen[resolvedID] = struct{}{}
		updated, err := qtx.UpdateChatFolderPosition(r.Context(), db.UpdateChatFolderPositionParams{
			ID:          folderID,
			WorkspaceID: workspaceUUID,
			CreatorID:   userUUID,
			Position:    int64(position),
		})
		if err != nil || updated != 1 {
			writeError(w, http.StatusInternalServerError, "failed to reorder chat folders")
			return
		}
	}
	if err := tx.Commit(r.Context()); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to commit chat folder reorder")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
