### Convenience targets for manual testing flow (run from repo root with `make -C docs/testscripts` or from this directory)
.PHONY: manual-show manual-env manual-summarize manual-diff manual-commit manual-help

MANUAL_SCRIPT=./manual-test.sh

manual-show:
	bash $(MANUAL_SCRIPT) show-state --out /tmp/nixmac_state.md

manual-env:
	bash $(MANUAL_SCRIPT) env-check

manual-summarize:
	bash $(MANUAL_SCRIPT) summarize

manual-diff:
	bash $(MANUAL_SCRIPT) diff

manual-commit:
	# Perform commit (use with care)
	bash $(MANUAL_SCRIPT) --yes commit

manual-help:
	bash $(MANUAL_SCRIPT) help
