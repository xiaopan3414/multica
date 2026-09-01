-- name: SetAgentWorkingDirectory :one
UPDATE agent
SET local_working_directories = jsonb_set(
        local_working_directories,
        ARRAY[sqlc.arg('daemon_id')::text],
        to_jsonb(sqlc.arg('local_path')::text),
        true
    ),
    updated_at = now()
WHERE id = sqlc.arg('agent_id')
RETURNING *;

-- name: DeleteAgentWorkingDirectory :one
UPDATE agent
SET local_working_directories = local_working_directories - sqlc.arg('daemon_id')::text,
    updated_at = now()
WHERE id = sqlc.arg('agent_id')
RETURNING *;
