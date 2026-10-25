(function (root) {
  "use strict";

  var LB = root.LB;
  var attached = new Set();
  var holders = new Map();
  var borrowers = new Map();
  var attaching = new Map();
  var detachListeners = [];

  function holdersOf(tabId) {
    var set = holders.get(tabId);
    if (!set) {
      set = new Set();
      holders.set(tabId, set);
    }
    return set;
  }

  function busy(tabId) {
    var set = holders.get(tabId);
    return (set && set.size > 0) || (borrowers.get(tabId) || 0) > 0;
  }

  function isAttached(tabId) {
    return attached.has(tabId);
  }

  function holds(tabId, holder) {
    var set = holders.get(tabId);
    return Boolean(set && set.has(holder));
  }

  function attach(tabId) {
    if (attached.has(tabId)) return Promise.resolve();
    var pending = attaching.get(tabId);
    if (pending) return pending;
    pending = Promise.resolve(chrome.debugger.attach({ tabId: tabId }, "1.3")).then(
      function () {
        attaching.delete(tabId);
        attached.add(tabId);
      },
      function (error) {
        attaching.delete(tabId);
        throw error;
      }
    );
    attaching.set(tabId, pending);
    return pending;
  }

  async function detach(tabId) {
    if (!attached.has(tabId)) return;
    attached.delete(tabId);
    holders.delete(tabId);
    await chrome.debugger.detach({ tabId: tabId }).catch(function () {});
  }

  async function acquire(tabId, holder) {
    await attach(tabId);
    holdersOf(tabId).add(holder);
  }

  async function release(tabId, holder) {
    var set = holders.get(tabId);
    if (set) set.delete(holder);
    if (!busy(tabId)) await detach(tabId);
  }

  async function borrow(tabId, fn) {
    await attach(tabId);
    borrowers.set(tabId, (borrowers.get(tabId) || 0) + 1);
    try {
      return await fn({ tabId: tabId });
    } finally {
      var left = (borrowers.get(tabId) || 1) - 1;
      if (left > 0) borrowers.set(tabId, left);
      else borrowers.delete(tabId);
      if (!busy(tabId)) await detach(tabId);
    }
  }

  function send(tabId, method, params) {
    return chrome.debugger.sendCommand({ tabId: tabId }, method, params || {});
  }

  function onDetach(fn) {
    detachListeners.push(fn);
  }

  function forget(tabId) {
    attached.delete(tabId);
    holders.delete(tabId);
    borrowers.delete(tabId);
    for (var index = 0; index < detachListeners.length; index += 1) {
      try {
        detachListeners[index](tabId);
      } catch (error) {}
    }
  }

  LB.bg = LB.bg || {};
  LB.bg.cdp = {
    isAttached: isAttached,
    holds: holds,
    acquire: acquire,
    release: release,
    borrow: borrow,
    send: send,
    detach: detach,
    onDetach: onDetach,
    forget: forget
  };
})(globalThis);
