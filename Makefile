# make                    build every saver in savers/
# make install            build and install all into ~/Library/Screen Savers
# make install-<id>       one saver, e.g. make install-fishdraw
# make preview-<id>       open one saver in a window
# make uninstall          remove all of them
SAVERS  := $(notdir $(wildcard savers/*))
INSTALL := $(HOME)/Library/Screen Savers
name     = $(shell . savers/$(1)/saver.conf && echo $$NAME)

.PHONY: all install uninstall clean $(addprefix build-,$(SAVERS)) $(addprefix install-,$(SAVERS)) $(addprefix preview-,$(SAVERS))

all: $(addprefix build-,$(SAVERS))
install: $(addprefix install-,$(SAVERS))

$(addprefix build-,$(SAVERS)): build-%:
	@scripts/build-saver.sh savers/$*

$(addprefix install-,$(SAVERS)): install-%: build-%
	@n=$(call name,$*); rm -rf "$(INSTALL)/$$n.saver"; mkdir -p "$(INSTALL)"; cp -R "build/$$n.saver" "$(INSTALL)/"; echo "installed $$n.saver"
	@-killall legacyScreenSaver 2>/dev/null; true

$(addprefix preview-,$(SAVERS)): preview-%: build-%
	@scripts/build-saver.sh savers/$* preview
	@n=$(call name,$*); WEBSAVER_BUNDLE="$(CURDIR)/build/$$n.saver" ./build/preview-$$n

uninstall:
	@for s in $(SAVERS); do n=$$(. savers/$$s/saver.conf && echo $$NAME); rm -rf "$(INSTALL)/$$n.saver"; done
	@-killall legacyScreenSaver 2>/dev/null; true

clean:
	rm -rf build
