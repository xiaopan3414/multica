package protocol

import "testing"

func TestAgentDirectoryLockEnabled(t *testing.T) {
	for _, tc := range []struct {
		raw  string
		want bool
	}{
		{"", false},
		{"{}", false},
		{"null", false},
		{`{"local_directory_lock_enabled":false}`, false},
		{`{"local_directory_lock_enabled":true}`, true},
		{`{"local_directory_lock_enabled":"true"}`, false},
		{`{"local_directory_lock_enabled":1}`, false},
		{`{"local_directory_lock_enabled":true`, false},
	} {
		if got := AgentDirectoryLockEnabled([]byte(tc.raw)); got != tc.want {
			t.Errorf("AgentDirectoryLockEnabled(%q) = %v, want %v", tc.raw, got, tc.want)
		}
	}
}
