(function (root) {
  "use strict";

  var LB = root.LB;
  var core = LB.bg.core;
  var ERROR = core.ERROR;
  var ToolFailure = core.ToolFailure;
  var URL_HINT = "Pass url, domain, or allDomains, or use a tab on a website";

  function cookieSummary(cookie) {
    var summary = {
      name: cookie.name,
      value: cookie.value,
      domain: cookie.domain,
      path: cookie.path,
      secure: cookie.secure === true,
      httpOnly: cookie.httpOnly === true,
      sameSite: cookie.sameSite || "unspecified",
      session: cookie.session === true,
      hostOnly: cookie.hostOnly === true,
      storeId: cookie.storeId ? String(cookie.storeId) : LB.bg.tabs.REGULAR_STORE
    };
    if (summary.session !== true && typeof cookie.expirationDate === "number") summary.expirationDate = cookie.expirationDate;
    if (cookie.partitionKey && typeof cookie.partitionKey === "object") summary.partitionKey = Object.assign({}, cookie.partitionKey);
    return summary;
  }

  function cookieItem(cookie) {
    var summary = cookieSummary(cookie);
    var item = {
      name: summary.name,
      domain: summary.domain,
      path: summary.path,
      session: summary.session,
      httpOnly: summary.httpOnly,
      secure: summary.secure,
      sameSite: summary.sameSite,
      hostOnly: summary.hostOnly
    };
    if (summary.expirationDate !== undefined) item.expirationDate = summary.expirationDate;
    return item;
  }

  function jarScope(args) {
    return args.allDomains === true || typeof args.domain === "string";
  }

  function cookieQuery(args, tab) {
    var query = {};
    if (args.storeId) query.storeId = args.storeId;
    if (args.name) query.name = args.name;
    if (args.allDomains === true) return query;
    if (typeof args.domain === "string" && args.domain) {
      query.domain = args.domain.replace(/^\./, "");
    } else {
      var url = args.url || tab.url;
      if (!url || !/^https?:/.test(url)) {
        throw new ToolFailure(ERROR.protocolError, "Cookies need an http(s) url or a domain", URL_HINT);
      }
      query.url = url;
    }
    return query;
  }

  function cookieUrlFor(args, tab, entry) {
    if (entry && typeof entry.url === "string" && /^https?:/.test(entry.url)) return entry.url;
    var scheme = entry && entry.secure === false ? "http://" : "https://";
    var domain = (entry && entry.domain) || (typeof args.domain === "string" ? args.domain : "");
    if (domain) return scheme + String(domain).replace(/^\./, "") + ((entry && entry.path) || "/");
    var base = args.url || (tab.url && /^https?:/.test(tab.url) ? tab.url : "");
    if (!base) throw new ToolFailure(ERROR.protocolError, "Cookies need an http(s) url or a domain", URL_HINT);
    if (entry && entry.path) {
      try {
        return new URL(entry.path, base).href;
      } catch (error) {
        return base;
      }
    }
    return base;
  }

  function writeDetails(args, tab, entry) {
    var details = { url: cookieUrlFor(args, tab, entry), name: entry.name, value: entry.value };
    if (entry.storeId || args.storeId) details.storeId = entry.storeId || args.storeId;
    var entryDomain = entry.domain || (typeof args.domain === "string" ? args.domain : "");
    if (entryDomain) details.domain = entryDomain;
    if (typeof entry.path === "string" && entry.path) details.path = entry.path;
    if (typeof entry.secure === "boolean") details.secure = entry.secure;
    if (typeof entry.httpOnly === "boolean") details.httpOnly = entry.httpOnly;
    if (typeof entry.sameSite === "string" && entry.sameSite !== "unspecified") details.sameSite = entry.sameSite;
    if (entry.session !== true && typeof entry.expirationDate === "number") details.expirationDate = entry.expirationDate;
    return details;
  }

  async function getCookies(args, tab) {
    var query = cookieQuery(args, tab);
    var found = (await chrome.cookies.getAll(query)).map(cookieSummary);
    var cookies = typeof args.limit === "number" && args.limit > 0 ? found.slice(0, Math.floor(args.limit)) : found;
    return { kind: "cookies", op: "get", query: query, total: found.length, cookies: cookies };
  }

  async function setCookies(args, tab) {
    var entries = args.entries || [];
    var written = [];
    var failed = [];
    var denied = false;
    for (var index = 0; index < entries.length; index += 1) {
      var entry = entries[index];
      try {
        var cookie = await chrome.cookies.set(writeDetails(args, tab, entry));
        if (cookie) written.push(cookieSummary(cookie));
        else failed.push(entry.name);
      } catch (error) {
        failed.push(entry.name);
        if (core.siteAccessDenied(String((error && error.message) || error))) denied = true;
      }
    }
    var result = { kind: "cookies", op: "set", count: written.length, cookies: written };
    if (failed.length) {
      result.failed = failed;
      result.note = denied
        ? "The browser refused " + failed.length + " cookie(s) because this extension has no site access there yet; ask the user to press Allow all in the Paperclip extension"
        : "The browser refused " + failed.length + " cookie(s); check the domain against the url";
    }
    return result;
  }

  async function clearCookies(args, tab) {
    var query = cookieQuery(args, tab);
    var cookies = await chrome.cookies.getAll(query);
    if (args.allDomains === true && cookies.length > 50 && args.confirmAll !== true && !args.name) {
      throw new ToolFailure(ERROR.protocolError, "Refusing to clear " + cookies.length + " cookies across every site", "Pass a name filter or confirmAll: true");
    }
    var removed = [];
    var failed = [];
    for (var index = 0; index < cookies.length; index += 1) {
      var cookie = cookies[index];
      var host = String(cookie.domain || "").replace(/^\./, "");
      var target = (cookie.secure ? "https://" : "http://") + host + (cookie.path || "/");
      var details = { url: target, name: cookie.name, storeId: cookie.storeId };
      if (cookie.partitionKey) details.partitionKey = cookie.partitionKey;
      try {
        var outcome = await chrome.cookies.remove(details);
        if (outcome) removed.push(cookie.name);
        else failed.push(cookie.name);
      } catch (error) {
        failed.push(cookie.name);
      }
    }
    var result = { kind: "cookies", op: "clear", query: query, count: removed.length, removed: removed, matched: cookies.length };
    if (failed.length) {
      result.failed = failed;
      result.note = "The browser refused to remove " + failed.length + " cookie(s)";
    }
    return result;
  }

  async function toolStorage(args, call) {
    var tab = args.kind === "cookies" && jarScope(args)
      ? await LB.bg.tabs.resolveTab(args).catch(function () {
          return { id: null, url: "" };
        })
      : await LB.bg.tabs.resolveTab(args);
    if (args.kind !== "cookies") return await LB.bg.tabs.rpc(tab.id, "storage", args, call.pageTimeout(10000));
    if (args.op === "get") return await getCookies(args, tab);
    if (args.op === "set") return await setCookies(args, tab);
    return await clearCookies(args, tab);
  }

  async function tabCookies(tab, storeId) {
    var url = tab.url || "";
    var result = { storeId: storeId, url: url, count: 0, items: [] };
    if (!/^https?:/.test(url) || !chrome.cookies || typeof chrome.cookies.getAll !== "function") return result;
    try {
      var found = await chrome.cookies.getAll({ url: url, storeId: storeId });
      result.items = (found || []).map(cookieItem);
      result.count = result.items.length;
    } catch (error) {}
    return result;
  }

  function requirements(args) {
    if (args.kind !== "cookies") return ["<all_urls>", "scripting"];
    return jarScope(args) ? ["cookies", "<all_urls>"] : ["cookies"];
  }

  LB.bg = LB.bg || {};
  LB.bg.cookies = {
    cookieSummary: cookieSummary,
    cookieItem: cookieItem,
    cookieQuery: cookieQuery,
    cookieUrlFor: cookieUrlFor,
    writeDetails: writeDetails,
    toolStorage: toolStorage,
    tabCookies: tabCookies,
    requirements: requirements
  };
})(globalThis);
