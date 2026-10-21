(function (root) {
  "use strict";

  function styleOf(element) {
    var computed = window.getComputedStyle(element);
    return {
      display: computed.display,
      visibility: computed.visibility,
      opacity: computed.opacity,
      overflowX: computed.overflowX,
      overflowY: computed.overflowY,
      pointerEvents: computed.pointerEvents
    };
  }

  function scrollMetrics(element) {
    return {
      scrollHeight: element.scrollHeight || 0,
      clientHeight: element.clientHeight || 0,
      scrollWidth: element.scrollWidth || 0,
      clientWidth: element.clientWidth || 0
    };
  }

  function rectOf(element) {
    var rect = element.getBoundingClientRect();
    return {
      x: rect.x,
      y: rect.y,
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
      dpr: window.devicePixelRatio || 1
    };
  }

  function cssEscape(value) {
    if (typeof CSS !== "undefined" && typeof CSS.escape === "function") return CSS.escape(value);
    return String(value).replace(/[^a-zA-Z0-9_-]/g, function (character) {
      return "\\" + character;
    });
  }

  function cssPath(element) {
    if (!element || !element.tagName) return null;
    if (element.id) return "#" + cssEscape(element.id);
    var parts = [];
    var node = element;
    while (node && node.nodeType === 1 && parts.length < 8) {
      if (node.id) {
        parts.unshift("#" + cssEscape(node.id));
        break;
      }
      var part = node.tagName.toLowerCase();
      var parent = node.parentElement;
      if (parent) {
        var sameTag = [];
        for (var i = 0; i < parent.children.length; i += 1) {
          if (parent.children[i].tagName === node.tagName) sameTag.push(parent.children[i]);
        }
        if (sameTag.length > 1) part += ":nth-of-type(" + String(sameTag.indexOf(node) + 1) + ")";
      }
      parts.unshift(part);
      node = parent;
    }
    return parts.join(" > ");
  }

  function labelText(element) {
    if (element.labels && element.labels.length) {
      var parts = [];
      for (var i = 0; i < element.labels.length; i += 1) {
        var label = element.labels[i];
        parts.push(label.innerText || label.textContent || "");
      }
      return parts.join(" ");
    }
    var closest = element.closest ? element.closest("label") : null;
    if (!closest) return "";
    return closest.innerText || closest.textContent || "";
  }

  var adapter = {
    url: function () {
      return location.href;
    },
    title: function () {
      return document.title;
    },
    getRoot: function () {
      return document.body || document.documentElement;
    },
    query: function (scope, selector) {
      try {
        return (scope || document).querySelector(selector);
      } catch (error) {
        return null;
      }
    },
    queryAll: function (scope, selector) {
      try {
        return Array.prototype.slice.call((scope || document).querySelectorAll(selector));
      } catch (error) {
        return [];
      }
    },
    children: function (element) {
      return element && element.children ? Array.prototype.slice.call(element.children) : [];
    },
    childNodes: function (element) {
      return element && element.childNodes ? Array.prototype.slice.call(element.childNodes) : [];
    },
    isElement: function (node) {
      return Boolean(node) && node.nodeType === 1;
    },
    isText: function (node) {
      return Boolean(node) && node.nodeType === 3;
    },
    nodeText: function (node) {
      return (node && node.nodeValue) || "";
    },
    tagName: function (element) {
      return element && element.tagName ? element.tagName.toLowerCase() : "";
    },
    attr: function (element, name) {
      if (!element || typeof element.getAttribute !== "function") return null;
      return element.getAttribute(name);
    },
    style: styleOf,
    rect: rectOf,
    isConnected: function (element) {
      return Boolean(element) && element.isConnected === true;
    },
    textOf: function (element) {
      if (!element) return "";
      return element.innerText || element.textContent || "";
    },
    innerText: function (element) {
      if (!element) return "";
      return element.innerText || element.textContent || "";
    },
    innerHTML: function (element) {
      return element ? element.innerHTML || "" : "";
    },
    valueOf: function (element) {
      return element && typeof element.value === "string" ? element.value : "";
    },
    checkedOf: function (element) {
      return Boolean(element) && element.checked === true;
    },
    selectedOf: function (element) {
      return Boolean(element) && element.selected === true;
    },
    disabledOf: function (element) {
      if (!element) return false;
      if (element.disabled === true) return true;
      return element.getAttribute("aria-disabled") === "true";
    },
    labelText: labelText,
    getById: function (id) {
      return document.getElementById(id);
    },
    selectedTexts: function (element) {
      if (!element || !element.selectedOptions) return [];
      return Array.prototype.map.call(element.selectedOptions, function (option) {
        return option.textContent || "";
      });
    },
    cssPath: cssPath,
    rectOf: rectOf,
    scrollMetrics: scrollMetrics
  };

  root.LB = root.LB || {};
  root.LB.dom = { adapter: adapter, cssPath: cssPath, rectOf: rectOf, scrollMetrics: scrollMetrics };
})(globalThis);
