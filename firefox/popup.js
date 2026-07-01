var lastStatus;

document.addEventListener("DOMContentLoaded", () => {
  const toggleSlider = document.getElementById("toggleSlider");
  const slider = document.querySelector(".slider");
  const settingsButton = document.getElementById("settingsButton");
  const stateDisplay = document.getElementById("state");
  const exitNodeSelect = document.getElementById("exitNodeSelect");
  let isConnected = false;
  let isLoading = true;
  let hasReceivedInitialState = false;
  let hasLoadedExitNodes = false;
  let isLoadingExitNodes = false;

  const port = browser.runtime.connect({ name: "popup" });

  // Fetch and populate exit nodes
  function refreshExitNodes() {
    if (isLoadingExitNodes) return;
    isLoadingExitNodes = true;
    console.log("Refreshing exit nodes...");

    browser.runtime.sendMessage({ command: "getExitNodes" }).then((response) => {
      isLoadingExitNodes = false;
      console.log("Got exit nodes response:", response);
      if (response && !response.error) {
        populateExitNodes(response.nodes || [], response.currentNode || "");
        exitNodeSelect.disabled = false;
        hasLoadedExitNodes = true; // Mark as successfully loaded
      } else {
        console.log("Failed to get exit nodes:", response?.error);
        exitNodeSelect.disabled = true;
        hasLoadedExitNodes = false;
      }
    }).catch((error) => {
      isLoadingExitNodes = false;
      console.error("getExitNodes failed:", error);
      exitNodeSelect.disabled = true;
      hasLoadedExitNodes = false;
    });
  }

  function populateExitNodes(nodes, currentNode) {
    // Clear existing options except "None"
    exitNodeSelect.innerHTML = '<option value="">None</option>';

    // Add exit node options
    nodes.forEach((node) => {
      const option = document.createElement("option");
      option.value = node.ip;
      option.textContent = node.name;
      if (node.ip === currentNode) {
        option.selected = true;
      }
      exitNodeSelect.appendChild(option);
    });
  }

  // Handle exit node selection change
  exitNodeSelect.addEventListener("change", () => {
    const selectedIP = exitNodeSelect.value;
    console.log("Exit node selection changed to:", selectedIP || "None");

    exitNodeSelect.disabled = true;
    browser.runtime.sendMessage({ command: "setExitNode", exitNodeIP: selectedIP }).then((response) => {
      console.log("Set exit node response:", response);
      exitNodeSelect.disabled = false;
      if (response && !response.success && response.error) {
        console.error("Failed to set exit node:", response.error);
        // Refresh to get the actual current state
        refreshExitNodes();
      }
    }).catch((error) => {
      console.error("setExitNode failed:", error);
      exitNodeSelect.disabled = false;
      refreshExitNodes();
    });
  });

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
        exitNodeSelect.disabled = true;
        updateSliderState();
        return;
      }
      stateDisplay.textContent = `Error: ${status.error}`;
      exitNodeSelect.disabled = true;
      return;
    }
    if (status.needsLogin) {
      lastStatus = status; // Save for login link
      stateDisplay.innerHTML = status.browseToURL
        ? `<b><a href="#" id="loginLink">Log in</a></b>`
        : "<b>Login required; no URL</b>";
      // Add click handler for login link
      const loginLink = document.getElementById("loginLink");
      if (loginLink) {
        loginLink.addEventListener("click", (e) => {
          e.preventDefault();
          if (lastStatus && lastStatus.browseToURL) {
            browser.tabs.create({ url: lastStatus.browseToURL });
          }
        });
      }
      exitNodeSelect.disabled = true;
      return;
    }
    if (typeof status === "string" && status === "Disconnected") {
      stateDisplay.textContent = "Disconnected";
      isConnected = false;
      exitNodeSelect.disabled = true;
      updateSliderState();
      return;
    }
    if (status.running !== undefined) {
      stateDisplay.textContent = status.running
        ? `Connected as ${status.tailnet || "Not connected"}`
        : "Disconnected";
      isConnected = status.running;
      updateSliderState();
      // Refresh exit nodes once when first connected
      if (status.running && !hasLoadedExitNodes) {
        refreshExitNodes();
      } else if (!status.running) {
        hasLoadedExitNodes = false;
        exitNodeSelect.disabled = true;
      }
    }
  }

  port.onMessage.addListener((msg) => {
    console.log("Received from background:", JSON.stringify(msg));

    // firefox requires that extensions settings proxies have private browsing access
    if (msg.needsIncognitoPermission) {
      console.log("Private browsing permission needed")
      stateDisplay.innerHTML = `<b><a href="https://support.mozilla.org/en-US/kb/extensions-private-browsing#w_enabling-or-disabling-extensions-in-private-windows">Enable private browsing access.</a></b>`
      return;
    }

    if (msg.installCmds) {
      console.log("Received install commands");
      stateDisplay.innerHTML = `
        <div class="install-container">
          <b>Installation needed. Run:</b>
          <pre>${msg.installCmds.remote}</pre>
          <button class="copy-button" data-cmd="${msg.installCmds.remote}">Copy command</button>
          
          <div style="margin-top: 12px"><b>Or for local dev:</b></div>
          <pre>${msg.installCmds.local}</pre>
          <button class="copy-button" data-cmd="${msg.installCmds.local}">Copy local command</button>
        </div>`;

      document.querySelectorAll(".copy-button").forEach(btn => {
        btn.addEventListener("click", () => {
          const cmd = btn.getAttribute("data-cmd");
          const originalText = btn.textContent;
          navigator.clipboard.writeText(cmd).then(() => {
            btn.textContent = "Copied!";
            setTimeout(() => {
              btn.textContent = originalText;
            }, 2000);
          });
        });
      });
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
    browser.runtime.sendMessage({ command: "toggleProxy" }).then((response) => {
      console.log("Received response from background:", response);
      if (response && response.status) {
        updateStatus(response.status);
      }
    });
    console.log("Sent toggleProxy command to background");
  });

  settingsButton.addEventListener("click", () => {
    console.log("Settings button clicked");
    browser.tabs.create({ url: "http://100.100.100.100" });
  });

  window.addEventListener("beforeunload", () => {
    port.disconnect();
  });
});
