NAME     := ShanShui
BUNDLE   := build/$(NAME).saver
CONTENTS := $(BUNDLE)/Contents
INSTALL  := $(HOME)/Library/Screen\ Savers
SWIFTC   := swiftc -swift-version 5 -O -target arm64-apple-macos14.0
FRAMEWORKS := -framework ScreenSaver -framework WebKit -framework AppKit

.PHONY: build install preview uninstall clean

build: $(CONTENTS)/MacOS/$(NAME)

$(CONTENTS)/MacOS/$(NAME): Sources/ShanShuiView.swift Info.plist Resources/*
	rm -rf $(BUNDLE)
	mkdir -p $(CONTENTS)/MacOS $(CONTENTS)/Resources
	$(SWIFTC) -emit-library -module-name $(NAME) $(FRAMEWORKS) \
	    -Xlinker -install_name -Xlinker @executable_path/../MacOS/$(NAME) \
	    -o $@ Sources/ShanShuiView.swift
	cp Info.plist $(CONTENTS)/Info.plist
	cp Resources/index.html Resources/saver.js Resources/VENDOR.md $(CONTENTS)/Resources/
	codesign --force --sign - $(BUNDLE)

install: build
	rm -rf $(INSTALL)/$(NAME).saver
	mkdir -p $(INSTALL)
	cp -R $(BUNDLE) $(INSTALL)/
	-killall legacyScreenSaver 2>/dev/null
	-killall "System Settings" 2>/dev/null
	@echo "Installed. Open System Settings > Wallpaper > Screen Saver and pick Shan Shui."

uninstall:
	rm -rf $(INSTALL)/$(NAME).saver
	-killall legacyScreenSaver 2>/dev/null

build/preview: Sources/ShanShuiView.swift Sources/main.swift
	mkdir -p build
	$(SWIFTC) $(FRAMEWORKS) -o $@ Sources/ShanShuiView.swift Sources/main.swift

preview: build/preview
	SHAN_SHUI_RESOURCES=$(CURDIR)/Resources ./build/preview

clean:
	rm -rf build
