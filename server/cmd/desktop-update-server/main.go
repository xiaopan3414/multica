package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"log"
	"mime"
	"net/http"
	"os"
	"os/signal"
	"path"
	"path/filepath"
	"strings"
	"syscall"
	"time"
)

var version = "dev"

func main() {
	listen := flag.String("listen", "0.0.0.0:8090", "HTTP listen address")
	root := flag.String("root", "./releases", "release file root")
	flag.Parse()

	rootPath, err := filepath.Abs(*root)
	if err != nil {
		log.Fatalf("resolve release root: %v", err)
	}
	info, err := os.Stat(rootPath)
	if err != nil || !info.IsDir() {
		log.Fatalf("release root is not a directory: %s", rootPath)
	}

	server := &http.Server{
		Addr:              *listen,
		Handler:           requestLogger(newUpdateHandler(rootPath, version)),
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	errCh := make(chan error, 1)
	go func() {
		log.Printf("Multica Desktop update service %s listening on %s (root %s)", version, *listen, rootPath)
		errCh <- server.ListenAndServe()
	}()

	select {
	case <-ctx.Done():
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := server.Shutdown(shutdownCtx); err != nil {
			log.Fatalf("shutdown update service: %v", err)
		}
	case err := <-errCh:
		if !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("serve updates: %v", err)
		}
	}
}

func requestLogger(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		started := time.Now()
		next.ServeHTTP(w, r)
		log.Printf("%s %s %s", r.Method, r.URL.Path, time.Since(started).Round(time.Millisecond))
	})
}

func newUpdateHandler(root, serviceVersion string) http.Handler {
	rootPath, err := filepath.Abs(root)
	if err != nil {
		panic(err)
	}

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		if r.URL.Path == "/healthz" {
			if r.Method != http.MethodGet && r.Method != http.MethodHead {
				w.Header().Set("Allow", "GET, HEAD")
				http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
				return
			}
			w.Header().Set("Cache-Control", "no-store")
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
			if r.Method == http.MethodHead {
				w.WriteHeader(http.StatusOK)
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]string{
				"status":  "ok",
				"version": serviceVersion,
			})
			return
		}

		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			w.Header().Set("Allow", "GET, HEAD")
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		filePath, ok := releaseFilePath(rootPath, r.URL.Path)
		if !ok {
			http.NotFound(w, r)
			return
		}
		file, err := os.Open(filePath)
		if err != nil {
			http.NotFound(w, r)
			return
		}
		defer file.Close()

		info, err := file.Stat()
		if err != nil || !info.Mode().IsRegular() {
			http.NotFound(w, r)
			return
		}

		name := strings.ToLower(info.Name())
		if strings.HasPrefix(name, "latest") && strings.HasSuffix(name, ".yml") {
			w.Header().Set("Cache-Control", "no-store, no-cache, must-revalidate")
			w.Header().Set("Content-Type", "text/yaml; charset=utf-8")
		} else {
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
			if contentType := mime.TypeByExtension(filepath.Ext(name)); contentType != "" {
				w.Header().Set("Content-Type", contentType)
			}
		}

		http.ServeContent(w, r, info.Name(), info.ModTime(), file)
	})
}

func releaseFilePath(root, requestPath string) (string, bool) {
	cleaned := path.Clean("/" + strings.TrimSpace(requestPath))
	relative := strings.TrimPrefix(cleaned, "/")
	if relative == "" || relative == "." {
		return "", false
	}

	filePath := filepath.Join(root, filepath.FromSlash(relative))
	rel, err := filepath.Rel(root, filePath)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return "", false
	}
	return filePath, true
}
