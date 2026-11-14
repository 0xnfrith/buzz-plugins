# Third-party notices

This plugin is Apache-2.0 like the repository it is in. Its build bundles one dependency, ghostty-web, and carries the notice below at the top of `plugin.js`. This file says what is known about what the bundle contains, and what has **not** been checked.

## In the bundle

### ghostty-web 0.4.0 (JavaScript and `ghostty-vt.wasm`)

MIT. Read from the `LICENSE` in the package itself, which `pnpm install --frozen-lockfile` has checked by the tarball's integrity hash, and which the build reads and refuses to go on without:

```
MIT License

Copyright (c) 2025 Coder

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

The package has no runtime dependencies. The build removes one unused string from its JavaScript (a second, unused copy of its WASM); nothing else of it is changed.

### Ghostty, inside `ghostty-vt.wasm`

The package's README says the WASM is built from Ghostty's source with a patch. Ghostty is MIT, Copyright (c) 2024 Mitchell Hashimoto, Ghostty contributors, under the same permission notice as above. **This line was read from the `LICENSE` of the Ghostty repository, not from inside the WASM**, which holds no copyright or licence text (searched: none).

## Not in the bundle

- `@xterm/xterm` 6.0.0: MIT, Copyright (c) 2017-2019 The xterm.js authors, 2014-2016 SourceLair Private Company, 2012-2013 Christopher Jeffrey. Used only by `test/bench`, to compare speed. Not shipped.
- vite, typescript, vitest, `@types/node` and their dependencies: build and test tools, not shipped.

## Not yet checked

These must be settled before any change that ships this plugin to people:

- **What else is compiled into `ghostty-vt.wasm`.** It is 423,045 bytes of compiled code. It is likely to link more than Ghostty's own source (code compiled from Zig's standard library and runtime, for instance, and whatever the Ghostty build vendors); which components, and under what licences, has not been read. None of them leaves a notice in the binary (searched: none). The build recipe is in the ghostty-web repository (`scripts/build-wasm.sh`, a patch, Zig and Bun), and it has not been read or run here. The list of every linked component and its licence goes here, and in the banner of `plugin.js`, first.
- The claim above that ghostty-web's WASM is Ghostty's, rests on the package's README and on the WASM exporting `ghostty_*` functions. It was not rebuilt.
- Nothing is copied from any earlier prototype of this plugin: the bridge and the plugin were written afresh. The design (a PTY helper in python, base64 lines) is the obvious one for a plugin that gets pipes and not a PTY.
