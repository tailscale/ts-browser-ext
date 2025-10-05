// Persistent storage for exit node domains (wildcards supported)
function getExitNodeDomains() {
  return JSON.parse(localStorage.getItem("exitNodeDomains") || "[]");
}

function setExitNodeDomains(domains) {
  localStorage.setItem("exitNodeDomains", JSON.stringify(domains));
}

// Wildcard matcher function
function domainMatches(url, patterns) {
  try {
    const u = new URL(url);
    const hostname = u.hostname;
    for (const pattern of patterns) {
      // Remove whitespace
      const p = pattern.trim();
      if (!p) continue;
      // "*" matches anything
      if (p === "*") return true;
      // If starts with "*.", match suffix
      if (p.startsWith("*.")) {
        if (hostname.endsWith(p.slice(1))) return true;
      }
      // If starts/ends with "*", match substring
      else if (p.startsWith("*") && p.endsWith("*") && p.length > 2) {
        if (hostname.includes(p.slice(1, -1))) return true;
      }
      // If starts with "*"
      else if (p.startsWith("*")) {
        if (hostname.endsWith(p.slice(1))) return true;
      }
      // If ends with "*"
      else if (p.endsWith("*")) {
        if (hostname.startsWith(p.slice(0, -1))) return true;
      }
      // Exact match
      else if (hostname === p) return true;
    }
    return false;
  } catch {
    return false;
  }
}

let proxyEnabled = false;
let nativePort = null;
let popupPorts = [];
let proxyPort = null;

// Generate a unique ID for this browser profile
function generateOrGetProfileID() {
  const key = "tailscale_profile_id";
  let id = localStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 15);
    localStorage.setItem(key, id);
  }
  return id;
}

// Connect to native messaging host
function connectToNative() {
  try {
    nativePort = browser.runtime.connectNative("com.tailscale.browserext.firefox");
    nativePort.onMessage.addListener(handleNativeMessage);
    nativePort.onDisconnect.addListener(() => {
      nativePort = null;
      proxyPort = null;
      proxyEnabled = false;
      notifyPopups({ error: "Native messaging host disconnected" });
    });
    nativePort.postMessage({ cmd: "init", initID: generateOrGetProfileID() });
  } catch (e) {
    notifyPopups({ 
      error: "Failed to connect to native host. Please run: ts-browser-ext --install=F",
      installCmd: "ts-browser-ext --install=F"
    });
  }
}

// Handle messages from native host
function handleNativeMessage(message) {
  if (message.procRunning) {
    proxyPort = message.procRunning.port;
    setupProxy();
    getStatus();
  }
  if (message.status) {
    notifyPopups({ status: message.status, exitNodeDomains: getExitNodeDomains() });
  }
  if (message.init && message.init.error) {
    notifyPopups({ error: "Initialization failed: " + message.init.error });
  }
}

// Send status update to all connected popups
function notifyPopups(message) {
  popupPorts.forEach(port => {
    try {
      port.postMessage(message);
    } catch (e) {}
  });
}

// Get current status from native host
function getStatus() {
  if (nativePort) {
    nativePort.postMessage({ cmd: "get-status" });
  }
}

// Toggle proxy state
function toggleProxy() {
  if (!nativePort) {
    connectToNative();
    return { error: "Connecting to native host..." };
  }
  proxyEnabled = !proxyEnabled;
  nativePort.postMessage({ cmd: proxyEnabled ? "up" : "down" });
  return { status: proxyEnabled ? "Connecting..." : "Disconnected" };
}

// Handle proxy settings
function setupProxy() {
  if (!proxyPort) return;
  browser.proxy.onRequest.addListener(handleProxyRequest, { urls: ["<all_urls>"] });
}

// Handle proxy requests
function handleProxyRequest(requestInfo) {
  if (!proxyEnabled || !proxyPort) {
    return { type: "direct" };
  }
  if (requestInfo.url.includes("100.100.100.100")) {
    return { type: "http", host: "127.0.0.1", port: proxyPort };
  }
  const patterns = getExitNodeDomains();
  if (domainMatches(requestInfo.url, patterns)) {
    return { type: "socks", host: "127.0.0.1", port: proxyPort };
  }
  return { type: "direct" };
}

// Listen for connections from popup
browser.runtime.onConnect.addListener(port => {
  if (port.name === "popup") {
    popupPorts.push(port);
    port.onDisconnect.addListener(() => {
      popupPorts = popupPorts.filter(p => p !== port);
    });
    if (!nativePort) {
      connectToNative();
    } else {
      getStatus();
    }
  }
});

// Handle messages from popup
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.command === "toggleProxy") {
    return Promise.resolve(toggleProxy());
  }
  if (message.command === "setExitNode") {
    if (!nativePort) return Promise.resolve({ error: "Not connected to native host" });
    nativePort.postMessage({ cmd: "set-exit-node", exitNodeID: message.exitNodeID });
    setTimeout(getStatus, 500);
    return Promise.resolve({ status: "Setting exit node..." });
  }
  if (message.command === "clearExitNode") {
    if (!nativePort) return Promise.resolve({ error: "Not connected to native host" });
    nativePort.postMessage({ cmd: "clear-exit-node" });
    setTimeout(getStatus, 500);
    return Promise.resolve({ status: "Clearing exit node..." });
  }
  if (message.command === "getExitNodeDomains") {
    return Promise.resolve({ domains: getExitNodeDomains() });
  }
  if (message.command === "setExitNodeDomains") {
    setExitNodeDomains(message.domains || []);
    getStatus();
    return Promise.resolve({ success: true });
  }
  return Promise.resolve({ error: "Unknown command" });
});

connectToNative();