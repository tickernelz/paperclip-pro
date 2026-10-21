(function (root) {
  "use strict";

  var COORDINATE_SPACE = "css-pixels";
  var TOLERANCE = 1;

  function positive(value) {
    var number = Number(value);
    if (!Number.isFinite(number) || number <= 0) return null;
    return number;
  }

  function ratio(value) {
    var number = positive(value);
    if (number === null) return null;
    if (number < 0.1 || number > 16) return null;
    return number;
  }

  function frameGeometry(input) {
    var source = input || {};
    var dpr = ratio(source.dpr);
    var cssWidth = positive(source.cssWidth);
    var cssHeight = positive(source.cssHeight);
    var bitmapWidth = positive(source.bitmapWidth);
    var bitmapHeight = positive(source.bitmapHeight);

    if (bitmapWidth !== null && bitmapHeight !== null && dpr !== null) {
      var scaledWidth = Math.round(bitmapWidth / dpr);
      var scaledHeight = Math.round(bitmapHeight / dpr);
      var consistent =
        cssWidth === null ||
        cssHeight === null ||
        (Math.abs(scaledWidth - Math.round(cssWidth)) <= TOLERANCE && Math.abs(scaledHeight - Math.round(cssHeight)) <= TOLERANCE);
      if (consistent) {
        return { width: scaledWidth, height: scaledHeight, dpr: dpr, source: "bitmap", coordinateSpace: COORDINATE_SPACE };
      }
      if (cssWidth !== null && cssHeight !== null) {
        return {
          width: Math.round(cssWidth),
          height: Math.round(cssHeight),
          dpr: dpr,
          source: "viewport",
          coordinateSpace: COORDINATE_SPACE,
          note: "The capture was " + bitmapWidth + "x" + bitmapHeight + " at dpr " + dpr + ", which does not match the viewport"
        };
      }
      return { width: scaledWidth, height: scaledHeight, dpr: dpr, source: "bitmap", coordinateSpace: COORDINATE_SPACE };
    }

    if (cssWidth !== null && cssHeight !== null) {
      return {
        width: Math.round(cssWidth),
        height: Math.round(cssHeight),
        dpr: dpr === null ? 1 : dpr,
        source: "viewport",
        coordinateSpace: COORDINATE_SPACE
      };
    }

    if (bitmapWidth !== null && bitmapHeight !== null) {
      return { width: Math.round(bitmapWidth), height: Math.round(bitmapHeight), dpr: 1, source: "bitmap", coordinateSpace: COORDINATE_SPACE };
    }

    return null;
  }

  root.LB = root.LB || {};
  root.LB.frames = {
    COORDINATE_SPACE: COORDINATE_SPACE,
    TOLERANCE: TOLERANCE,
    frameGeometry: frameGeometry
  };
})(globalThis);
