package backend

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func metadata(root string) Project {
	return Project{Name: "example", Path: root, SessionID: "ses_test", TitleMin: 3, TitleMax: 200, Capabilities: []string{"issue_revisions", "board_move"}}
}
func respond(w http.ResponseWriter, project Project) {
	_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "data": project})
}
func TestExplicitBackendCompatibilityAndOwnership(t *testing.T) {
	for _, tc := range []struct {
		name      string
		status    int
		caps      []string
		wantError string
	}{
		{"compatible", 200, []string{"issue_revisions", "board_move"}, ""},
		{"old", 404, nil, "lacks the client API"},
		{"missing revisions", 200, []string{"board_move"}, "lacks the client API"},
		{"protected", 401, nil, "TDB_TD_TOKEN"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Header.Get("Authorization") != "Bearer test-token" {
					t.Errorf("token missing")
				}
				w.WriteHeader(tc.status)
				p := metadata(t.TempDir())
				p.Capabilities = tc.caps
				respond(w, p)
			}))
			defer ts.Close()
			b, err := Connect(context.Background(), Options{APIURL: ts.URL, Token: "test-token", Interval: time.Second})
			if tc.wantError != "" {
				if err == nil || !strings.Contains(err.Error(), tc.wantError) {
					t.Fatalf("error=%v", err)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			b.Close()
			if b.Done() != nil {
				t.Fatal("borrowed server has process lifecycle")
			}
			req, _ := http.NewRequest("GET", ts.URL, nil)
			req.Header.Set("Authorization", "Bearer test-token")
			resp, err := http.DefaultClient.Do(req)
			if err != nil {
				t.Fatal("borrowed server stopped", err)
			}
			resp.Body.Close()
		})
	}
}
func TestRejectRemoteAndAmbiguousURLs(t *testing.T) {
	for _, s := range []string{"https://127.0.0.1:80", "http://example.com", "http://127.0.0.1/path", "http://user@localhost", "http://localhost?secret=x", "http://localhost#x", "ftp://localhost"} {
		if _, err := ValidateURL(s); err == nil {
			t.Errorf("accepted %s", s)
		}
	}
	for _, s := range []string{"http://127.0.0.1:80", "http://localhost:8080", "http://[::1]:8080"} {
		if _, err := ValidateURL(s); err != nil {
			t.Error(err)
		}
	}
}

func fakeTD(t *testing.T) (string, string) {
	t.Helper()
	root := t.TempDir()
	if err := os.Mkdir(filepath.Join(root, ".todos"), 0700); err != nil {
		t.Fatal(err)
	}
	exe, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	t.Setenv("TDB_TEST_EXECUTABLE", exe)
	t.Setenv("TDB_TEST_ROOT", root)
	t.Setenv("TDB_TEST_PROCESS", "1")
	script := filepath.Join(root, "fake-td")
	if err := os.WriteFile(script, []byte("#!/bin/sh\nexec \"$TDB_TEST_EXECUTABLE\" -test.run=TestTDProcess -- \"$@\"\n"), 0700); err != nil {
		t.Fatal(err)
	}
	return script, root
}
func TestOwnedBackendLifecycleAndDiscovery(t *testing.T) {
	td, root := fakeTD(t)
	// A stale file must not prevent startup. Port zero cannot refer to a server.
	_ = os.WriteFile(filepath.Join(root, ".todos", "serve-port"), []byte(`{"port":0,"pid":1}`), 0600)
	b, err := Connect(context.Background(), Options{TDPath: td, WorkDir: root, Interval: time.Second})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(b.Close)
	if b.Token == "" || b.Project.Path != root || b.Done() == nil {
		t.Fatalf("invalid owned backend: %+v", b)
	}
	reused, err := Connect(context.Background(), Options{TDPath: td, WorkDir: root, Token: b.Token, Interval: time.Second})
	if err != nil {
		t.Fatal(err)
	}
	if reused.Done() != nil || reused.URL.String() != b.URL.String() {
		t.Fatal("did not reuse project server")
	}
	reused.Close()
	if _, err := inspect(context.Background(), b.URL, b.Token); err != nil {
		t.Fatal("reuse killed owner", err)
	}
	b.Close()
	b.Close()
	if _, err := os.Stat(filepath.Join(root, ".todos", "serve-port")); !os.IsNotExist(err) {
		t.Fatalf("port file remains: %v", err)
	}
}
func TestRejectIncompatibleCLIAndFailedStartup(t *testing.T) {
	for _, mode := range []string{"old", "exit", "bad-capabilities"} {
		t.Run(mode, func(t *testing.T) {
			td, root := fakeTD(t)
			t.Setenv("TDB_TEST_MODE", mode)
			b, err := Connect(context.Background(), Options{TDPath: td, WorkDir: root, Interval: time.Second})
			if b != nil {
				b.Close()
			}
			if err == nil {
				t.Fatal("expected failure")
			}
			if _, err := os.Stat(filepath.Join(root, ".todos", "serve-port")); !os.IsNotExist(err) {
				t.Fatalf("port file remains after failed startup: %v", err)
			}
		})
	}
}
func TestDiscoveryRejectsWrongProject(t *testing.T) {
	td, root := fakeTD(t)
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { respond(w, metadata("/another/project")) }))
	defer ts.Close()
	port := ts.Listener.Addr().(*net.TCPAddr).Port
	data, _ := json.Marshal(portInfo{Port: port, PID: os.Getpid()})
	_ = os.WriteFile(filepath.Join(root, ".todos", "serve-port"), data, 0600)
	_, err := Connect(context.Background(), Options{TDPath: td, WorkDir: root, Interval: time.Second})
	if err == nil || !strings.Contains(err.Error(), "different project") {
		t.Fatalf("error=%v", err)
	}
}

// TestTDProcess is a fake td binary in a child process, not a database implementation.
func TestTDProcess(t *testing.T) {
	if os.Getenv("TDB_TEST_PROCESS") != "1" {
		return
	}
	var args []string
	for i, arg := range os.Args {
		if arg == "--" {
			args = os.Args[i+1:]
			break
		}
	}
	if len(args) < 3 {
		os.Exit(2)
	}
	root := os.Getenv("TDB_TEST_ROOT")
	mode := os.Getenv("TDB_TEST_MODE")
	if args[2] == "info" {
		if mode == "old" {
			fmt.Println(`{}`)
		} else {
			_ = json.NewEncoder(os.Stdout).Encode(map[string]string{"base_dir": root})
		}
		os.Exit(0)
	}
	if mode == "exit" {
		os.Exit(3)
	}
	var token string
	for i, arg := range args {
		if arg == "--token" {
			token = args[i+1]
		}
	}
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		os.Exit(4)
	}
	data, _ := json.Marshal(portInfo{Port: listener.Addr().(*net.TCPAddr).Port, PID: os.Getpid()})
	path := filepath.Join(root, ".todos", "serve-port")
	_ = os.WriteFile(path, data, 0600)
	server := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer "+token {
			w.WriteHeader(401)
			return
		}
		p := metadata(root)
		if mode == "bad-capabilities" {
			p.Capabilities = nil
		}
		respond(w, p)
	})}
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt)
	defer cancel()
	go server.Serve(listener)
	<-ctx.Done()
	_ = server.Close()
	_ = os.Remove(path)
	os.Exit(0)
}
