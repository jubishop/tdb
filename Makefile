SHELL := /bin/sh
PREFIX ?= $(HOME)/.local
.PHONY: build install test check
build:
	GOWORK=off go build -o dist/tdb .
install: build
	install -d "$(PREFIX)/bin"
	install -m 755 dist/tdb "$(PREFIX)/bin/tdb"
test:
	GOWORK=off go test -race . ./internal/...
check:
	bin/check --full
