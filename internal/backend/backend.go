// Package backend manages a local td serve process through its public CLI and API.
package backend

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"sync"
	"time"
)

type Project struct {
	Name         string   `json:"name"`
	Path         string   `json:"path"`
	SessionID    string   `json:"session_id"`
	TitleMin     int      `json:"title_min_length"`
	TitleMax     int      `json:"title_max_length"`
	Capabilities []string `json:"capabilities"`
}

type Options struct {
	TDPath   string
	WorkDir  string
	APIURL   string
	Token    string
	Interval time.Duration
	Output   io.Writer
}

type Backend struct {
	URL     *url.URL
	Token   string
	Project Project
	cmd     *exec.Cmd
	done    chan struct{}
	waitErr error
	stop    sync.Once
}

func ValidateURL(raw string) (*url.URL, error) {
	u, err := url.Parse(raw)
	if err != nil {
		return nil, fmt.Errorf("invalid td API URL: %w", err)
	}
	ip := net.ParseIP(u.Hostname())
	if u.Scheme != "http" || u.Host == "" || u.User != nil || u.RawQuery != "" || u.ForceQuery || u.Fragment != "" || (u.Path != "" && u.Path != "/") || (u.Hostname() != "localhost" && (ip == nil || !ip.IsLoopback())) {
		return nil, fmt.Errorf("td API URL must be a loopback HTTP address, such as http://127.0.0.1:8080")
	}
	u.Path = ""
	return u, nil
}

// Connect resolves the project using td, then reuses or starts its API server.
func Connect(ctx context.Context, opts Options) (*Backend, error) {
	if opts.Output == nil {
		opts.Output = io.Discard
	}
	if opts.TDPath == "" {
		opts.TDPath = "td"
	}
	if opts.Interval <= 0 {
		return nil, fmt.Errorf("interval must be greater than zero")
	}
	if opts.APIURL != "" {
		u, err := ValidateURL(opts.APIURL)
		if err != nil {
			return nil, err
		}
		project, err := inspect(ctx, u, opts.Token)
		if err != nil {
			return nil, err
		}
		return &Backend{URL: u, Token: opts.Token, Project: project}, nil
	}
	resolveCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	out, err := exec.CommandContext(resolveCtx, opts.TDPath, "-w", opts.WorkDir, "info", "--json").Output()
	if err != nil {
		return nil, fmt.Errorf("resolve project using td: %w (install td and run td init in your project)", err)
	}
	var info struct {
		BaseDir string `json:"base_dir"`
	}
	if err := json.Unmarshal(out, &info); err != nil {
		return nil, fmt.Errorf("decode td info: %w", err)
	}
	if info.BaseDir == "" {
		return nil, compatibilityError()
	}
	root, err := filepath.Abs(info.BaseDir)
	if err != nil {
		return nil, err
	}
	portPath := filepath.Join(root, ".todos", "serve-port")
	if port, err := readPort(portPath); err == nil {
		u, _ := ValidateURL(fmt.Sprintf("http://127.0.0.1:%d", port.Port))
		project, err := inspect(ctx, u, opts.Token)
		if err == nil {
			if !samePath(project.Path, root) {
				return nil, fmt.Errorf("td server on port %d belongs to a different project", port.Port)
			}
			return &Backend{URL: u, Token: opts.Token, Project: project}, nil
		}
		// A responding server owns this port even if its API is incompatible or protected.
		if _, networkError := err.(*url.Error); !networkError {
			return nil, err
		}
	}
	token := opts.Token
	if token == "" {
		secret := make([]byte, 32)
		if _, err := rand.Read(secret); err != nil {
			return nil, err
		}
		token = hex.EncodeToString(secret)
	}
	cmd := exec.Command(opts.TDPath, "-w", opts.WorkDir, "serve", "--addr", "127.0.0.1", "--port", "0", "--token", token, "--interval", opts.Interval.String())
	cmd.Stdout, cmd.Stderr = opts.Output, opts.Output
	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("start td serve: %w", err)
	}
	b := &Backend{Token: token, cmd: cmd, done: make(chan struct{})}
	go func() { b.waitErr = cmd.Wait(); close(b.done) }()
	timeout := time.NewTimer(10 * time.Second)
	defer timeout.Stop()
	ticker := time.NewTicker(25 * time.Millisecond)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			b.Close()
			return nil, ctx.Err()
		case <-b.done:
			return nil, fmt.Errorf("td serve stopped before it was ready: %v", b.waitErr)
		case <-timeout.C:
			b.Close()
			return nil, fmt.Errorf("td serve did not become ready within 10 seconds")
		case <-ticker.C:
			port, err := readPort(portPath)
			if err != nil || port.PID != cmd.Process.Pid {
				continue
			}
			u, _ := ValidateURL(fmt.Sprintf("http://127.0.0.1:%d", port.Port))
			project, err := inspect(ctx, u, token)
			if err != nil {
				if _, networkError := err.(*url.Error); networkError {
					continue
				}
				b.Close()
				return nil, err
			}
			if !samePath(project.Path, root) {
				b.Close()
				return nil, fmt.Errorf("td serve returned an unexpected project path")
			}
			b.URL, b.Project = u, project
			return b, nil
		}
	}
}

