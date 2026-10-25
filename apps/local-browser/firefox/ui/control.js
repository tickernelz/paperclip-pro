(function () {
  "use strict";

  var LB = globalThis.LB;
  var status = null;
  var access = null;
  var busy = false;
  var guardsDirty = false;

  function byId(id) {
    return document.getElementById(id);
  }

  function say(message, tone) {
    var node = byId("message");
    node.textContent = message || "";
    if (tone) node.setAttribute("data-tone", tone);
    else node.removeAttribute("data-tone");
  }

  function failure(error) {
    say((error && error.message) || String(error), "error");
  }

  function bounds() {
    var guards = LB.contract && LB.contract.guards;
    return (guards && guards.networkBufferSize) || { min: 50, max: 20000 };
  }

  function options() {
    return {
      catalog: (LB.contract && LB.contract.permissions) || [],
      client: LB.ext.client,
      requestable: LB.access.requestableIds(),
      access: access || undefined,
      bounds: bounds()
    };
  }

  function element(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function button(label, className, attrs) {
    var node = element("button", className, label);
    node.type = "button";
    node.disabled = busy;
    Object.keys(attrs || {}).forEach(function (key) { node.setAttribute(key, attrs[key]); });
    return node;
  }

  function pendingItem(item) {
    var row = element("li");
    var actions = element("div", "item-actions");
    actions.append(
      button("Allow", "primary", { "data-allow": item.permission, "aria-label": "Allow " + item.label }),
      button("Dismiss", "", { "data-dismiss": item.permission, "aria-label": "Dismiss the request for " + item.label })
    );
    row.append(
      element("span", "item-name", item.label),
      element("span", "item-text", item.reason),
      element("span", "item-text", [item.tool, item.age].filter(Boolean).join(" \u00b7 ")),
      actions
    );
    return row;
  }

  function permissionItem(row) {
    var item = element("li", row.pending && !row.granted ? "is-pending" : "");
    var chip = element("span", "chip", row.statusText);
    chip.setAttribute("data-status", row.pending && !row.granted ? "pending" : row.status);
    var actions = element("div", "item-actions");
    actions.append(chip);
    if (row.canAllow) actions.append(button("Allow", "primary", { "data-allow": row.id, "aria-label": "Allow " + row.label }));
    if (row.canRevoke) actions.append(button("Revoke", "", { "data-revoke": row.id, "aria-label": "Revoke " + row.label }));
    item.append(element("span", "item-name", row.label), element("span", "item-text", row.grants));
    if (row.pending && !row.granted) item.append(element("span", "item-text", "Agent request: " + (row.pending.reason || "no reason given")));
    item.append(actions);
    return item;
  }

  function toggleItem(toggle) {
    var wrapper = element("label", "toggle");
    var box = document.createElement("input");
    box.type = "checkbox";
    box.name = toggle.key;
    box.checked = toggle.checked;
    wrapper.append(box, element("strong", "", toggle.label), element("span", "", toggle.description));
    return wrapper;
  }

  function fill(id, children) {
    var node = byId(id);
    node.replaceChildren.apply(node, children);
  }

  function showSection() {
    var current = LB.uiState.section(location.hash);
    document.querySelectorAll("[data-section]").forEach(function (node) {
      node.hidden = node.getAttribute("data-section") !== current;
    });
    document.querySelectorAll("[data-nav]").forEach(function (link) {
      if (link.getAttribute("data-nav") === current) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });
  }

  function render() {
    var view = LB.uiState.control(status, options());
    var connection = view.connection;
    byId("pill").setAttribute("data-tone", view.ready ? connection.tone : "off");
    byId("pill-text").textContent = view.ready ? connection.title : "Checking\u2026";
    byId("detail").textContent = view.ready ? connection.detail : "Asking the extension for its state\u2026";
    byId("label").textContent = connection.label;
    byId("origin").textContent = connection.origin;
    byId("tier").textContent = connection.tier;
    byId("session").textContent = connection.session;
    byId("tabs").textContent = connection.tabs;
    byId("client").textContent = connection.client || "\u2014";
    byId("origins").textContent = connection.origins;
    byId("version").textContent = connection.version;
    byId("reconnect").disabled = !connection.canReconnect;
    byId("disconnect").disabled = !connection.canDisconnect;
    byId("pair-note").textContent = connection.showPairForm
      ? "Paste the pairing link from Paperclip's Local Browser page. Codes expire after 10 minutes."
      : "Pasting a new pairing link replaces the current pairing.";

    var permissions = view.permissions;
    byId("site-line").textContent = permissions.siteLine;
    byId("summary").textContent = permissions.summary;
    ["allow-all", "welcome-allow"].forEach(function (id) {
      var node = byId(id);
      node.textContent = permissions.allowAllLabel;
      node.disabled = busy || permissions.allGranted;
    });
    var badge = byId("nav-badge");
    badge.textContent = permissions.badge;
    badge.hidden = !permissions.badge;
    byId("pending-panel").hidden = permissions.pending.length === 0;
    byId("dismiss-all").disabled = busy;
    fill("pending-list", permissions.pending.map(pendingItem));
    fill("permission-list", permissions.rows.map(permissionItem));

    if (!guardsDirty) {
      fill("guard-toggles", view.guards.toggles.map(toggleItem));
      var size = byId("buffer-size");
      size.min = String(view.guards.min);
      size.max = String(view.guards.max);
      size.value = String(view.guards.networkBufferSize);
      byId("buffer-range").textContent = "Between " + view.guards.min + " and " + view.guards.max + ".";
    }

    var input = view.trustedInput;
    byId("input-title-line").textContent = input.title;
    byId("input-hint").textContent = input.hint;
    byId("command-panel").hidden = !input.showCommand;
    byId("command").textContent = input.command;
    byId("port-form").hidden = !input.showPort;
  }

  function loadAccess() {
    return LB.access.snapshot().then(function (snapshot) {
      access = snapshot;
      render();
    }, function () {});
  }

  function control(op, payload, done) {
    return LB.ext.sendControl(op, payload).then(function (response) {
      var result = LB.uiState.unwrap(response);
      if (result.status) status = result.status;
      if (!result.ok) say(result.error, "error");
      else if (done) say(done);
      render();
      return result;
    }, function (error) {
      failure(error);
      return { ok: false };
    });
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
        failure(error);
        render();
      }
    );
  }

  function onAllowAll() {
    settle(LB.access.requestAll());
  }

  function onListClick(event) {
    var target = event.target && event.target.closest ? event.target.closest("button") : null;
    if (!target) return;
    var allow = target.getAttribute("data-allow");
    if (allow) {
      settle(LB.access.request([allow]));
      return;
    }
    var revoke = target.getAttribute("data-revoke");
    if (revoke) {
      LB.access.revoke(revoke).then(function (removed) {
        say(removed ? "Revoked. Agents lose that access now." : "The browser kept that permission.");
        return loadAccess();
      }, failure);
      return;
    }
    var dismiss = target.getAttribute("data-dismiss");
    if (dismiss) control("pending.clear", { permissions: [dismiss] }, "Request dismissed.").then(loadAccess);
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
      var field = byId("pair-input");
      if (!result.ok || !result.detected || !result.detected.input || field.value) return;
      field.value = result.detected.input;
      var hint = byId("detected");
      hint.textContent = "Found a pairing link in an open tab. Press Pair to connect.";
      hint.hidden = false;
    }, function () {});
  }

  function onGuardsSubmit(event) {
    event.preventDefault();
    var patch = {};
    byId("guard-toggles").querySelectorAll("input[type=checkbox]").forEach(function (box) {
      patch[box.name] = box.checked;
    });
    var size = Number(byId("buffer-size").value);
    if (Number.isFinite(size)) patch.networkBufferSize = size;
    guardsDirty = false;
    control("guards.set", { patch: patch }, "Guards saved.");
  }

  function onCopyCommand() {
    var command = byId("command").textContent;
    var clipboard = navigator.clipboard;
    if (!clipboard || typeof clipboard.writeText !== "function") {
      say("Select the command and copy it by hand.");
      return;
    }
    clipboard.writeText(command).then(function () { say("Command copied."); }, failure);
  }

  function onPortSubmit(event) {
    event.preventDefault();
    var port = Number(byId("bidi-port").value);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      say("Enter a port between 1 and 65535.", "error");
      return;
    }
    control("bidi.set", { port: port }, "Port saved. The extension checks it now.");
  }

  function onMessage(message) {
    if (!message || message.channel !== "lb-status" || !message.status) return;
    status = message.status;
    render();
  }

  byId("allow-all").addEventListener("click", onAllowAll);
  byId("welcome-allow").addEventListener("click", onAllowAll);
  byId("pending-list").addEventListener("click", onListClick);
  byId("permission-list").addEventListener("click", onListClick);
  byId("dismiss-all").addEventListener("click", function () {
    control("pending.clear", {}, "All requests dismissed.").then(loadAccess);
  });
  byId("pair-form").addEventListener("submit", onPair);
  byId("reconnect").addEventListener("click", function () { control("reconnect", {}, "Reconnecting\u2026"); });
  byId("disconnect").addEventListener("click", function () { control("disconnect", {}, "Disconnected."); });
  byId("guards-form").addEventListener("submit", onGuardsSubmit);
  byId("guards-form").addEventListener("input", function () { guardsDirty = true; });
  byId("copy-command").addEventListener("click", onCopyCommand);
  byId("port-form").addEventListener("submit", onPortSubmit);
  window.addEventListener("hashchange", showSection);
  LB.ext.api.runtime.onMessage.addListener(onMessage);
  LB.access.onChange(function (snapshot) {
    access = snapshot;
    render();
  });

  showSection();
  render();
  loadAccess();
  control("status", {}).then(offerDetected);
})();
