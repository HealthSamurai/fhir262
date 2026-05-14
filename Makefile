.PHONY: fresh clean test-all test-all-tmux test-aidbox test-hapi test-medplum test-msfhir ui-dist ui-serve clean-dist format format-check


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

TMUX_SESSION := fhir262-tests

# Same impls as test-all, but each run gets its own tmux pane so output
# streams live side-by-side. When a run finishes, its pane drops into an
# interactive shell so the output stays visible — exit the shell to close
# the pane; the session closes when the last pane exits.
test-all-tmux:
	$(MAKE) clean
	@command -v tmux >/dev/null || { echo "tmux is required for test-all-tmux"; exit 1; }
	@mkdir -p $(RESULTS)
	@tmux kill-session -t $(TMUX_SESSION) 2>/dev/null || true
	@tmux new-session -d -s $(TMUX_SESSION) "$(MAKE) test-aidbox; exec $$SHELL"
	@tmux split-window -t $(TMUX_SESSION) "$(MAKE) test-hapi; exec $$SHELL"
	@tmux split-window -t $(TMUX_SESSION) "$(MAKE) test-medplum; exec $$SHELL"
	@tmux split-window -t $(TMUX_SESSION) "$(MAKE) test-msfhir; exec $$SHELL"
	@tmux select-layout -t $(TMUX_SESSION) tiled
	@tmux attach -t $(TMUX_SESSION)

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

format:
	bunx biome format --write .

format-check:
	bunx biome format .
