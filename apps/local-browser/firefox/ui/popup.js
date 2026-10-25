(function () {
  "use strict";

  var LB = globalThis.LB;
  var status = null;
  var access = null;
  var busy = false;

  function byId(id) {
    return document.getElementById(id);
  }

  function say(message, tone) {
    var node = byId("message");
    node.textContent = message || "";
    if (tone) node.setAttribute("data-tone", tone);
    else node.removeAttribute("data-tone");
  }

  function options() {
    return {
      catalog: (LB.contract && LB.contract.permissions) || [],
      client: LB.ext.client,
      requestable: LB.access.requestableIds(),
      access: access || undefined
    };
  }

  function pendingItem(item) {
    var row = document.createElement("li");
    var name = document.createElement("span");
    name.className = "name";
    name.textContent = item.label;
    var why = document.createElement("span");
    why.className = "why";
    why.textContent = item.reason + (item.tool ? " (" + item.tool + ")" : "") + (item.age ? " \u00b7 " + item.age : "");
    var allow = document.createElement("button");
    allow.type = "button";
    allow.className = "primary";
    allow.textContent = "Allow";
    allow.setAttribute("data-permission", item.permission);
    allow.setAttribute("aria-label", "Allow " + item.label);
    allow.disabled = busy;
    row.append(name, why, allow);
    return row;
  }

  function render() {
    var view = LB.uiState.popup(status, options());
    var connection = view.connection;
    byId("dot").setAttribute("data-tone", connection.tone);
    byId("state").textContent = view.ready ? connection.title : "Checking connection\u2026";
    byId("detail").textContent = view.ready ? connection.detail : "";
    byId("version").textContent = connection.version;
    byId("pair-form").hidden = !view.ready || !connection.showPairForm;

    var permissions = view.permissions;
    byId("site-line").textContent = permissions.siteLine;
    byId("summary").textContent = permissions.summary;
    var allowAll = byId("allow-all");
    allowAll.textContent = permissions.allowAllLabel;
    allowAll.disabled = busy || permissions.allGranted;

    byId("pending-section").hidden = !view.showPending;
    byId("pending-list").replaceChildren.apply(byId("pending-list"), permissions.pending.map(pendingItem));
  }

  function loadAccess() {
    return LB.access.snapshot().then(function (snapshot) {
      access = snapshot;
      render();
    }, function () {});
  }

  function loadStatus() {
    return LB.ext.sendControl("status").then(
      function (response) {
        var result = LB.uiState.unwrap(response);
        if (result.ok) status = result.status || null;
        else say(result.error, "error");
        render();
      },
      function () {
        say("The extension is starting up. Reopen this popup in a moment.", "error");
      }
    );
  }

  function settle(request) {
    busy = true;
    render();
    return request.then(
      function (result) {
        busy = false;
        if (result.granted) say("Allowed. Agents can use it right away.");
        else if (!result.requested.length) say("Nothing to allow here.");
        else say("Nothing changed. The browser prompt was closed without allowing.");
        return loadAccess();
      },
      function (error) {
        busy = false;
        say((error && error.message) || String(error), "error");
        render();
      }
    );
  }

  function onAllowAll() {
    settle(LB.access.requestAll());
  }

  function onPendingClick(event) {
    var target = event.target && event.target.closest ? event.target.closest("button[data-permission]") : null;
    if (!target) return;
    settle(LB.access.request([target.getAttribute("data-permission")]));
  }

  function showPairError(message) {
    var node = byId("pair-error");
    node.textContent = message || "";
    node.hidden = !message;
  }

  function onPair(event) {
    event.preventDefault();
    var input = byId("pair-input").value.trim();
    var parsed = LB.pairing.parsePairingInput(input);
    if (!input || parsed.reason) {
      showPairError(parsed.reason || "Paste the pairing link from Paperclip.");
      return;
    }
    showPairError("");
    byId("pair").disabled = true;
    LB.ext.sendControl("pair", { input: input }).then(
      function (response) {
        byId("pair").disabled = false;
        var result = LB.uiState.unwrap(response);
        if (!result.ok) {
          showPairError(result.error);
          return;
        }
        byId("pair-input").value = "";
        if (result.status) status = result.status;
        say("Pairing started.");
        render();
      },
      function (error) {
        byId("pair").disabled = false;
        showPairError((error && error.message) || String(error));
      }
    );
  }

  function offerDetected() {
    LB.ext.sendControl("detect").then(function (response) {
      var result = LB.uiState.unwrap(response);
      var found = result.ok && result.detected && result.detected.input;
      var field = byId("pair-input");
      if (!found || field.value) return;
      field.value = result.detected.input;
      var hint = byId("detected");
      hint.textContent = "Found a pairing link in the current tab. Press Pair to connect.";
      hint.hidden = false;
    }, function () {});
  }

  function onOpenControl() {
    LB.ext.openControlCenter(access && access.pending && access.pending.length ? "permissions" : "overview").then(function () {
      window.close();
    }, function (error) {
      say((error && error.message) || String(error), "error");
    });
  }

  function onMessage(message) {
    if (!message || message.channel !== "lb-status" || !message.status) return;
    status = message.status;
    render();
  }

  byId("allow-all").addEventListener("click", onAllowAll);
  byId("pending-list").addEventListener("click", onPendingClick);
  byId("pair-form").addEventListener("submit", onPair);
  byId("open-control").addEventListener("click", onOpenControl);
  LB.ext.api.runtime.onMessage.addListener(onMessage);
  LB.access.onChange(function (snapshot) {
    access = snapshot;
    render();
  });

  render();
  loadAccess();
  loadStatus().then(offerDetected);
})();
