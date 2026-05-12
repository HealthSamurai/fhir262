.PHONY: test-stub

test-stub:
	bun bin/run.ts -impl impl/stub/index.ts
