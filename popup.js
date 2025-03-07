var lastStatus;

function browseToURL() {
  if (lastStatus && lastStatus.browseToURL) {
    chrome.tabs.create({ url: lastStatus.browseToURL });
  }
}

document.addEventListener("DOMContentLoaded", () => {
  let btn = document.getElementById("button");
  let st = document.getElementById("state");
  let tail = document.getElementById("tailnet");

  let port = chrome.runtime.connect({ name: "popup" });

  port.onMessage.addListener((msg) => {
    console.log("Received from background:", JSON.stringify(msg));
    if (msg.installCmd) {
      st.innerHTML =
        "<b>Installation needed. Run:</b><pre>" + msg.installCmd + "</pre>";
      btn.hidden = true;
      return;
    }
    if (msg.error) {
      console.log("Error from background:", msg);
      st.innerText = msg.error;
      btn.hidden = true;
      return;
    }
    let sm = msg.status;
    if (sm) {
      lastStatus = sm;
      console.log("Status from background:", JSON.stringify(sm));
      if (sm.error) {
        console.log("Status error:", sm.error);
        st.innerText = sm.error;
        btn.hidden = true;
        return;
      }
      if (sm.needsLogin) {
        if (sm.browseToURL) {
          st.innerHTML = "<b><a href='#login'>Log in</a>.</b>";
          st.querySelector("a").onclick = browseToURL;
        } else {
          st.innerHTML = "<b>Login required; no URL</b>";
        }
        btn.hidden = true;
        return;
      }
      st.innerHTML = sm.running
        ? '<div class="statusdot on"></div>Connected'
        : '<div class="statusdot off"></div>Not connected';
      tail.innerHTML = sm.tailnet;
      btn.hidden = false;
      btn.innerText = "Settings";
      return;
    }

    st.innerText = msg;
  });

  window.onunload = () => {
    port.disconnect();
  }; // probably redundant

  btn.addEventListener("click", () => {
    if (btn.innerText == "Settings") {
      // trashy :)
      chrome.tabs.create({ url: "http://100.100.100.100" });
      return;
    }
    port.postMessage({ command: "toggleProxy" });
  });
});
