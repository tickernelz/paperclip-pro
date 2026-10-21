(function () {
  "use strict";

  var statusEl = document.getElementById("status");
  var labelEl = document.getElementById("label");
  var tierEl = document.getElementById("tier");
  var originEl = document.getElementById("origin");
  var sinceEl = document.getElementById("since");
  var versionEl = document.getElementById("version");
  var bidiEl = document.getElementById("bidi");
  var messageEl = document.getElementById("message");
  var bidiHintEl = document.getElementById("bidi-hint");
  var pairForm = document.getElementById("pair-form");
  var actions = document.getElementById("actions");
  var originInput = document.getElementById("origin-input");
  var codeInput = document.getElementById("code-input");
  var labelInput = document.getElementById("label-input");
  var pairButton = document.getElementById("pair");
  var reconnectButton = document.getElementById("reconnect");
  var disconnectButton = document.getElementById("disconnect");

  var lastPairing = null;

  function showMessage(text) {
    if (!text) {
      messageEl.hidden = true;
      messageEl.textContent = "";
      return;
    }
    messageEl.hidden = false;
    messageEl.textContent = text;
  }

  function since(value) {
    if (!value) return "\u2014";
    var at = new Date(value);
    if (Number.isNaN(at.getTime())) return "\u2014";
    return at.toLocaleTimeString();
  }

  function render(state, pairing) {
    statusEl.textContent = state.status;
    statusEl.dataset.status = state.status;
    labelEl.textContent = state.label || "\u2014";
    tierEl.textContent = state.tier || "\u2014";
    originEl.textContent = state.origin || "\u2014";
    sinceEl.textContent = since(state.connectedAt);
    versionEl.textContent = "firefox " + state.clientVersion;
    if (pairing) lastPairing = pairing;
    var layout = LB.popupState.view(pairing, state);
    pairForm.hidden = !layout.showPairForm;
    actions.hidden = !layout.showActions;
    reconnectButton.disabled = !layout.reconnectEnabled;
    if (layout.showPairForm && layout.prefillOrigin && !originInput.value) originInput.value = layout.prefillOrigin;
    showMessage(layout.message);
  }

  async function refresh() {
    var response = await browser.runtime.sendMessage({ channel: "lb-control", op: "status" });
    if (!response || !response.ok) {
      showMessage(response && response.error ? response.error : "The background page did not answer");
      return;
    }
    render(response.state, response.pairing);
  }

  async function refreshBidi() {
    bidiEl.textContent = "checking";
    var response = await browser.runtime.sendMessage({ channel: "lb-control", op: "bidi" });
    if (response && response.ok && response.bidi && response.bidi.available) {
      bidiEl.textContent = "WebDriver BiDi ready";
      bidiHintEl.hidden = true;
      return;
    }
    bidiEl.textContent = "synthetic events";
    var hint = response && response.ok && response.bidi ? response.bidi.launchHint : "";
    if (!hint) {
      bidiHintEl.hidden = true;
      return;
    }
    bidiHintEl.hidden = false;
    bidiHintEl.textContent = "";
    bidiHintEl.appendChild(document.createTextNode("Viewer input stays synthetic. Start Firefox with: "));
    var code = document.createElement("code");
    code.textContent = hint;
    bidiHintEl.appendChild(code);
  }

  pairButton.addEventListener("click", async function () {
    pairButton.disabled = true;
    showMessage("");
    try {
      var response = await browser.runtime.sendMessage({
        channel: "lb-control",
        op: "pair",
        origin: originInput.value,
        code: codeInput.value,
        label: labelInput.value
      });
      if (!response || !response.ok) {
        showMessage(response && response.error ? response.error : "Pairing failed");
        return;
      }
      codeInput.value = "";
      render(response.state, { origin: originInput.value });
    } finally {
      pairButton.disabled = false;
    }
  });

  reconnectButton.addEventListener("click", async function () {
    var response = await browser.runtime.sendMessage({ channel: "lb-control", op: "reconnect" });
    if (response && response.ok) render(response.state, lastPairing);
    else showMessage(response && response.error ? response.error : "Reconnect failed");
  });

  disconnectButton.addEventListener("click", async function () {
    var response = await browser.runtime.sendMessage({ channel: "lb-control", op: "disconnect" });
    if (response && response.ok) {
      lastPairing = null;
      render(response.state, null);
    } else {
      showMessage(response && response.error ? response.error : "Disconnect failed");
    }
  });

  browser.runtime.onMessage.addListener(function (message) {
    if (!message || message.channel !== "lb-status") return undefined;
    render(message.state, lastPairing);
    return undefined;
  });

  if (typeof globalThis.__exposeRender === "function") globalThis.__exposeRender(render);

  refresh();
  refreshBidi();
})();
