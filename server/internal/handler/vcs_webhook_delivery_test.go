package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

func TestExtractVCSWebhookMetadataGitLabPush(t *testing.T) {
	tests := []struct {
		name        string
		body        map[string]any
		checkoutSHA string
		commits     int32
	}{
		{
			name: "normal push",
			body: map[string]any{
				"object_kind": "push", "ref": "refs/heads/main",
				"before": "before-sha", "after": "after-sha", "checkout_sha": "after-sha",
				"total_commits_count": 2,
				"project":             map[string]any{"path_with_namespace": "team/project"},
			},
			checkoutSHA: "after-sha",
			commits:     2,
		},
		{
			name: "new branch",
			body: map[string]any{
				"object_kind": "push", "ref": "refs/heads/feature/new",
				"before": strings.Repeat("0", 40), "after": "new-sha", "checkout_sha": "new-sha",
				"commits": []map[string]any{{"id": "new-sha"}},
				"project": map[string]any{"path_with_namespace": "team/project"},
			},
			checkoutSHA: "new-sha",
			commits:     1,
		},
		{
			name: "deleted branch",
			body: map[string]any{
				"object_kind": "push", "ref": "refs/heads/old",
				"before": "old-sha", "after": strings.Repeat("0", 40), "checkout_sha": nil,
				"total_commits_count": 0,
				"project":             map[string]any{"path_with_namespace": "team/project"},
			},
			checkoutSHA: "",
			commits:     0,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			raw, err := json.Marshal(tt.body)
			if err != nil {
				t.Fatal(err)
			}
			headers := http.Header{}
			headers.Set("X-Gitlab-Event", "Push Hook")
			headers.Set("X-Gitlab-Event-UUID", "event-uuid")
			headers.Set("X-Gitlab-Webhook-UUID", "webhook-uuid")

			got := extractVCSWebhookMetadata("gitlab", headers, raw)
			if got.event != "Push Hook" || got.eventUUID != "event-uuid" || got.webhookUUID != "webhook-uuid" {
				t.Fatalf("headers not captured: %+v", got)
			}
			if got.projectPath != "team/project" || got.checkoutSHA != tt.checkoutSHA {
				t.Fatalf("push identity mismatch: %+v", got)
			}
			if !got.hasCommitCount || got.commitCount != tt.commits {
				t.Fatalf("commit count = %d valid=%v, want %d", got.commitCount, got.hasCommitCount, tt.commits)
			}
		})
	}
}

func TestVCSWebhook_GitLabPushDeliveryAudit(t *testing.T) {
	ctx := context.Background()
	box := withVCSBox(t)
	connID := seedVCSConnection(t, ctx, box, "gitlab", "https://gitlab-audit.test")
	t.Cleanup(func() { cleanupVCS(context.Background(), "") })

	raw := []byte(`{"object_kind":"push","ref":"refs/heads/main","before":"before-sha","after":"after-sha","checkout_sha":"after-sha","total_commits_count":2,"project":{"path_with_namespace":"team/project"},"commits":[{"message":"top-secret-commit-message"}]}`)
	headers := map[string]string{
		"X-Gitlab-Event":        "Push Hook",
		"X-Gitlab-Event-UUID":   "audit-event-uuid",
		"X-Gitlab-Webhook-UUID": "audit-webhook-uuid",
		"X-Gitlab-Token":        vcsTestSecret,
	}

	for range 2 {
		w := httptest.NewRecorder()
		testHandler.HandleVCSWebhook(w, vcsWebhookReq(connID, headers, raw))
		if w.Code != http.StatusAccepted {
			t.Fatalf("push status = %d body=%s", w.Code, w.Body.String())
		}
	}

	rows, err := testHandler.Queries.ListVCSWebhookDeliveries(ctx, db.ListVCSWebhookDeliveriesParams{
		WorkspaceID: parseUUID(testWorkspaceID), ConnectionID: parseUUID(connID), Limit: 20,
	})
	if err != nil {
		t.Fatalf("ListVCSWebhookDeliveries: %v", err)
	}
	if len(rows) != 1 {
		t.Fatalf("duplicate event UUID should create one audit row, got %d", len(rows))
	}
	got := rows[0]
	if got.Event != "Push Hook" || got.ProjectPath.String != "team/project" || got.Ref.String != "refs/heads/main" {
		t.Fatalf("delivery metadata = %+v", got)
	}
	if !got.CommitCount.Valid || got.CommitCount.Int32 != 2 || got.HandlerAction != "record_only" {
		t.Fatalf("delivery handling metadata = %+v", got)
	}

	w := httptest.NewRecorder()
	req := vcsHandlerRequest(http.MethodGet, "/api/workspaces/"+testWorkspaceID+"/vcs/connections/"+connID+"/deliveries", nil, connID)
	testHandler.ListVCSWebhookDeliveries(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("list status = %d body=%s", w.Code, w.Body.String())
	}
	responseBody := w.Body.String()
	for _, secret := range []string{vcsTestSecret, "top-secret-commit-message", "X-Gitlab-Token"} {
		if strings.Contains(responseBody, secret) {
			t.Fatalf("delivery response leaked sensitive input %q: %s", secret, responseBody)
		}
	}

	crossWorkspace := httptest.NewRecorder()
	crossReq := newRequest(http.MethodGet, "/api/workspaces/00000000-0000-0000-0000-000000000001/vcs/connections/"+connID+"/deliveries", nil)
	routeContext := chi.NewRouteContext()
	routeContext.URLParams.Add("id", "00000000-0000-0000-0000-000000000001")
	routeContext.URLParams.Add("connectionId", connID)
	crossReq = crossReq.WithContext(context.WithValue(crossReq.Context(), chi.RouteCtxKey, routeContext))
	testHandler.ListVCSWebhookDeliveries(crossWorkspace, crossReq)
	if crossWorkspace.Code != http.StatusNotFound {
		t.Fatalf("cross-workspace status = %d body=%s", crossWorkspace.Code, crossWorkspace.Body.String())
	}
}

func TestVCSWebhook_InvalidGitLabTokenDoesNotAudit(t *testing.T) {
	ctx := context.Background()
	box := withVCSBox(t)
	connID := seedVCSConnection(t, ctx, box, "gitlab", "https://gitlab-invalid-token.test")
	t.Cleanup(func() { cleanupVCS(context.Background(), "") })

	w := httptest.NewRecorder()
	testHandler.HandleVCSWebhook(w, vcsWebhookReq(connID, map[string]string{
		"X-Gitlab-Event":      "Push Hook",
		"X-Gitlab-Event-UUID": "invalid-token-event",
		"X-Gitlab-Token":      "wrong-secret",
	}, []byte(`{"object_kind":"push"}`)))
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d body=%s", w.Code, w.Body.String())
	}

	rows, err := testHandler.Queries.ListVCSWebhookDeliveries(ctx, db.ListVCSWebhookDeliveriesParams{
		WorkspaceID: parseUUID(testWorkspaceID), ConnectionID: parseUUID(connID), Limit: 20,
	})
	if err != nil {
		t.Fatalf("ListVCSWebhookDeliveries: %v", err)
	}
	if len(rows) != 0 {
		t.Fatalf("invalid token created %d audit rows", len(rows))
	}
}
