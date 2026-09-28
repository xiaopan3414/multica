package handler

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/multica-ai/multica/server/internal/integrations/vcs"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

const vcsWebhookDeliveryLimit int32 = 20

// VCSWebhookDeliveryResponse contains only metadata needed to confirm delivery.
// Request bodies and authentication headers are deliberately never persisted.
type VCSWebhookDeliveryResponse struct {
	ID            string  `json:"id"`
	Provider      string  `json:"provider"`
	Event         string  `json:"event"`
	EventUUID     *string `json:"event_uuid"`
	WebhookUUID   *string `json:"webhook_uuid"`
	ProjectPath   *string `json:"project_path"`
	Ref           *string `json:"ref"`
	BeforeSHA     *string `json:"before_sha"`
	AfterSHA      *string `json:"after_sha"`
	CheckoutSHA   *string `json:"checkout_sha"`
	CommitCount   *int32  `json:"commit_count"`
	HandlerAction string  `json:"handler_action"`
	ReceivedAt    string  `json:"received_at"`
}

type vcsWebhookMetadata struct {
	event          string
	eventUUID      string
	webhookUUID    string
	projectPath    string
	ref            string
	beforeSHA      string
	afterSHA       string
	checkoutSHA    string
	commitCount    int32
	hasCommitCount bool
}

type vcsWebhookMetadataPayload struct {
	ObjectKind string `json:"object_kind"`
	Project    struct {
		PathWithNamespace string `json:"path_with_namespace"`
	} `json:"project"`
	Repository struct {
		FullName string `json:"full_name"`
	} `json:"repository"`
	Ref               string            `json:"ref"`
	Before            string            `json:"before"`
	After             string            `json:"after"`
	CheckoutSHA       string            `json:"checkout_sha"`
	TotalCommitsCount *int32            `json:"total_commits_count"`
	Commits           []json.RawMessage `json:"commits"`
}

func vcsWebhookAction(kind vcs.EventKind) string {
	switch kind {
	case vcs.EventPullRequest:
		return "mirror_pull_request"
	case vcs.EventCIStatus:
		return "mirror_ci_status"
	default:
		return "record_only"
	}
}

func extractVCSWebhookMetadata(provider string, headers http.Header, body []byte) vcsWebhookMetadata {
	metadata := vcsWebhookMetadata{}
	switch provider {
	case string(vcs.KindGitLab):
		metadata.event = headers.Get("X-Gitlab-Event")
		metadata.eventUUID = headers.Get("X-Gitlab-Event-UUID")
		metadata.webhookUUID = headers.Get("X-Gitlab-Webhook-UUID")
	case string(vcs.KindForgejo):
		metadata.event = headers.Get("X-Forgejo-Event")
		metadata.eventUUID = headers.Get("X-Forgejo-Delivery")
	case string(vcs.KindGitea):
		metadata.event = headers.Get("X-Gitea-Event")
		metadata.eventUUID = headers.Get("X-Gitea-Delivery")
	}

	var payload vcsWebhookMetadataPayload
	if json.Unmarshal(body, &payload) == nil {
		if metadata.event == "" {
			metadata.event = payload.ObjectKind
		}
		metadata.projectPath = payload.Project.PathWithNamespace
		if metadata.projectPath == "" {
			metadata.projectPath = payload.Repository.FullName
		}
		metadata.ref = payload.Ref
		metadata.beforeSHA = payload.Before
		metadata.afterSHA = payload.After
		metadata.checkoutSHA = payload.CheckoutSHA
		if payload.TotalCommitsCount != nil {
			metadata.commitCount = *payload.TotalCommitsCount
			metadata.hasCommitCount = true
		} else if payload.Commits != nil {
			metadata.commitCount = int32(len(payload.Commits))
			metadata.hasCommitCount = true
		}
	}
	if metadata.event == "" {
		metadata.event = "unknown"
	}
	return metadata
}

