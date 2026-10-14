package handler

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"

	"github.com/multica-ai/multica/server/internal/testutil"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
	"github.com/multica-ai/multica/server/pkg/protocol"
)

func TestLooksLikeAbsoluteLocalPath(t *testing.T) {
	for _, path := range []string{`D:\work\project`, `C:/work/project`, `\\fileserver\share\project`, `/srv/project`} {
		if !looksLikeAbsoluteLocalPath(path) {
			t.Fatalf("looksLikeAbsoluteLocalPath(%q) = false, want true", path)
		}
	}
	for _, path := range []string{"", "project", `D:project`, "D:\\work\nproject"} {
		if looksLikeAbsoluteLocalPath(path) {
			t.Fatalf("looksLikeAbsoluteLocalPath(%q) = true, want false", path)
		}
	}
}

func TestAgentWorkingDirectoryForDaemon(t *testing.T) {
	raw := []byte(`{"daemon-a":"D:\\work\\a","daemon-b":"E:\\work\\b"}`)
	got, err := agentWorkingDirectoryForDaemon(raw, "daemon-b")
	if err != nil {
		t.Fatalf("agentWorkingDirectoryForDaemon: %v", err)
	}
	if got != `E:\work\b` {
		t.Fatalf("directory = %q, want E:\\work\\b", got)
	}
	if _, err := agentWorkingDirectoryForDaemon([]byte(`{"daemon-a":42}`), "daemon-a"); err == nil {
		t.Fatal("non-string directory value was accepted")
	}
}

func TestAgentWorkingDirectoryAPIStoresCurrentDaemonPath(t *testing.T) {
	const daemonID = "working-directory-api-daemon"
	runtimeID := dbfx.Runtime(t, "Working directory API runtime", testutil.Cols{
		"daemon_id":    daemonID,
		"runtime_mode": "local",
		"owner_id":     testUserID,
	})
	agentID := dbfx.Agent(t, "Working directory API agent", runtimeID)
	path := `D:\work\existing-project`

	put := withURLParam(newRequest(http.MethodPut, "/api/agents/"+agentID+"/working-directory", map[string]string{
		"local_path": path,
	}), "id", agentID)
	var saved AgentWorkingDirectoryResponse
	testutil.Call(t, testHandler.UpdateAgentWorkingDirectory, put).Want(http.StatusOK).JSON(&saved)
	if saved.AgentID != agentID || saved.RuntimeID != runtimeID || saved.DaemonID != daemonID || saved.LocalPath != path || !saved.Available {
		t.Fatalf("saved response = %+v", saved)
	}

	get := withURLParam(newRequest(http.MethodGet, "/api/agents/"+agentID+"/working-directory", nil), "id", agentID)
	var loaded AgentWorkingDirectoryResponse
	testutil.Call(t, testHandler.GetAgentWorkingDirectory, get).Want(http.StatusOK).JSON(&loaded)
	if loaded.LocalPath != path || loaded.DaemonID != daemonID {
		t.Fatalf("loaded response = %+v", loaded)
	}

	agentGet := withURLParam(newRequest(http.MethodGet, "/api/agents/"+agentID, nil), "id", agentID)
	agentResponse := testutil.Call(t, testHandler.GetAgent, agentGet).Want(http.StatusOK)
	if strings.Contains(agentResponse.Body.String(), path) || strings.Contains(agentResponse.Body.String(), "local_working_directories") {
		t.Fatalf("ordinary agent response exposed private path: %s", agentResponse.Body.String())
	}

	del := withURLParam(newRequest(http.MethodDelete, "/api/agents/"+agentID+"/working-directory", nil), "id", agentID)
	var reset AgentWorkingDirectoryResponse
	testutil.Call(t, testHandler.DeleteAgentWorkingDirectory, del).Want(http.StatusOK).JSON(&reset)
	if reset.LocalPath != "" || !reset.Available {
		t.Fatalf("reset response = %+v", reset)
	}
}

func TestAgentWorkingDirectoryAPIRejectsRelativePath(t *testing.T) {
	const daemonID = "working-directory-relative-daemon"
	runtimeID := dbfx.Runtime(t, "Working directory relative runtime", testutil.Cols{
		"daemon_id":    daemonID,
		"runtime_mode": "local",
		"owner_id":     testUserID,
	})
	agentID := dbfx.Agent(t, "Working directory relative agent", runtimeID)
	req := withURLParam(newRequest(http.MethodPut, "/api/agents/"+agentID+"/working-directory", map[string]string{
		"local_path": "relative/project",
	}), "id", agentID)
	testutil.Call(t, testHandler.UpdateAgentWorkingDirectory, req).Want(http.StatusBadRequest)
}

