document.addEventListener("DOMContentLoaded", () => {
  const alertBox = document.getElementById("alertBox");
  const statusDot = document.getElementById("statusDot");
  const stateText = document.getElementById("stateText");
  const tailnetInfo = document.getElementById("tailnetInfo");
  const toggleBtn = document.getElementById("toggleBtn");
  const settingsBtn = document.getElementById("settingsBtn");
  const domainSettingsBtn = document.getElementById("domainSettingsBtn");
  const exitNodeCard = document.getElementById("exitNodeCard");
  const exitNodeDropdown = document.getElementById("exitNodeDropdown");
  const exitNodeDesc = document.getElementById("exitNodeDesc");
  let isConnected = false;
  let isLoading = true;
  let lastStatus = null;

  const port = browser.runtime.connect({ name: "popup" });

  function setAlert(message) {
    if (message) {
      alertBox.textContent = message;
      alertBox.classList.remove("hidden");
    } else {
      alertBox.classList.add("hidden");
    }
  }

  function setStatus(state, loading) {
    stateText.textContent = state;
    statusDot.className = "status-dot";
    if (loading) {
      statusDot.classList.add("loading");
      toggleBtn.textContent = "Connecting...";
      toggleBtn.disabled = true;
    } else if (isConnected) {
      statusDot.classList.add("connected");
      toggleBtn.textContent = "Disconnect";
      toggleBtn.disabled = false;
    } else {
      statusDot.classList.remove("connected");
      toggleBtn.textContent = "Connect";
      toggleBtn.disabled = false;
    }
  }

  function updateUI(status) {
    lastStatus = status;
    isLoading = false;
    setAlert(status.error || null);

    // State and tailnet info
    if (status.running !== undefined) {
      isConnected = !!status.running;
      setStatus(isConnected ? "Connected" : "Disconnected", false);
      tailnetInfo.textContent = status.tailnet ? `Tailnet: ${status.tailnet}` : "";
      if (isConnected && status.exitNodeName) {
        tailnetInfo.textContent += ` | Exit Node: ${status.exitNodeName}`;
      }
    } else {
      setStatus("Connecting...", true);
      tailnetInfo.textContent = "";
    }

    // Exit Node Dropdown
    if (isConnected && status.availableExitNodes && status.availableExitNodes.length) {
      exitNodeCard.classList.remove("hidden");
      exitNodeDropdown.innerHTML = "";
      const noneOpt = document.createElement("option");
      noneOpt.value = "";
      noneOpt.textContent = "None (Direct)";
      exitNodeDropdown.appendChild(noneOpt);

      status.availableExitNodes.forEach(node => {
        const opt = document.createElement("option");
        opt.value = node.id;
        opt.textContent = node.name;
        if (node.active) opt.selected = true;
        exitNodeDropdown.appendChild(opt);
      });

      const selected = status.availableExitNodes.find(n => n.active);
      if (selected) {
        exitNodeDesc.textContent = `Current exit node: ${selected.name}`;
        exitNodeDesc.classList.remove("hidden");
      } else {
        exitNodeDesc.classList.add("hidden");
      }
    } else {
      exitNodeCard.classList.add("hidden");
      exitNodeDesc.classList.add("hidden");
    }
  }

  port.onMessage.addListener((msg) => {
    if (msg.installCmd) {
      setAlert(`Installation needed. Run: ${msg.installCmd}`);
      toggleBtn.disabled = true;
      settingsBtn.disabled = true;
      domainSettingsBtn.disabled = true;
      exitNodeCard.classList.add("hidden");
      return;
    }
    if (msg.error) {
      setAlert(msg.error);
      toggleBtn.disabled = true;
      settingsBtn.disabled = true;
      domainSettingsBtn.disabled = true;
      exitNodeCard.classList.add("hidden");
      return;
    }
    if (msg.status) {
      updateUI(msg.status);
    }
  });

  toggleBtn.addEventListener("click", () => {
    isLoading = true;
    setStatus("Connecting...", true);
    browser.runtime.sendMessage({ command: "toggleProxy" }).then(response => {
      // Status will be updated when backend responds
    });
  });

  settingsBtn.addEventListener("click", () => {
    browser.tabs.create({ url: "http://100.100.100.100" });
  });

  domainSettingsBtn.addEventListener("click", () => {
    browser.tabs.create({ url: browser.runtime.getURL("domain_settings.html") });
  });

  exitNodeDropdown.addEventListener("change", () => {
    const exitNodeID = exitNodeDropdown.value;
    const command = exitNodeID ? "setExitNode" : "clearExitNode";
    browser.runtime.sendMessage({ command, exitNodeID });
    exitNodeDesc.classList.add("hidden");
  });

  window.addEventListener("beforeunload", () => {
    port.disconnect();
  });
});