tart-clone-base:
	tart clone ghcr.io/cirruslabs/macos-tahoe-base:latest tahoe-base

tart-clone:
	tart clone tahoe-base test-vm

tart-run:
	tart run test-vm --dir=shared:./target/release/bundle/macos

tart-delete:
	tart delete test-vm

scp:
	scp -r ./target/release/bundle/macos/nixmac.app admin@$$(tart ip test-vm):/tmp/nixmac.app

build:
	cd ./apps/native && bunx tauri build --bundles app
