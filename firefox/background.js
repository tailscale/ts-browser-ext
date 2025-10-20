let proxyEnabled = false;

// setPopupIcon sets the icon. It takes either a boolean (for online/offline)
// or the base name of the png file.
function setPopupIcon(base) {
  if (typeof base === "boolean") {
    base = base ? "online" : "offline";
  }
  let iconPath = base + ".png";
  console.log("set icon path to: " + iconPath);

  browser.action.setIcon({ path: iconPath }).catch((error) => {
    console.error("Error setting icon to " + iconPath + ":", error.message);
  });
}

function enableProxy() {
  if (deadPort) {
    console.error("Cannot enable proxy, disconnected from native host");
    return;
  }

  if (lastProxyPort) {
    nmPort.postMessage({ cmd: "get-status" });
  } else {
    nmPort.postMessage({ cmd: "up" });
  }
}

function disableProxy() {
  console.log("disableProxy called");
  if (nmPort && !deadPort) {
    console.log("Sending down command to native host");
    nmPort.postMessage({ cmd: "down" });
  } else {
    console.log(
      "Cannot send down command - nmPort:",
      !!nmPort,
      "deadPort:",
      deadPort
    );
  }
  proxyEnabled = false;
  lastProxyPort = 0;
  console.log(
    "Proxy disabled, proxyEnabled:",
    proxyEnabled,
    "lastProxyPort:",
    lastProxyPort
  );
}

console.log("starting ts-browser-ext");

let popupPort = null;

browser.runtime.onConnect.addListener((port) => {
  if (port.name != "popup") {
    return;
  }
  popupPort = port;

  console.log("Popup connected");

  port.onMessage.addListener((msg) => {
    console.log("Message from popup:", msg);
  });

  port.onDisconnect.addListener(() => {
    console.log("Popup disconnected");
    popupPort = null;
  });

  sendPopupStatus();
});

// browserByte returns either "F" for Firefox or "C" for chrome.
// Other browsers return "?".
function browserByte() {
  if (typeof browser !== "undefined") {
    return "F";
  }
  return "?";
}

function sendPopupStatus() {
  // firefox requires that extensions settings proxies have private browsing access
  browser.extension.isAllowedIncognitoAccess().then(isAllowed => {
    if (!isAllowed) {
          sendToPopup({
        needsIncognitoPermission: true
      });
    }
  });

  if (deadPort) {
    setPopupIcon("need-install");
    console.log("sendPopupStatus... no nmPort");
    sendToPopup({
      installCmd:
        "go run github.com/tailscale/ts-browser-ext@main --install=" +
        browserByte() +
        browser.runtime.id,
    });
    return;
  }
  setPopupIcon(proxyEnabled ? "online" : "offline");

  sendToPopup({ status: lastStatus });
}

function sendToPopup(v) {
  if (popupPort) {
    popupPort.postMessage(v);
  }
}

let nmPort = null; // even non-null if lacking permission
let deadPort = true;
let portError = null;

connectToNativeHost();

function connectToNativeHost() {
  if (nmPort && !deadPort) {
    return;
  }
  console.log("Connecting to native messaging host...");
  nmPort = browser.runtime.connectNative("com.tailscale.browserext.firefox");

  nmPort.onDisconnect.addListener(() => {
    deadPort = true;
    setPopupIcon("need-install");
    disableProxy();
    const error = browser.runtime.lastError;
    if (error) {
      console.error("Connection failed:", error.message);
      portError = error.message;
      setTimeout(connectToNativeHost, 1000);
    } else {
      console.error("Disconnected from native host");
    }
  });
  nmPort.onMessage.addListener((message) => {
    console.log("got message: " + JSON.stringify(message));
    if (deadPort) {
      console.log("connected to native backend");
      deadPort = false;
    }
    if (message.procRunning) {
      if (message.procRunning.port) {
        setProxy(message.procRunning.port);
      } else if (message.procRunning.errror) {
        console.log(
          "procRunning error from backend: " + message.procRunning.err
        );
        disableProxy();
      }
    }
    if (message.init && message.init.error) {
      console.log("init error from backend: " + message.init.err);
      disableProxy();
    }
    if (message.status) {
      lastStatus = message.status;
    }
    maybeSendInit();
    sendPopupStatus();
  });
}

var lastProxyPort = 0;
var lastStatus = {}; // last Go status

function setProxy(proxyPort) {
  const handleProxyRequest = proxyHandler(proxyPort)
  if (proxyPort) {
    proxyEnabled = true;
    lastProxyPort = proxyPort;
    console.log("Enabling proxy at port: " + proxyPort);
  } else {
    proxyEnabled = false;
    console.log("Disabling proxy...");
    browser.proxy.onRequest.removeListener(handleProxyRequest)
    browser.proxy.settings
      .set({
        value: {
          mode: "direct",
        },
        scope: "regular",
      })
      .then(() => {
        console.log("Proxy disabled.");
      });
    return;
  }
  browser.proxy.onRequest.addListener(handleProxyRequest, { urls: ["<all_urls>"] })
}

var profileID = "";
var didInit = false;

// firefox has unique behaviour where only socks proxies can handle domain resolution
function proxyHandler(port) {
  return function handleProxyRequest(requestInfo) {
    const url = new URL(requestInfo.url)

    // we need to use http for 100.100.100.100
    if (url.hostname == '100.100.100.100') {
      return { type: "http", host: "127.0.0.1", port: port };
    }

    // use socks for everything else
    return { type: "socks", host: "127.0.0.1", port: port, proxyDNS: true, bypassList: ["localhost", "127.*"] };
  }
}

function maybeSendInit() {
  if (!profileID || didInit || deadPort) {
    return;
  }
  nmPort.postMessage({ cmd: "init", initID: profileID });
  didInit = true;
}

browser.storage.local.get("profileId").then((result) => {
  if (!result.profileId) {
    const profileId = crypto.randomUUID();
    browser.storage.local.set({ profileId }).then(() => {
      console.log("Generated profile ID:", profileId);
      profileID = profileId;
      maybeSendInit();
    });
  } else {
    console.log("Profile ID already exists:", result.profileId);
    profileID = result.profileId;
    maybeSendInit();
  }
});

// Listener for messages from the popup
browser.runtime.onMessage.addListener((message, sender) => {
  console.log("bg: Received message:", message);
  if (message.command === "toggleProxy") {
    console.log("bg: toggleProxy received, current proxy=" + proxyEnabled);
    proxyEnabled = !proxyEnabled;
    if (proxyEnabled) {
      console.log("bg: Enabling proxy");
      enableProxy();
    } else {
      console.log("bg: Disabling proxy");
      disableProxy();
    }
    return Promise.resolve({ status: lastStatus });
  }
});