func TestAgentDirectoryLockAPIRoundTrip(t *testing.T) {
	runtimeID := dbfx.Runtime(t, "Directory lock runtime", testutil.Cols{
		"daemon_id": "lock-daemon", "runtime_mode": "local", "owner_id": testUserID,
		"metadata": testutil.Raw(`'{"capabilities":["directory-lock-v1"]}'::jsonb`),
	})
	agentID := dbfx.Agent(t, "Directory lock agent", runtimeID, testutil.Cols{
		"runtime_config":            testutil.Raw(`'{"model":"keep-me"}'::jsonb`),
		"local_working_directories": testutil.Raw(`'{"lock-daemon":"D:\\repo"}'::jsonb`),
	})
	for _, enabled := range []bool{true, false} {
		req := withURLParam(newRequest(http.MethodPut, "/api/agents/"+agentID+"/directory-lock", map[string]bool{
			"enabled": enabled,
		}), "id", agentID)
		var saved AgentWorkingDirectoryResponse
		testutil.Call(t, testHandler.UpdateAgentDirectoryLock, req).Want(http.StatusOK).JSON(&saved)
		if saved.DirectoryLockEnabled != enabled || !saved.DirectoryLockSupported || saved.LocalPath != `D:\repo` {
			t.Fatalf("saved lock response = %+v, want enabled=%v and unchanged directory", saved, enabled)
		}
		get := withURLParam(newRequest(http.MethodGet, "/api/agents/"+agentID+"/working-directory", nil), "id", agentID)
		var loaded AgentWorkingDirectoryResponse
		testutil.Call(t, testHandler.GetAgentWorkingDirectory, get).Want(http.StatusOK).JSON(&loaded)
		if loaded.DirectoryLockEnabled != enabled {
			t.Fatalf("persisted lock=%v, want %v", loaded.DirectoryLockEnabled, enabled)
		}
		var config []byte
		dbfx.QueryRow(t, `SELECT runtime_config FROM agent WHERE id = $1`, agentID).Scan(&config)
		var values map[string]any
		if err := json.Unmarshal(config, &values); err != nil || values["model"] != "keep-me" {
			t.Fatalf("unrelated runtime configuration changed: %s, error=%v", config, err)
		}
	}
}

func TestAgentDirectoryLockAPIRejectsOldDaemonAndInvalidInput(t *testing.T) {
	runtimeID := dbfx.Runtime(t, "Old lock runtime", testutil.Cols{
		"daemon_id": "old-lock-daemon", "runtime_mode": "local", "owner_id": testUserID,
	})
	agentID := dbfx.Agent(t, "Old lock agent", runtimeID)
	for _, tc := range []struct {
		body   any
		status int
	}{
		{map[string]bool{"enabled": true}, http.StatusUnprocessableEntity},
		{map[string]bool{"enabled": false}, http.StatusOK},
		{map[string]string{"enabled": "true"}, http.StatusBadRequest},
		{map[string]any{}, http.StatusBadRequest},
	} {
		req := withURLParam(newRequest(http.MethodPut, "/api/agents/"+agentID+"/directory-lock", tc.body), "id", agentID)
		testutil.Call(t, testHandler.UpdateAgentDirectoryLock, req).Want(tc.status)
	}
}

func TestDirectoryLockClaimBlockReason(t *testing.T) {
	runtime := runtimeWithVersion("daemon-a", "old")
	config := []byte(`{"local_directory_lock_enabled":true}`)
	resources := []ProjectResourceData{{ResourceType: "local_directory", ResourceRef: localDirRef(t, "/repo", "daemon-a", "in_place")}}
	if directoryLockClaimBlockReason(config, "/repo", nil, runtime, false) == "" {
		t.Fatal("old daemon accepted private directory lock")
	}
	if directoryLockClaimBlockReason(config, "", resources, runtime, false) == "" {
		t.Fatal("old daemon accepted project directory lock")
	}
	if got := directoryLockClaimBlockReason(config, "/repo", resources, runtime, true); got != "" {
		t.Fatal(got)
	}
	if got := directoryLockClaimBlockReason([]byte(`{}`), "/repo", resources, runtime, false); got != "" {
		t.Fatal(got)
	}
	resources[0].ResourceRef = localDirRef(t, "/repo", "daemon-a", "worktree")
	if got := directoryLockClaimBlockReason(config, "", resources, runtime, false); got != "" {
		t.Fatal(got)
	}
	if got := directoryLockClaimBlockReason(config, "", nil, db.AgentRuntime{}, false); got != "" {
		t.Fatal(got)
	}
	if !protocol.AgentDirectoryLockEnabled(config) {
		t.Fatal("lock config not recognized")
	}
}

