CREATE INDEX CONCURRENTLY chat_folder_owner_position_idx ON chat_folder (workspace_id, creator_id, position, id);
