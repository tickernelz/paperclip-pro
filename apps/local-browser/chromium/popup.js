const LB = globalThis.LB;

const state = {
  poll: null,
  busy: false
};

function byId(id) {
  return document.getElementById(id);
}

function setText(id, value) {
  const node = byId(id);
  if (node) node.textContent = value;
}

async function call(type, payload) {
  try {
    return await chrome.runtime.sendMessage(payload === undefined ? { type } : { type, payload });
  } catch (error) {
    return { error: String((error && error.message) || error) };
  }
}

function showError(value) {
  const node = byId("error");
  if (!node) return;
  if (!value) {
    node.hidden = true;
    node.textContent = "";
    return;
  }
  const message = typeof value === "string" ? value : value.message || value.code || "Something went wrong";
  node.textContent = message;
  node.hidden = false;
}

function setState(label, dot) {
  setText("state", label);
  const node = byId("dot");
  if (node) node.className = dot;
}

function render(status) {
  if (!status || status.error) {
    setState("Not paired", "dot off");
    setText("detail", "The extension could not report its state");
    showError(status ? status.error : "No answer from the extension");
    return;
  }
  showError(null);
  apply(LB.popup.view(status));
}

function apply(state) {
  setState(state.stateLabel, state.dotClass);
  setText("detail", state.detail);
  setText("tier", state.tier);
  setText("session", state.session);
  setText("tabs", state.tabs);
  setText("origins", state.origins);

  const form = byId("pair-form");
  if (form) form.hidden = !state.showPairForm;
  const disconnect = byId("disconnect");
  if (disconnect) disconnect.disabled = !state.disconnectEnabled;
  const reconnect = byId("reconnect");
  if (reconnect) reconnect.disabled = !state.reconnectEnabled;

  if (state.prefilledLabel && !byId("label").value) byId("label").value = state.prefilledLabel;
  if (state.prefilledOrigin && !byId("server").value) byId("server").value = state.prefilledOrigin;
}

async function refresh() {
  const status = await call("lb:status");
  render(status);
}

function setBusy(value) {
  state.busy = value;
  const button = byId("pair");
  if (button) button.disabled = value;
}

async function pair(event) {
  event.preventDefault();
  if (state.busy) return;
  showError(null);
  setBusy(true);
  const result = await call("lb:pair", {
    server: byId("server").value,
    code: byId("code").value,
    label: byId("label").value
  });
  setBusy(false);
  if (result && result.error) {
    showError(result.error);
    await refresh();
    return;
  }
  byId("code").value = "";
  render(result);
}

async function disconnect() {
  const result = await call("lb:disconnect");
  showError(null);
  render(result);
}

async function reconnect() {
  const result = await call("lb:reconnect");
  showError(null);
  render(result);
}

function start() {
  const form = byId("pair-form");
  if (form) form.addEventListener("submit", pair);
  const disconnectButton = byId("disconnect");
  if (disconnectButton) disconnectButton.addEventListener("click", disconnect);
  const reconnectButton = byId("reconnect");
  if (reconnectButton) reconnectButton.addEventListener("click", reconnect);

  setText("version", "v" + chrome.runtime.getManifest().version);
  void refresh();
  state.poll = setInterval(() => {
    if (!state.busy) void refresh();
  }, 1500);
}

document.addEventListener("DOMContentLoaded", start);
