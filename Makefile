# sequoia/tahoe
OS_VERSION ?= tahoe

tart-clone-base:
	tart clone ghcr.io/cirruslabs/macos-$(OS_VERSION)-base:latest $(OS_VERSION)-base

tart-clone:
	tart clone $(OS_VERSION)-base test-vm

tart-run:
	tart run test-vm --dir=shared:./target/release/bundle/macos

tart-delete:
	tart delete test-vm

scp:
	scp -r ./target/debug/bundle/macos/nixmac.app admin@$$(tart ip test-vm):/tmp/nixmac.app

build:
	cd ./apps/native && bunx tauri build --bundles app

build-dev:
	cd ./apps/native && bunx tauri build --bundles app --debug --config src-tauri/tauri.conf.dev.json
