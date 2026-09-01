package handler

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"unicode"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

const maxAgentWorkingDirectoryLength = 4096

type AgentWorkingDirectoryResponse struct {
	AgentID     string `json:"agent_id"`
	RuntimeID   string `json:"runtime_id,omitempty"`
	DaemonID    string `json:"daemon_id,omitempty"`
	RuntimeName string `json:"runtime_name,omitempty"`
	LocalPath   string `json:"local_path"`
	Available   bool   `json:"available"`
}

type UpdateAgentWorkingDirectoryRequest struct {
	LocalPath string `json:"local_path"`
}

func parseAgentWorkingDirectories(raw []byte) (map[string]string, error) {
	if len(raw) == 0 {
		return map[string]string{}, nil
	}
	var directories map[string]string
	if err := json.Unmarshal(raw, &directories); err != nil {
		return nil, fmt.Errorf("parse agent local working directories: %w", err)
	}
	if directories == nil {
		return map[string]string{}, nil
	}
	return directories, nil
}

func agentWorkingDirectoryForDaemon(raw []byte, daemonID string) (string, error) {
	directories, err := parseAgentWorkingDirectories(raw)
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(directories[strings.TrimSpace(daemonID)]), nil
}

func looksLikeAbsoluteLocalPath(path string) bool {
	if path == "" || len(path) > maxAgentWorkingDirectoryLength {
		return false
	}
	for _, r := range path {
		if unicode.IsControl(r) {
			return false
		}
	}
	if strings.HasPrefix(path, "/") || strings.HasPrefix(path, `\\`) {
		return true
	}
	return len(path) >= 3 &&
		((path[0] >= 'A' && path[0] <= 'Z') || (path[0] >= 'a' && path[0] <= 'z')) &&
		path[1] == ':' && (path[2] == '\\' || path[2] == '/')
}

func agentWorkingDirectoryRuntimeName(runtime db.AgentRuntime) string {
	if name := strings.TrimSpace(runtime.CustomName.String); name != "" {
		return name
	}
	return strings.TrimSpace(runtime.Name)
}

func (h *Handler) workingDirectoryRuntimeForAgent(r *http.Request, agent db.Agent) (db.AgentRuntime, bool, error) {
	if !agent.RuntimeID.Valid {
		return db.AgentRuntime{}, false, nil
	}
	runtime, err := h.Queries.GetAgentRuntimeForWorkspace(r.Context(), db.GetAgentRuntimeForWorkspaceParams{
		ID:          agent.RuntimeID,
		WorkspaceID: agent.WorkspaceID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return db.AgentRuntime{}, false, nil
	}
	if err != nil {
		return db.AgentRuntime{}, false, err
	}
	if runtime.RuntimeMode != "local" || !runtime.DaemonID.Valid || strings.TrimSpace(runtime.DaemonID.String) == "" {
		return runtime, false, nil
	}
	return runtime, true, nil
}

func agentWorkingDirectoryResponse(agent db.Agent, runtime db.AgentRuntime, available bool) (AgentWorkingDirectoryResponse, error) {
	resp := AgentWorkingDirectoryResponse{
		AgentID:   uuidToString(agent.ID),
		RuntimeID: uuidToString(agent.RuntimeID),
		LocalPath: "",
		Available: available,
	}
	if !available {
		return resp, nil
	}
	resp.DaemonID = strings.TrimSpace(runtime.DaemonID.String)
	resp.RuntimeName = agentWorkingDirectoryRuntimeName(runtime)
	localPath, err := agentWorkingDirectoryForDaemon(agent.LocalWorkingDirectories, resp.DaemonID)
	if err != nil {
		return AgentWorkingDirectoryResponse{}, err
	}
	resp.LocalPath = localPath
	return resp, nil
}

// GetAgentWorkingDirectory returns the private path for the daemon hosting the
// agent's current runtime. The dedicated endpoint keeps absolute local paths
// out of ordinary agent list/detail payloads.
func (h *Handler) GetAgentWorkingDirectory(w http.ResponseWriter, r *http.Request) {
	agent, ok := h.loadAgentForUser(w, r, chi.URLParam(r, "id"))
	if !ok || !h.canManageAgent(w, r, agent) {
		return
	}
	runtime, available, err := h.workingDirectoryRuntimeForAgent(r, agent)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load agent runtime")
		return
	}
	resp, err := agentWorkingDirectoryResponse(agent, runtime, available)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load agent working directory")
		return
	}
	writeJSON(w, http.StatusOK, resp)
}

// UpdateAgentWorkingDirectory stores a syntactically absolute path for the
// agent's current daemon. The daemon validates existence and read/write access
// locally before task execution because the API server cannot inspect another
// machine's filesystem.
func (h *Handler) UpdateAgentWorkingDirectory(w http.ResponseWriter, r *http.Request) {
	agent, ok := h.loadAgentForUser(w, r, chi.URLParam(r, "id"))
	if !ok || !h.canManageAgent(w, r, agent) {
		return
	}
	var req UpdateAgentWorkingDirectoryRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	localPath := strings.TrimSpace(req.LocalPath)
	if !looksLikeAbsoluteLocalPath(localPath) {
		writeError(w, http.StatusBadRequest, "local_path must be an absolute local directory path")
		return
	}
	runtime, available, err := h.workingDirectoryRuntimeForAgent(r, agent)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load agent runtime")
		return
	}
	if !available {
		writeError(w, http.StatusConflict, "agent must be bound to a local runtime")
		return
	}
	updated, err := h.Queries.SetAgentWorkingDirectory(r.Context(), db.SetAgentWorkingDirectoryParams{
		DaemonID:  runtime.DaemonID.String,
		LocalPath: localPath,
		AgentID:   agent.ID,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to save agent working directory")
		return
	}
	resp, err := agentWorkingDirectoryResponse(updated, runtime, true)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load agent working directory")
		return
	}
	writeJSON(w, http.StatusOK, resp)
}

func (h *Handler) DeleteAgentWorkingDirectory(w http.ResponseWriter, r *http.Request) {
	agent, ok := h.loadAgentForUser(w, r, chi.URLParam(r, "id"))
	if !ok || !h.canManageAgent(w, r, agent) {
		return
	}
	runtime, available, err := h.workingDirectoryRuntimeForAgent(r, agent)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load agent runtime")
		return
	}
	if !available {
		writeError(w, http.StatusConflict, "agent must be bound to a local runtime")
		return
	}
	updated, err := h.Queries.DeleteAgentWorkingDirectory(r.Context(), db.DeleteAgentWorkingDirectoryParams{
		DaemonID: runtime.DaemonID.String,
		AgentID:  agent.ID,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to reset agent working directory")
		return
	}
	resp, err := agentWorkingDirectoryResponse(updated, runtime, true)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load agent working directory")
		return
	}
	writeJSON(w, http.StatusOK, resp)
}
