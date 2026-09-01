package handler

import (
	"net/http"
	"strings"
	"testing"

	"github.com/multica-ai/multica/server/internal/testutil"
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
