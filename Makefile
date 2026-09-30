SHELL := /bin/sh
PREFIX ?= $(HOME)/.local
.PHONY: build install test check check-go
build: check-go
	GOWORK=off go build -o dist/tdb .
install: build
	install -d "$(PREFIX)/bin"
	install -m 755 dist/tdb "$(PREFIX)/bin/tdb"
test: check-go
	GOWORK=off go test -race . ./internal/...
check:
	bin/check --full
check-go:
	@version="$$(GOWORK=off go env GOVERSION)" || exit $$?; \
	case "$$version" in \
		go1.27.[0-9]*) ;; \
		*) echo "Go 1.27.x is required; detected $$version. Select a Go 1.27 toolchain." >&2; exit 1 ;; \
	esac
