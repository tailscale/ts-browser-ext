function getDomains(callback) {
  browser.runtime.sendMessage({ command: "getExitNodeDomains" }).then(resp => {
    callback(resp.domains || []);
  });
}

function setDomains(domains, callback) {
  browser.runtime.sendMessage({ command: "setExitNodeDomains", domains }).then(() => {
    if (callback) callback();
  });
}

function renderDomainList(domains) {
  const list = document.getElementById("domainList");
  list.innerHTML = "";
  if (!domains.length) {
    list.innerHTML = "<div style='color:#888; font-size:14px;'>No domains configured.</div>";
    return;
  }
  domains.forEach((d, idx) => {
    const row = document.createElement("div");
    row.className = "domain-item";
    const label = document.createElement("span");
    label.className = "domain-label";
    label.textContent = d;
    const btn = document.createElement("button");
    btn.className = "remove-btn";
    btn.textContent = "Remove";
    btn.addEventListener("click", () => {
      domains.splice(idx, 1);
      setDomains(domains, () => renderDomainList(domains));
    });
    row.appendChild(label);
    row.appendChild(btn);
    list.appendChild(row);
  });
}

document.addEventListener("DOMContentLoaded", () => {
  getDomains(domains => renderDomainList(domains));
  document.getElementById("domainForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const input = document.getElementById("domainInput");
    let val = input.value.trim();
    if (!val) return;
    getDomains(domains => {
      if (!domains.includes(val)) {
        domains.push(val);
        setDomains(domains, () => {
          renderDomainList(domains);
          input.value = "";
        });
      } else {
        input.value = "";
      }
    });
  });
});