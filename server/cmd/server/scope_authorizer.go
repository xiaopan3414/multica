package main

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/multica-ai/multica/server/internal/realtime"
	"github.com/multica-ai/multica/server/internal/util"
	db "github.com/multica-ai/multica/server/pkg/db/generated"
)

// scopeAuthQuerier is the narrow subset of db.Queries used by the scope
// authorizer. Declared as an interface so the authorizer can be unit tested
// with an in-memory fake (no DB required).
type scopeAuthQuerier interface {
	GetAgent(ctx context.Context, id pgtype.UUID) (db.Agent, error)
	GetAgentTask(ctx context.Context, id pgtype.UUID) (db.AgentTaskQueue, error)
	GetIssue(ctx context.Context, id pgtype.UUID) (db.Issue, error)
	GetChatSession(ctx context.Context, id pgtype.UUID) (db.ChatSession, error)
}

// dbScopeAuthorizer implements realtime.ScopeAuthorizer for the per-task and
// per-chat scopes (workspace/user scopes are validated by the hub itself
// against the connection identity). It returns true only when the requested
// resource exists, belongs to the caller's workspace, and — for chat
// resources — the caller is either the session creator or target agent owner
// (mirroring the HTTP participant access model).
type dbScopeAuthorizer struct{ q scopeAuthQuerier }

func newScopeAuthorizer(q scopeAuthQuerier) *dbScopeAuthorizer { return &dbScopeAuthorizer{q: q} }

// scopeLookupErr converts a scope-resource query error into an authorizer
// result. A missing resource (pgx.ErrNoRows) is a legitimate denial — the
// HTTP layer treats not-found as 404 rather than 403, so the realtime layer
// reports it as a plain "forbidden" refusal. Any other error (pool
// exhaustion, a cancelled context, a network blip) is a transient lookup
// failure and must propagate so handleSubscribe reports "lookup_failed"
// instead of masking a database outage as a wave of permission denials.
func scopeLookupErr(err error) (bool, error) {
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	return false, err
}

func (a *dbScopeAuthorizer) authorizeChatParticipant(ctx context.Context, sess db.ChatSession, userID string) (bool, error) {
	uidUUID, err := util.ParseUUID(userID)
	if err != nil {
		return false, nil
	}
	if sess.CreatorID == uidUUID {
		return true, nil
	}
	agent, err := a.q.GetAgent(ctx, sess.AgentID)
	if err != nil {
		return scopeLookupErr(err)
	}
	if agent.WorkspaceID != sess.WorkspaceID {
		return false, nil
	}
	return agent.OwnerID.Valid && agent.OwnerID == uidUUID, nil
}

func (a *dbScopeAuthorizer) AuthorizeScope(ctx context.Context, userID, workspaceID, scopeType, scopeID string) (bool, error) {
	if workspaceID == "" || scopeID == "" {
		return false, nil
	}
	wsUUID, err := util.ParseUUID(workspaceID)
	if err != nil {
		return false, nil
	}
	idUUID, err := util.ParseUUID(scopeID)
	if err != nil {
		return false, nil
	}
	switch scopeType {
	case realtime.ScopeTask:
		task, err := a.q.GetAgentTask(ctx, idUUID)
		if err != nil {
			return scopeLookupErr(err)
		}
		// Issue tasks: visible to any workspace member.
		if task.IssueID.Valid {
			issue, err := a.q.GetIssue(ctx, task.IssueID)
			if err != nil {
				return scopeLookupErr(err)
			}
			return issue.WorkspaceID == wsUUID, nil
		}
		// Chat tasks: the session creator and target agent owner may subscribe,
		// mirroring the HTTP participant access model.
		if task.ChatSessionID.Valid {
			sess, err := a.q.GetChatSession(ctx, task.ChatSessionID)
			if err != nil {
				return scopeLookupErr(err)
			}
			if sess.WorkspaceID != wsUUID {
				return false, nil
			}
			return a.authorizeChatParticipant(ctx, sess, userID)
		}
		return false, nil
	case realtime.ScopeChat:
		sess, err := a.q.GetChatSession(ctx, idUUID)
		if err != nil {
			return scopeLookupErr(err)
		}
		if sess.WorkspaceID != wsUUID {
			return false, nil
		}
		// The realtime layer matches the HTTP participant boundary so the
		// creator and target agent owner can follow the same conversation while
		// unrelated workspace peers remain unable to subscribe by session id.
		return a.authorizeChatParticipant(ctx, sess, userID)
	default:
		return false, nil
	}
}
