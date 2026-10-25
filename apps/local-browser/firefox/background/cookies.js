(function (root) {
  "use strict";

  var LB = root.LB;
  var protocol = LB.protocol;
  var C = protocol.ERROR_CODES;
  var DEFAULT_STORE = "firefox-default";
  var ALL_PARTITIONS = {};

  function hasPartition(cookie) {
    return Boolean(cookie.partitionKey && typeof cookie.partitionKey === "object" && Object.keys(cookie.partitionKey).length);
  }

  function metaRecord(cookie) {
    var record = {
      name: cookie.name,
      domain: cookie.domain,
      path: cookie.path,
      session: cookie.session === true,
      httpOnly: cookie.httpOnly === true,
      secure: cookie.secure === true,
      sameSite: cookie.sameSite || "no_restriction",
      hostOnly: cookie.hostOnly === true
    };
    if (!record.session && typeof cookie.expirationDate === "number") record.expirationDate = cookie.expirationDate;
    return record;
  }

  function cookieRecord(cookie) {
    var record = {
      name: cookie.name,
      value: cookie.value,
      domain: cookie.domain,
      path: cookie.path,
      secure: cookie.secure === true,
      httpOnly: cookie.httpOnly === true,
      sameSite: cookie.sameSite || "no_restriction",
      session: cookie.session === true,
      hostOnly: cookie.hostOnly === true,
      storeId: cookie.storeId || DEFAULT_STORE
    };
    if (!record.session && typeof cookie.expirationDate === "number") record.expirationDate = cookie.expirationDate;
    if (hasPartition(cookie)) record.partitionKey = cookie.partitionKey;
    if (cookie.firstPartyDomain) record.firstPartyDomain = cookie.firstPartyDomain;
    return record;
  }

  function scopeError() {
    return protocol.error(C.protocolError, "Cookies need an http(s) url or a domain", "Pass url, domain, or allDomains, or use a tab on a website", false);
  }

  function storeFor(args, tab) {
    if (typeof args.storeId === "string" && args.storeId) return args.storeId;
    if (tab && typeof tab.cookieStoreId === "string" && tab.cookieStoreId) return tab.cookieStoreId;
    return null;
  }

  function cookieQuery(args, tab) {
    var query = { partitionKey: ALL_PARTITIONS };
    var store = storeFor(args, tab);
    if (store) query.storeId = store;
    if (args.name) query.name = args.name;
    if (args.allDomains === true) return query;
    if (typeof args.domain === "string" && args.domain) {
      query.domain = args.domain.replace(/^\./, "");
      return query;
    }
    var target = typeof args.url === "string" && args.url ? args.url : tab && tab.url;
    if (!protocol.originOf(target)) throw scopeError();
    query.url = target;
    return query;
  }

  function cookieUrlFor(args, tab, entry) {
    var scheme = entry && entry.secure === false ? "http://" : "https://";
    var domain = (entry && entry.domain) || (typeof args.domain === "string" ? args.domain : "");
    if (domain) return scheme + String(domain).replace(/^\./, "") + ((entry && entry.path) || "/");
    var base = (typeof args.url === "string" && args.url) || (tab && protocol.originOf(tab.url) ? tab.url : "");
    if (!base) throw scopeError();
    if (entry && entry.path) {
      try {
        return new URL(entry.path, base).href;
      } catch (error) {
        return base;
      }
    }
    return base;
  }

  async function get(args, tab) {
    var query = cookieQuery(args, tab);
    var found = (await browser.cookies.getAll(query)).map(cookieRecord);
    var limit = typeof args.limit === "number" && args.limit >= 1 ? Math.floor(args.limit) : found.length;
    var result = { kind: "cookies", op: "get", query: query, total: found.length, cookies: found.slice(0, limit) };
    if (query.storeId) result.storeId = query.storeId;
    return result;
  }

  async function set(args, tab) {
    var writes = Array.isArray(args.entries) ? args.entries : [];
    if (!writes.length) throw protocol.error(C.protocolError, "set needs entries", "Pass name and value pairs", false);
    var store = storeFor(args, tab);
    var written = [];
    var failed = [];
    for (var i = 0; i < writes.length; i += 1) {
      var entry = writes[i];
      var details = { url: cookieUrlFor(args, tab, entry), name: entry.name, value: entry.value };
      var entryStore = entry.storeId || store;
      if (entryStore) details.storeId = entryStore;
      var entryDomain = entry.domain || (typeof args.domain === "string" ? args.domain : "");
      if (entryDomain) details.domain = entryDomain;
      if (typeof entry.path === "string" && entry.path) details.path = entry.path;
      if (typeof entry.secure === "boolean") details.secure = entry.secure;
      if (typeof entry.httpOnly === "boolean") details.httpOnly = entry.httpOnly;
      if (typeof entry.sameSite === "string" && entry.sameSite !== "unspecified") details.sameSite = entry.sameSite;
      if (entry.session !== true && typeof entry.expirationDate === "number") details.expirationDate = entry.expirationDate;
      try {
        written.push(cookieRecord(await browser.cookies.set(details)));
      } catch (error) {
        failed.push(entry.name);
      }
    }
    var result = { kind: "cookies", op: "set", count: written.length, cookies: written };
    if (failed.length) {
      result.failed = failed;
      result.note = "The browser refused " + failed.length + " cookie(s); check the domain against the url";
    }
    return result;
  }

  async function clear(args, tab) {
    var query = cookieQuery(args, tab);
    var all = await browser.cookies.getAll(query);
    if (args.allDomains === true && all.length > 50 && args.confirmAll !== true && !args.name) {
      throw protocol.error(C.protocolError, "Refusing to clear " + all.length + " cookies across every site", "Pass a name filter or confirmAll: true", false);
    }
    var removed = [];
    var refused = [];
    for (var i = 0; i < all.length; i += 1) {
      var cookie = all[i];
      var host = String(cookie.domain || "").replace(/^\./, "");
      var details = { url: (cookie.secure ? "https://" : "http://") + host + (cookie.path || "/"), name: cookie.name, storeId: cookie.storeId };
      if (hasPartition(cookie)) details.partitionKey = cookie.partitionKey;
      if (cookie.firstPartyDomain) details.firstPartyDomain = cookie.firstPartyDomain;
      try {
        if (await browser.cookies.remove(details)) removed.push(cookie.name);
        else refused.push(cookie.name);
      } catch (error) {
        refused.push(cookie.name);
      }
    }
    var result = { kind: "cookies", op: "clear", query: query, count: removed.length, removed: removed, matched: all.length };
    if (refused.length) {
      result.failed = refused;
      result.note = "The browser refused to remove " + refused.length + " cookie(s)";
    }
    return result;
  }

  async function run(args, tab) {
    if (args.op === "get") return get(args, tab);
    if (args.op === "set") return set(args, tab);
    if (args.op === "clear") return clear(args, tab);
    throw protocol.error(C.protocolError, "Unknown storage op " + String(args.op), "Use get, set or clear", false);
  }

  async function forTab(tab, cookieStoreId) {
    var store = cookieStoreId || DEFAULT_STORE;
    var out = { storeId: store, url: tab.url || "", count: 0, items: [] };
    if (!protocol.originOf(tab.url)) return out;
    var found = await browser.cookies.getAll({ url: tab.url, storeId: store, partitionKey: ALL_PARTITIONS });
    out.items = found.map(metaRecord);
    out.count = out.items.length;
    return out;
  }

  root.LB = root.LB || {};
  root.LB.cookies = {
    DEFAULT_STORE: DEFAULT_STORE,
    cookieRecord: cookieRecord,
    metaRecord: metaRecord,
    cookieQuery: cookieQuery,
    run: run,
    forTab: forTab
  };
})(globalThis);
