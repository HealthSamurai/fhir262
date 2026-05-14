.PHONY: fresh clean test-all test-aidbox test-hapi test-medplum test-msfhir ui-dist ui-serve clean-dist


clean:
	rm -rf $(RESULTS) $(DIST)

fresh:
	$(MAKE) clean
	$(MAKE) test-all
	$(MAKE) ui-dist

RESULTS := .results
DIST    := dist

test-all:
	$(MAKE) -j4 -k test-aidbox test-hapi test-medplum test-msfhir

test-aidbox:
	@mkdir -p $(RESULTS)
	bun bin/run.ts -impl impl/aidbox/index.ts -out $(RESULTS)/aidbox.json

test-hapi:
	@mkdir -p $(RESULTS)
	bun bin/run.ts -impl impl/hapi/index.ts -out $(RESULTS)/hapi.json

test-medplum:
	@mkdir -p $(RESULTS)
	bun bin/run.ts -impl impl/medplum/index.ts -out $(RESULTS)/medplum.json

test-msfhir:
	@mkdir -p $(RESULTS)
	bun bin/run.ts -impl impl/msfhir/index.ts -out $(RESULTS)/msfhir.json

ui-dist:
	bun bin/build.ts -results $(RESULTS) -dist $(DIST)

ui-serve: ui-dist
	@echo "Serving $(DIST) on http://localhost:8000"
	@python3 -m http.server -d $(DIST) 8000

clean-dist:
	rm -rf $(DIST)
