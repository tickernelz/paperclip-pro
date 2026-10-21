(function (root) {
  "use strict";

  function view(pairing, state) {
    var hasOrigin = Boolean(pairing && typeof pairing.origin === "string" && pairing.origin);
    var hasToken = hasOrigin && pairing.hasToken === true;
    var retired = Boolean(pairing && pairing.retiredAt) && !hasToken;
    var reason = retired && pairing.retiredReason ? String(pairing.retiredReason) : "";
    var error = state && typeof state.lastError === "string" && state.lastError ? state.lastError : "";
    var message = error;
    if (!message && reason) message = "Session ended: " + reason + ". Pair this browser again with a new code.";
    return {
      showPairForm: !hasToken,
      showActions: hasOrigin,
      reconnectEnabled: hasToken,
      prefillOrigin: hasOrigin ? pairing.origin : "",
      retired: retired,
      message: message
    };
  }

  root.LB = root.LB || {};
  root.LB.popupState = { view: view };
})(globalThis);