func TestAgentDirectoryLockAPIPermissions(t *testing.T) {
	runtimeID := dbfx.Runtime(t, "Lock permission runtime", testutil.Cols{
		"daemon_id": "permission-lock-daemon", "runtime_mode": "local", "owner_id": testUserID,
		"metadata": testutil.Raw(`'{"capabilities":["directory-lock-v1"]}'::jsonb`),
	})
	agentID := dbfx.Agent(t, "Lock permission agent", runtimeID)
	for _, role := range []string{"member", "admin"} {
		userID := dbfx.User(t, "Lock "+role, "lock-"+role+"@test.invalid")
		dbfx.Member(t, testWorkspaceID, userID, role)
		req := withURLParam(newRequest(http.MethodPut, "/api/agents/"+agentID+"/directory-lock",
			map[string]bool{"enabled": true}), "id", agentID)
		req.Header.Set("X-User-ID", userID)
		status := http.StatusForbidden
		if role == "admin" {
			status = http.StatusOK
		}
		testutil.Call(t, testHandler.UpdateAgentDirectoryLock, req).Want(status)
	}
}

func TestAgentDirectoryLockAPINullConfigAndCloudRuntime(t *testing.T) {
	runtimeID := dbfx.Runtime(t, "Null lock config runtime", testutil.Cols{
		"daemon_id": "null-lock-daemon", "runtime_mode": "local", "owner_id": testUserID,
		"metadata": testutil.Raw(`'{"capabilities":["directory-lock-v1"]}'::jsonb`),
	})
	agentID := dbfx.Agent(t, "Null lock config agent", runtimeID, testutil.Cols{
		"runtime_config": testutil.Raw(`'null'::jsonb`),
	})
	req := withURLParam(newRequest(http.MethodPut, "/api/agents/"+agentID+"/directory-lock",
		map[string]bool{"enabled": true}), "id", agentID)
	var saved AgentWorkingDirectoryResponse
	testutil.Call(t, testHandler.UpdateAgentDirectoryLock, req).Want(http.StatusOK).JSON(&saved)
	if !saved.DirectoryLockEnabled {
		t.Fatal("enabling lock on a null config was not persisted")
	}

	cloudID := dbfx.Runtime(t, "Cloud lock runtime")
	cloudAgentID := dbfx.Agent(t, "Cloud lock agent", cloudID)
	req = withURLParam(newRequest(http.MethodPut, "/api/agents/"+cloudAgentID+"/directory-lock",
		map[string]bool{"enabled": true}), "id", cloudAgentID)
	testutil.Call(t, testHandler.UpdateAgentDirectoryLock, req).Want(http.StatusConflict)
}

func TestClaimTask_DirectoryLockGate(t *testing.T) {
	for _, capable := range []bool{false, true} {
		t.Run(fmt.Sprintf("capable=%v", capable), func(t *testing.T) {
			const daemonID = "directory-lock-claim-daemon"
			runtimeID := dbfx.Runtime(t, "Directory lock claim runtime", testutil.Cols{
				"daemon_id": daemonID, "runtime_mode": "local", "owner_id": testUserID,
			})
			agentID := dbfx.Agent(t, "Directory lock claim agent", runtimeID, testutil.Cols{
				"runtime_config":            testutil.Raw(`'{"local_directory_lock_enabled":true}'::jsonb`),
				"local_working_directories": testutil.Raw(`'{"directory-lock-claim-daemon":"D:\\repo"}'::jsonb`),
			})
			issueID := dbfx.Issue(t, "Directory lock claim issue")
			taskID := dbfx.Task(t, agentID, testutil.Cols{"runtime_id": runtimeID, "issue_id": issueID})
			req := withURLParam(newDaemonTokenRequest(http.MethodPost,
				"/api/daemon/runtimes/"+runtimeID+"/tasks/claim", nil, testWorkspaceID, daemonID), "runtimeId", runtimeID)
			status := http.StatusUnprocessableEntity
			if capable {
				req.Header.Set("X-Client-Capabilities", protocol.DaemonCapabilityDirectoryLockV1)
				status = http.StatusOK
			}
			result := testutil.Call(t, testHandler.ClaimTaskByRuntime, req).Want(status)
			if capable {
				var resp struct {
					Task *AgentTaskResponse `json:"task"`
				}
				result.JSON(&resp)
				if resp.Task == nil || resp.Task.ID != taskID || resp.Task.Agent == nil ||
					!protocol.AgentDirectoryLockEnabled(resp.Task.Agent.RuntimeConfig) {
					t.Fatalf("claim did not carry the enabled lock: %s", result.Body.String())
				}
			} else {
				var taskStatus, reason string
				dbfx.QueryRow(t, `SELECT status, error FROM agent_task_queue WHERE id=$1`, taskID).Scan(&taskStatus, &reason)
				if taskStatus != "cancelled" || !strings.Contains(reason, "directory lock is enabled") {
					t.Fatalf("unsupported daemon left task %s with status=%q reason=%q", taskID, taskStatus, reason)
				}
			}
		})
	}
}
