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
	minor="$${version#go1.}"; minor="$${minor%%[!0-9]*}"; \
	case "$$version" in \
		go1.[0-9]*) [ "$$minor" -ge 27 ] && exit 0 ;; \
	esac; \
	echo "Go 1.27 or newer is required; detected $$version. Select the latest stable Go toolchain." >&2; exit 1
