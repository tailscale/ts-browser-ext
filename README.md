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
| Chrome  | Windows | Registry install work not yet done |
| Firefox  | * | not yet, but started |
| Safari  | * | not possible; no support for Native Messaging |

## Developer instructions

* use Chrome (for now)
* Extensions...
* Manage Extensions...
* [X] Developer Mode
* Load Unpacked...
* navigate to directory where you cloned this repo...
* install
* pin the extension
* click it
* follow instructions to `go install` the backend part
* click again, "Log in"

To log out, for now you need to remove & re-add the extension.

## End user instructions

Don't use it yet. It's too rough. See status above.


