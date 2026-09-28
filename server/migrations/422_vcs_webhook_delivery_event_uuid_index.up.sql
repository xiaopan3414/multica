CREATE UNIQUE INDEX CONCURRENTLY vcs_webhook_delivery_connection_event_uuid_idx ON vcs_webhook_delivery (connection_id, event_uuid) WHERE event_uuid IS NOT NULL AND event_uuid <> '';
