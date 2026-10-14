package protocol

import "encoding/json"

// AgentDirectoryLockEnabled reads the explicit opt-in from agent runtime config.
func AgentDirectoryLockEnabled(raw []byte) bool {
	var config struct {
		Enabled bool `json:"local_directory_lock_enabled"`
	}
	return json.Unmarshal(raw, &config) == nil && config.Enabled
}
