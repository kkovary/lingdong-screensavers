# Hermit

- Upstream: https://github.com/LingDong-/Hermit
- Commit: 356384ba4e20df248c93c8000f84ce9ace16b726 (2020-12-16, "Update description")
- License: MIT

## Pyodide runtime

- Version: 0.27.5 (fetched by `../fetch-pyodide.sh`, not committed)
- Packages: pygame-ce 2.4.1, numpy 2.0.2

## Python 2 -> 3 port changes (hermit/ directory)

All source files are derived from upstream `src/` with the following changes:

### All files
- `import pygame; pygame.init()` at module level removed from library files
  (initialization moved to main entry point to work under Pyodide).

### main.py (was src/main.py)
- Rewritten for screensaver use: async main loop, no keyboard input, autopilot
  AI walks right continuously with occasional mount/drink actions.
- `thread` module replaced with synchronous terrain generation.
- `import pygame._view` removed (not in pygame-ce).
- Integer division: `width/2` -> `width//2`, etc.
- `print` statements -> `print()`.
- `except Exception, e:` -> `except Exception as e:`.
- Console/HUD/keyboard code removed (screensaver has no input).
- Loading screen removed (terrain loads synchronously).
- Icon generation removed.

### lib/filter.py
- `import utilities as u` -> `import lib.utilities as u` (package-relative).
- `import noise` -> `import lib.noise as noise`.
- `print` statement removed.
- Module-level `pygame.init()` removed.

### lib/font.py
- Same import fixes.
- Module-level `pygame.init()` removed.

### lib/creature.py
- Same import fixes.
- `import projectile` -> `import lib.projectile as projectile`.
- `import tree` -> `import lib.tree as tree`.
- Module-level `pygame.init()` removed.

### lib/pattern.py, lib/particle.py, lib/projectile.py
- Same import fixes.
- Module-level `pygame.init()` removed.

### lib/utilities.py
- Module-level `pygame.init()` and font initialization deferred.
- `print` statement in tree.py test removed.

### lib/tree.py
- Module-level `pygame.init()` removed.
- `print` in test block removed.

### lib/noise.py, lib/parse.py, lib/settings.py
- No changes (pure Python, no pygame imports at module level).
