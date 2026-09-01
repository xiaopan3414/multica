ALTER TABLE agent
    ADD COLUMN local_working_directories JSONB NOT NULL DEFAULT '{}';

COMMENT ON COLUMN agent.local_working_directories IS
    'Private daemon_id -> absolute local path mappings. Exposed only through the dedicated agent working-directory API and daemon claim payload.';
