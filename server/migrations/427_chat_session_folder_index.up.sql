CREATE INDEX CONCURRENTLY chat_session_folder_idx ON chat_session (folder_id) WHERE folder_id IS NOT NULL;
