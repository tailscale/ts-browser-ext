var lastStatus;

function browseToURL() {
  if (lastStatus && lastStatus.browseToURL) {
    chrome.tabs.create({ url: lastStatus.browseToURL });
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const toggleSlider = document.getElementById("toggleSlider");
  const slider = document.querySelector(".slider");
  const settingsButton = document.getElementById("settingsButton");
  const stateDisplay = document.getElementById("state");
  let isConnected = false;
  let isLoading = true;
  let hasReceivedInitialState = false;

  const port = chrome.runtime.connect({ name: "popup" });

  function updateSliderState() {
    if (isLoading) {
      slider.className = "slider loading";
      toggleSlider.checked = true; // Assume connected while loading
      return;
    }
    // Only remove no-transition after we've received and applied the initial state
    if (hasReceivedInitialState) {
      slider.classList.remove("no-transition");
    }
    slider.className = `slider ${isConnected ? "connected" : ""}`;
    toggleSlider.checked = isConnected;
  }

  function updateStatus(status) {
    isLoading = false;
    hasReceivedInitialState = true;
    if (status.error) {
      if (status.error === "State: Stopped") {
        stateDisplay.textContent = "Disconnected";
        isConnected = false;
        updateSliderState();
        return;
      }
      stateDisplay.textContent = `Error: ${status.error}`;
      return;
    }
    if (status.needsLogin) {
      stateDisplay.innerHTML = status.browseToURL
        ? `<b><a href='#login'>Log in</a></b>`
        : "<b>Login required; no URL</b>";
      return;
    }
    if (typeof status === "string" && status === "Disconnected") {
      stateDisplay.textContent = "Disconnected";
      isConnected = false;
      updateSliderState();
      return;
    }
    if (status.running !== undefined) {
      stateDisplay.textContent = status.running
        ? `Connected as ${status.tailnet || "Not connected"}`
        : "Disconnected";
      isConnected = status.running;
      updateSliderState();
    }
  }

  port.onMessage.addListener((msg) => {
    console.log("Received from background:", JSON.stringify(msg));
    if (msg.installCmd) {
      console.log("Received install command");
      stateDisplay.innerHTML = `<b>Installation needed. Run:</b><pre>${msg.installCmd}</pre>`;
      toggleSlider.disabled = true;
      settingsButton.hidden = true;
      return;
    }
    if (msg.error) {
      console.log("Error from background:", msg);
      stateDisplay.textContent = msg.error;
      toggleSlider.disabled = true;
      settingsButton.hidden = true;
      return;
    }
    if (msg.status) {
      console.log("Received status update:", msg.status);
      updateStatus(msg.status);
    }
  });

  toggleSlider.addEventListener("change", () => {
    console.log("Toggle slider changed, current state:", isConnected);
    chrome.runtime.sendMessage({ command: "toggleProxy" }, (response) => {
      console.log("Received response from background:", response);
      if (response && response.status) {
        updateStatus(response.status);
      }
    });
    console.log("Sent toggleProxy command to background");
  });

  settingsButton.addEventListener("click", () => {
    console.log("Settings button clicked");
    chrome.tabs.create({ url: "http://100.100.100.100" });
  });

  window.addEventListener("beforeunload", () => {
    port.disconnect();
  });
});
