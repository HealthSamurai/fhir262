.PHONY: test-all test-aidbox test-medplum ui-dist ui-serve clean-dist

RESULTS := .results
DIST    := dist

test-all:
	$(MAKE) -j2 -k test-aidbox test-medplum

test-aidbox:
	@mkdir -p $(RESULTS)
	bun bin/run.ts -impl impl/aidbox/index.ts -out $(RESULTS)/aidbox.json

test-medplum:
	@mkdir -p $(RESULTS)
	bun bin/run.ts -impl impl/medplum/index.ts -out $(RESULTS)/medplum.json

# Assemble the UI + a merged run JSON from .results/ into dist/. Pre-existing
# runs under dist/runs/ are preserved (this is how CI keeps history across
# deploys — restore the previous dist/runs/ first, then run this target).
ui-dist:
	bun bin/build.ts -results $(RESULTS) -dist $(DIST)

ui-serve: ui-dist
	@echo "Serving $(DIST) on http://localhost:8000"
	@python3 -m http.server -d $(DIST) 8000

clean-dist:
	rm -rf $(DIST)
