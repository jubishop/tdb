// tdb opens a local browser workspace backed by td serve.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"runtime"
	"syscall"
	"time"

	"github.com/jubishop/tdb/internal/backend"
	"github.com/jubishop/tdb/internal/web"
)

var version = "dev"

func main() {
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	if err := run(ctx, os.Args[1:], os.Stdout, os.Stderr); err != nil {
		fmt.Fprintln(os.Stderr, "tdb:", err)
		os.Exit(1)
	}
}

func run(ctx context.Context, args []string, stdout, stderr io.Writer) error {
	flags := flag.NewFlagSet("tdb", flag.ContinueOnError)
	flags.SetOutput(stderr)
	workdir := flags.String("work-dir", ".", "Project directory (td resolves worktrees and .td-root)")
	flags.StringVar(workdir, "w", ".", "Project directory")
	port := flags.Int("port", 0, "Browser port (0 = auto-assign)")
	flags.IntVar(port, "p", 0, "Browser port")
	noOpen := flags.Bool("no-open", false, "Print the URL without opening the browser")
	interval := flags.Duration("interval", 2*time.Second, "Live update poll interval for a new td server")
	tdPath := flags.String("td", "td", "Path to the td executable")
	apiURL := flags.String("api-url", "", "Connect to an existing local td serve URL")
	showVersion := flags.Bool("version", false, "Print version")
	flags.Usage = func() {
		fmt.Fprintln(stderr, "Usage: tdb [options]\n\nOpen the current td project in a local browser workspace.")
		flags.PrintDefaults()
	}
	if err := flags.Parse(args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return nil
		}
		return err
	}
	if flags.NArg() != 0 {
		return fmt.Errorf("unexpected arguments: %v", flags.Args())
	}
	if *showVersion {
		fmt.Fprintln(stdout, "tdb", version)
		return nil
	}
	if *port < 0 || *port > 65535 {
		return fmt.Errorf("port must be between 0 and 65535")
	}
	if *interval <= 0 {
		return fmt.Errorf("interval must be greater than zero")
	}
	b, err := backend.Connect(ctx, backend.Options{TDPath: *tdPath, WorkDir: *workdir, APIURL: *apiURL, Token: os.Getenv("TDB_TD_TOKEN"), Interval: *interval, Output: stderr})
	if err != nil {
		return err
	}
	defer b.Close()
	listener, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", *port))
	if err != nil {
		return err
	}
	defer listener.Close()
	server := &http.Server{Handler: web.Handler(b), ReadHeaderTimeout: 10 * time.Second, IdleTimeout: 120 * time.Second}
	done := make(chan error, 1)
	go func() { done <- server.Serve(listener) }()
	address := "http://" + listener.Addr().String()
	fmt.Fprintln(stdout, address)
	fmt.Fprintf(stderr, "tdb · %s\n  project: %s\n  td API:  %s\n  Press Ctrl+C to stop.\n", b.Project.Name, b.Project.Path, b.URL)
	if !*noOpen {
		go func() {
			if err := openBrowser(address); err != nil {
				fmt.Fprintf(stderr, "Could not open browser: %v. Open %s manually.\n", err, address)
			}
		}()
	}
	var result error
	select {
	case <-ctx.Done():
	case <-b.Done():
		result = fmt.Errorf("td serve exited; restart tdb to reconnect")
	case err := <-done:
		if !errors.Is(err, http.ErrServerClosed) {
			result = err
		}
	}
	// Cancel streaming responses before graceful shutdown so SSE cannot hold it open.
	_ = server.Close()
	return result
}

func openBrowser(address string) error {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		cmd = exec.Command("open", address)
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", address)
	default:
		cmd = exec.Command("xdg-open", address)
	}
	return cmd.Run()
}
