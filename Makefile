.PHONY: test-stub test-aidbox

test-stub:
	bun bin/run.ts -impl impl/stub/index.ts

test-aidbox:
	bun bin/run.ts -impl impl/aidbox/index.ts
