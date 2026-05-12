.PHONY: test-all test-stub test-aidbox test-medplum

RESULTS := .results

test-all:
	$(MAKE) -j3 -k test-stub test-aidbox test-medplum

test-stub:
	@mkdir -p $(RESULTS)
	bun bin/run.ts -impl impl/stub/index.ts -out $(RESULTS)/stub.json

test-aidbox:
	@mkdir -p $(RESULTS)
	bun bin/run.ts -impl impl/aidbox/index.ts -out $(RESULTS)/aidbox.json

test-medplum:
	@mkdir -p $(RESULTS)
	bun bin/run.ts -impl impl/medplum/index.ts -out $(RESULTS)/medplum.json
