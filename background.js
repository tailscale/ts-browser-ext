let proxyEnabled = false;

// setPopupIcon sets the icon. It takes either a boolean (for online/offline)
// or the base name of the png file.
function setPopupIcon(base) {
  if (typeof base === "boolean") {
    base = base ? "online" : "offline";
  }
  let iconPath = base + ".png";
  console.log("set icon path to: " + iconPath);

  chrome.action.setIcon({ path: iconPath }, () => {
    if (chrome.runtime.lastError) {
      console.error(
        "Error setting icon to " + iconPath + ":",
        chrome.runtime.lastError.message
      );
    }
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

chrome.runtime.onConnect.addListener((port) => {
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
  if (typeof chrome !== "undefined") {
    if (typeof browser !== "undefined") {
      return "F"; // Firefox supports both `chrome` and `browser`
    }
    return "C";
  }
  return "?";
}

function sendPopupStatus() {
  if (deadPort) {
    setPopupIcon("need-install");
    console.log("sendPopupStatus... no nmPort");
    sendToPopup({
      installCmd:
        "go run github.com/tailscale/ts-browser-ext@main --install=" +
        browserByte() +
        chrome.runtime.id,
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
  nmPort = chrome.runtime.connectNative("com.tailscale.browserext.chrome");

  nmPort.onDisconnect.addListener(() => {
    deadPort = true;
    setPopupIcon("need-install");
    disableProxy();
    const error = chrome.runtime.lastError;
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
  if (proxyPort) {
    proxyEnabled = true;
    lastProxyPort = proxyPort;
    console.log("Enabling proxy at port: " + proxyPort);
  } else {
    proxyEnabled = false;
    console.log("Disabling proxy...");
    chrome.proxy.settings.set(
      {
        value: {
          mode: "direct",
        },
        scope: "regular",
      },
      () => {
        console.log("Proxy disabled.");
      }
    );
    return;
  }
  chrome.proxy.settings.set(
    {
      value: {
        mode: "fixed_servers",
        rules: {
          singleProxy: {
            scheme: "http",
            host: "127.0.0.1",
            port: proxyPort,
          },
          bypassList: ["<local>"],
        },
      },
      scope: "regular",
    },
    () => {
      console.log("Proxy enabled: 127.0.0.1:" + proxyPort);
    }
  );
}

var profileID = "";
var didInit = false;

function maybeSendInit() {
  if (!profileID || didInit || deadPort) {
    return;
  }
  nmPort.postMessage({ cmd: "init", initID: profileID });
  didInit = true;
}

chrome.storage.local.get("profileId", (result) => {
  if (!result.profileId) {
    const profileId = crypto.randomUUID();
    chrome.storage.local.set({ profileId }, () => {
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
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("bg: Received message:", message);
  if (message.command === "toggleProxy") {
    console.log("bg: toggleProxy received, current proxy=" + proxyEnabled);
    proxyEnabled = !proxyEnabled;
    if (proxyEnabled) {
      console.log("bg: Enabling proxy");
      enableProxy();
      console.log("bg: toggleProxy on, now proxy=" + proxyEnabled);
      sendResponse({ status: lastStatus });
      console.log("bg: toggleProxy on, sent status response");
    } else {
      console.log("bg: Disabling proxy");
      disableProxy();
      console.log("bg: toggleProxy off, now proxy=" + proxyEnabled);
      sendResponse({ status: "Disconnected" });
      console.log("bg: toggleProxy off, sent disconnected response");
    }
    setPopupIcon(proxyEnabled);
    return true; // Keep the message channel open for the async response
  }
});
