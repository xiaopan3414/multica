-- name: CreateChatFolder :one
INSERT INTO chat_folder (workspace_id, creator_id, name, position)
VALUES (
    $1,
    $2,
    $3,
    COALESCE((
        SELECT MAX(position) + 1
        FROM chat_folder
        WHERE workspace_id = $1 AND creator_id = $2
    ), 0)
)
RETURNING *;

-- name: ListChatFoldersByCreator :many
SELECT *
FROM chat_folder
WHERE workspace_id = $1 AND creator_id = $2
ORDER BY position, id;

-- name: GetChatFolderForCreator :one
SELECT *
FROM chat_folder
WHERE id = $1 AND workspace_id = $2 AND creator_id = $3
FOR UPDATE;

-- name: UpdateChatFolderName :one
UPDATE chat_folder
SET name = $4, updated_at = now()
WHERE id = $1 AND workspace_id = $2 AND creator_id = $3
RETURNING *;

-- name: UpdateChatFolderPosition :execrows
UPDATE chat_folder
SET position = $4, updated_at = now()
WHERE id = $1 AND workspace_id = $2 AND creator_id = $3;

-- name: ClearChatSessionFolderByFolder :exec
UPDATE chat_session
SET folder_id = NULL
WHERE folder_id = $1 AND workspace_id = $2 AND creator_id = $3;

-- name: DeleteChatFolder :execrows
DELETE FROM chat_folder
WHERE id = $1 AND workspace_id = $2 AND creator_id = $3;

-- name: UpdateChatSessionFolder :one
UPDATE chat_session
SET folder_id = sqlc.narg('folder_id')
WHERE id = sqlc.arg('id')
  AND workspace_id = sqlc.arg('workspace_id')
  AND creator_id = sqlc.arg('creator_id')
RETURNING *;

-- name: ClearChatSessionFoldersByCreator :exec
UPDATE chat_session
SET folder_id = NULL
WHERE workspace_id = $1 AND creator_id = $2 AND folder_id IS NOT NULL;

-- name: DeleteChatFoldersByCreator :exec
DELETE FROM chat_folder
WHERE workspace_id = $1 AND creator_id = $2;

-- name: DeleteChatFoldersByWorkspace :exec
DELETE FROM chat_folder
WHERE workspace_id = $1;
