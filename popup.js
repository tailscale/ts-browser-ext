document.addEventListener("DOMContentLoaded", () => {
    let btn = document.getElementById("button");
    let st = document.getElementById("state");

    let port = chrome.runtime.connect({ name: "popup" });

    port.onMessage.addListener((msg) => {
        if (msg.installCmd) {
            st.innerHTML = "<b>Installation needed. Run:</b><pre>" + msg.installCmd + "</pre>";
            btn.hidden = true;
            return;
        }
        if (msg.error) {
            console.log("Error from background:", msg);
            st.innerText = msg.error;
            btn.hidden = true;
            return;
        }
        btn.hidden = false;
        console.log("Received from background:", msg);

        st.innerText = msg;
    });
        
    window.onunload = () => { port.disconnect(); }; // probably redundant

    btn.addEventListener("click", () => {
        port.postMessage({ command: "toggleProxy" });
    });
})
