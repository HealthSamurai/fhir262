.PHONY: test-all test-stub test-aidbox test-medplum

RESULTS := .results

test-all:
	$(MAKE) -j2 -k test-aidbox test-medplum

test-aidbox:
	@mkdir -p $(RESULTS)
	bun bin/run.ts -impl impl/aidbox/index.ts -out $(RESULTS)/aidbox.json

test-medplum:
	@mkdir -p $(RESULTS)
	bun bin/run.ts -impl impl/medplum/index.ts -out $(RESULTS)/medplum.json