func nullableText(value string) pgtype.Text {
	return pgtype.Text{String: value, Valid: value != ""}
}

func (h *Handler) recordVCSWebhookDelivery(
	ctx context.Context,
	conn db.VcsConnection,
	headers http.Header,
	body []byte,
	kind vcs.EventKind,
) error {
	metadata := extractVCSWebhookMetadata(conn.Provider, headers, body)
	commitCount := pgtype.Int4{}
	if metadata.hasCommitCount {
		commitCount = pgtype.Int4{Int32: metadata.commitCount, Valid: true}
	}
	return h.Queries.RecordVCSWebhookDelivery(ctx, db.RecordVCSWebhookDeliveryParams{
		WorkspaceID:   conn.WorkspaceID,
		ConnectionID:  conn.ID,
		Provider:      conn.Provider,
		Event:         metadata.event,
		EventUuid:     nullableText(metadata.eventUUID),
		WebhookUuid:   nullableText(metadata.webhookUUID),
		ProjectPath:   nullableText(metadata.projectPath),
		Ref:           nullableText(metadata.ref),
		BeforeSha:     nullableText(metadata.beforeSHA),
		AfterSha:      nullableText(metadata.afterSHA),
		CheckoutSha:   nullableText(metadata.checkoutSHA),
		CommitCount:   commitCount,
		HandlerAction: vcsWebhookAction(kind),
	})
}

func vcsWebhookDeliveryToResponse(row db.VcsWebhookDelivery) VCSWebhookDeliveryResponse {
	return VCSWebhookDeliveryResponse{
		ID:            uuidToString(row.ID),
		Provider:      row.Provider,
		Event:         row.Event,
		EventUUID:     textToPtr(row.EventUuid),
		WebhookUUID:   textToPtr(row.WebhookUuid),
		ProjectPath:   textToPtr(row.ProjectPath),
		Ref:           textToPtr(row.Ref),
		BeforeSHA:     textToPtr(row.BeforeSha),
		AfterSHA:      textToPtr(row.AfterSha),
		CheckoutSHA:   textToPtr(row.CheckoutSha),
		CommitCount:   int4ToPtr(row.CommitCount),
		HandlerAction: row.HandlerAction,
		ReceivedAt:    timestampToString(row.ReceivedAt),
	}
}

// ListVCSWebhookDeliveries returns the newest authenticated deliveries for a
// connection. Membership is enforced by the route middleware; the explicit
// workspace match below prevents cross-workspace connection ID probing.
func (h *Handler) ListVCSWebhookDeliveries(w http.ResponseWriter, r *http.Request) {
	if !h.isVCSAvailable() {
		writeError(w, http.StatusNotFound, "unknown connection")
		return
	}
	workspaceID, ok := parseUUIDOrBadRequest(w, chi.URLParam(r, "id"), "workspace id")
	if !ok {
		return
	}
	connectionID, ok := parseUUIDOrBadRequest(w, chi.URLParam(r, "connectionId"), "connection id")
	if !ok {
		return
	}
	conn, err := h.Queries.GetVCSConnectionByID(r.Context(), connectionID)
	if err != nil || conn.WorkspaceID != workspaceID {
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			writeError(w, http.StatusInternalServerError, "failed to load connection")
			return
		}
		writeError(w, http.StatusNotFound, "unknown connection")
		return
	}
	rows, err := h.Queries.ListVCSWebhookDeliveries(r.Context(), db.ListVCSWebhookDeliveriesParams{
		WorkspaceID:  workspaceID,
		ConnectionID: connectionID,
		Limit:        vcsWebhookDeliveryLimit,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list webhook deliveries")
		return
	}
	deliveries := make([]VCSWebhookDeliveryResponse, 0, len(rows))
	for _, row := range rows {
		deliveries = append(deliveries, vcsWebhookDeliveryToResponse(row))
	}
	writeJSON(w, http.StatusOK, map[string]any{"deliveries": deliveries})
}
