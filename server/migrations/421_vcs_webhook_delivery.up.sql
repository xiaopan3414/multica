CREATE TABLE vcs_webhook_delivery (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL,
    connection_id uuid NOT NULL,
    provider text NOT NULL,
    event text NOT NULL,
    event_uuid text,
    webhook_uuid text,
    project_path text,
    ref text,
    before_sha text,
    after_sha text,
    checkout_sha text,
    commit_count integer,
    handler_action text NOT NULL,
    received_at timestamptz NOT NULL DEFAULT now()
);
