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
  var detectedEl = document.getElementById("detected");
  var pairForm = document.getElementById("pair-form");
  var actions = document.getElementById("actions");
  var pairInput = document.getElementById("pair-input");
  var pairButton = document.getElementById("pair");
  var reconnectButton = document.getElementById("reconnect");
  var disconnectButton = document.getElementById("disconnect");

  var lastPairing = null;
  var storedOrigin = null;

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
    if (!value) return "—";
    var at = new Date(value);
    if (Number.isNaN(at.getTime())) return "—";
    return at.toLocaleTimeString();
  }

  function render(state, pairing) {
    statusEl.textContent = state.status;
    statusEl.dataset.status = state.status;
    labelEl.textContent = state.label || "—";
    tierEl.textContent = state.tier || "—";
    originEl.textContent = state.origin || "—";
    sinceEl.textContent = since(state.connectedAt);
    versionEl.textContent = "firefox " + state.clientVersion;
    if (pairing) lastPairing = pairing;
    if (pairing && pairing.origin) storedOrigin = pairing.origin;
    var layout = LB.popupState.view(pairing, state);
    pairForm.hidden = !layout.showPairForm;
    actions.hidden = !layout.showActions;
    reconnectButton.disabled = !layout.reconnectEnabled;
    if (layout.showPairForm && layout.prefillOrigin && !pairInput.value) pairInput.value = layout.prefillOrigin;
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

  async function detect() {
    var response = await browser.runtime.sendMessage({ channel: "lb-control", op: "detect" });
    if (!response || !response.ok || !response.pairing) return null;
    return response.pairing;
  }

  async function offerDetected() {
    var found = await detect();
    if (!found || !found.code) {
      detectedEl.hidden = true;
      return;
    }
    detectedEl.hidden = false;
    detectedEl.textContent = "Found a pairing code on the open Paperclip tab. Press Connect to use it.";
    pairInput.value = LB.pairing.pairUrl(found.origin, found.code) || found.code;
  }

  async function connect() {
    pairButton.disabled = true;
    showMessage("");
    try {
      var parsed = LB.pairing.parsePairingInput(pairInput.value);
      if (parsed.reason) {
        showMessage(parsed.reason);
        return;
      }
      var origin = parsed.origin || storedOrigin;
      if (!origin) {
        showMessage("Paste the pairing link from Paperclip, or open the pairing page in a tab first.");
        return;
      }
      if (!parsed.code) {
        showMessage("Add the pairing code to that address.");
        return;
      }
      var response = await browser.runtime.sendMessage({
        channel: "lb-control",
        op: "pair",
        origin: origin,
        code: parsed.code
      });
      if (!response || !response.ok) {
        showMessage(response && response.error ? response.error : "Pairing failed");
        return;
      }
      pairInput.value = "";
      detectedEl.hidden = true;
      render(response.state, { origin: origin });
    } finally {
      pairButton.disabled = false;
    }
  }

  pairButton.addEventListener("click", connect);
  pairInput.addEventListener("keydown", function (event) {
    if (event.key === "Enter") connect();
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

  refresh().then(offerDetected);
  refreshBidi();
})();
