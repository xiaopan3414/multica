package main

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func updateServerFixture(t *testing.T) (http.Handler, string) {
	t.Helper()
	root := t.TempDir()
	feed := filepath.Join(root, "windows", "x64")
	if err := os.MkdirAll(feed, 0o755); err != nil {
		t.Fatalf("create feed: %v", err)
	}
	if err := os.WriteFile(filepath.Join(feed, "latest.yml"), []byte("version: 1.0.0\n"), 0o644); err != nil {
		t.Fatalf("write metadata: %v", err)
	}
	if err := os.WriteFile(filepath.Join(feed, "multica.exe"), []byte("installer"), 0o644); err != nil {
		t.Fatalf("write installer: %v", err)
	}
	return newUpdateHandler(root, "test-version"), root
}

func TestHealth(t *testing.T) {
	handler, _ := updateServerFixture(t)
	req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", w.Code, http.StatusOK)
	}
	if !strings.Contains(w.Body.String(), `"version":"test-version"`) {
		t.Fatalf("body = %q, want service version", w.Body.String())
	}
	if got := w.Header().Get("Cache-Control"); got != "no-store" {
		t.Fatalf("Cache-Control = %q, want no-store", got)
	}
}

func TestLatestMetadataIsNeverCached(t *testing.T) {
	handler, _ := updateServerFixture(t)
	req := httptest.NewRequest(http.MethodGet, "/windows/x64/latest.yml", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", w.Code, http.StatusOK)
	}
	if got := w.Header().Get("Cache-Control"); !strings.Contains(got, "no-store") {
		t.Fatalf("Cache-Control = %q, want no-store", got)
	}
	if got := w.Header().Get("Content-Type"); !strings.HasPrefix(got, "text/yaml") {
		t.Fatalf("Content-Type = %q, want text/yaml", got)
	}
}

func TestInstallerSupportsRangeRequests(t *testing.T) {
	handler, _ := updateServerFixture(t)
	req := httptest.NewRequest(http.MethodGet, "/windows/x64/multica.exe", nil)
	req.Header.Set("Range", "bytes=0-3")
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusPartialContent {
		t.Fatalf("status = %d, want %d", w.Code, http.StatusPartialContent)
	}
	if w.Body.String() != "inst" {
		t.Fatalf("body = %q, want %q", w.Body.String(), "inst")
	}
	if got := w.Header().Get("Cache-Control"); !strings.Contains(got, "immutable") {
		t.Fatalf("Cache-Control = %q, want immutable", got)
	}
}

func TestDirectoriesAndWritesAreRejected(t *testing.T) {
	handler, _ := updateServerFixture(t)

	for _, test := range []struct {
		method string
		path   string
		want   int
	}{
		{method: http.MethodGet, path: "/windows/x64/", want: http.StatusNotFound},
		{method: http.MethodPost, path: "/windows/x64/latest.yml", want: http.StatusMethodNotAllowed},
	} {
		t.Run(test.method+test.path, func(t *testing.T) {
			req := httptest.NewRequest(test.method, test.path, nil)
			w := httptest.NewRecorder()
			handler.ServeHTTP(w, req)
			if w.Code != test.want {
				t.Fatalf("status = %d, want %d", w.Code, test.want)
			}
		})
	}
}