func compatibilityError() error {
	return fmt.Errorf("this td build lacks the client API required by tdb; install td v0.66.0 or later from https://github.com/marcus/td (see tdb README)")
}

func inspect(ctx context.Context, u *url.URL, token string) (Project, error) {
	var project Project
	req, err := http.NewRequestWithContext(ctx, "GET", u.String()+"/v1/project", nil)
	if err != nil {
		return project, err
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	client := &http.Client{Timeout: 2 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	resp, err := client.Do(req)
	if err != nil {
		return project, err
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusUnauthorized {
		return project, fmt.Errorf("td serve requires authentication; set TDB_TD_TOKEN to its bearer token")
	}
	if resp.StatusCode != http.StatusOK {
		return project, compatibilityError()
	}
	var envelope struct {
		OK   bool    `json:"ok"`
		Data Project `json:"data"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&envelope); err != nil {
		return project, fmt.Errorf("invalid td project response: %w", err)
	}
	project = envelope.Data
	if !envelope.OK || project.Path == "" || project.SessionID == "" || !slices.Contains(project.Capabilities, "issue_revisions") || !slices.Contains(project.Capabilities, "board_move") {
		return project, compatibilityError()
	}
	return project, nil
}

type portInfo struct {
	Port int `json:"port"`
	PID  int `json:"pid"`
}

func readPort(path string) (portInfo, error) {
	var info portInfo
	data, err := os.ReadFile(path)
	if err != nil {
		return info, err
	}
	if err := json.Unmarshal(data, &info); err != nil {
		return info, err
	}
	if info.Port < 1 || info.Port > 65535 || info.PID < 1 {
		return info, fmt.Errorf("invalid td port file")
	}
	return info, nil
}
func samePath(a, b string) bool {
	canonical := func(s string) string {
		if p, err := filepath.EvalSymlinks(s); err == nil {
			s = p
		}
		p, err := filepath.Abs(s)
		if err == nil {
			s = p
		}
		return filepath.Clean(s)
	}
	return canonical(a) == canonical(b)
}

// Done closes when an owned td process exits. It is nil for borrowed servers.
func (b *Backend) Done() <-chan struct{} { return b.done }

// Close stops only the process started by this Backend. Reused servers stay running.
func (b *Backend) Close() {
	b.stop.Do(func() {
		if b.cmd == nil {
			return
		}
		select {
		case <-b.done:
			return
		default:
		}
		_ = b.cmd.Process.Signal(os.Interrupt)
		select {
		case <-b.done:
		case <-time.After(3 * time.Second):
			_ = b.cmd.Process.Kill()
			<-b.done
		}
	})
}
