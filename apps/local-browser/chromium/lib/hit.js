(function (root) {
  "use strict";

  function contains(outer, inner) {
    if (!outer || !inner || outer === inner) return false;
    if (typeof outer.contains === "function") return outer.contains(inner);
    var node = inner.parentNode;
    while (node) {
      if (node === outer) return true;
      node = node.parentNode;
    }
    return false;
  }

  function hitTestAllows(target, hit) {
    if (!target) return false;
    if (!hit) return false;
    if (hit === target) return true;
    return contains(target, hit);
  }

  function pointInViewport(point, viewport) {
    if (!point || !viewport) return false;
    var width = typeof viewport.width === "number" ? viewport.width : 0;
    var height = typeof viewport.height === "number" ? viewport.height : 0;
    if (!(width > 0) || !(height > 0)) return false;
    return point.x >= 0 && point.y >= 0 && point.x <= width && point.y <= height;
  }

  function hitTestVerdict(target, hit, point, viewport) {
    if (!target) return "missing-target";
    if (hit === undefined) return "allow";
    if (hit && hitTestAllows(target, hit)) return "allow";
    if (!hit) return pointInViewport(point, viewport) ? "covered" : "offscreen";
    return "covered";
  }

  function describeBlock(hit) {
    if (!hit) return "nothing";
    if (hit.tagName && typeof hit.tagName === "string") return hit.tagName.toLowerCase();
    return "another element";
  }

  root.LB = root.LB || {};
  root.LB.hit = {
    hitTestAllows: hitTestAllows,
    hitTestVerdict: hitTestVerdict,
    pointInViewport: pointInViewport,
    contains: contains,
    describeBlock: describeBlock
  };
})(globalThis);
