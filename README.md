# Tailscale Browser Extension (Experiment)

[![status: experimental](https://img.shields.io/badge/status-experimental-blue)](https://tailscale.com/kb/1167/release-stages/#experimental)

The [Tailscale](https://tailscale.com/) Browser Extension lets you access your tailnet resources
using a browser extension, without necessarily installing Tailscale
system-wide.

In particular, ...

* you can **simultaneously use a different tailnet per browser profile**
  * separate out your personal tailnet in its own browser profile
* you don't need to be root/admin to install it
* it doesn't interfere with your other OS VPN(s) and route tables and is purely scoped to one browser profile

## How it works

Ideally it would work purely with WASM/WASI, but browser extensions
don't have enough APIs, so it regrettably has to use Native Messaging
([Chrome](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging),
[Firefox](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Native_messaging))
where a native binary (using
[`tsnet`](https://tailscale.com/kb/1244/tsnet)) runs as a child
process under the browser and communicates with the browser extension
with JSON messages back and forth.

The child process then runs an HTTP/SOCKS5 proxy on `localhost:0`
(with the kernel picking a random free port) and the browser extension
uses the browser proxy API to send all web traffic through the child's
proxy, which then sends it out over Tailscale, an exit node, or the
Internet as normal.

## Status

As of 2025-02-25, this is **barely just starting to work** and is not
meant for end users yet. It's barely meant for developers at this
point.

| Browser    | OS | Status |
| -------- | ------- | ---- |
| Chrome  | macOS | Works |
| Chrome  | Linux | Works in theory, untested |
| Chrome  | Windows | Works |
| Firefox  | macOS | Mostly works |
| Firefox  | Linux | Mostly works in theory, untested |
| Firefox  | Windows | Mostly works in theory, untested |
| Safari  | * | not possible; no support for Native Messaging |

## Developer instructions

To log out, for now you need to remove & re-add the extension.

### Chrome

1. Open the Extensions page (`chrome://extensions`) or Extensions... > Manage Extensions...
2. Toggle "Developer mode" on.
3. Click "Load unpacked".
4. Navigate to the directory where you cloned this repo and select it.
5. Pin the extension to the toolbar.
6. Click the extension icon.
7. Follow the instructions in the popup to run the printed `go run ...` command, which builds and registers the native messaging backend.
8. Click the extension icon again and select "Log in".

### Firefox

1. Open the Debugging page (`about:debugging#/runtime/this-firefox`).
2. Click "Load Temporary Add-on...".
3. Navigate to the `firefox/` subdirectory of this repo and select its `manifest.json`.
4. Open the Add-ons Manager (`about:addons`), select the Tailscale extension, and under "Run in Private Windows" choose "Allow" if you want it to be active in private browsing.
5. Pin the extension to the toolbar.
6. Click the extension icon.
7. Follow the instructions in the popup to run the printed `go run ...` command, which builds and registers the native messaging backend.
8. Click the extension icon again and select "Log in".

Temporary add-ons in Firefox are removed when the browser restarts, so you'll need to reload it from `about:debugging` each session.

## End user instructions

Don't use it yet. It's too rough. See status above.
