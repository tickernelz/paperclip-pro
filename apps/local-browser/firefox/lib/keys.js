(function (root) {
  "use strict";

  var NAMED = Object.freeze({
    enter: { key: "Enter", code: "Enter", keyCode: 13, bidi: "\uE007" },
    return: { key: "Enter", code: "Enter", keyCode: 13, bidi: "\uE007" },
    tab: { key: "Tab", code: "Tab", keyCode: 9, bidi: "\uE004" },
    escape: { key: "Escape", code: "Escape", keyCode: 27, bidi: "\uE00C" },
    esc: { key: "Escape", code: "Escape", keyCode: 27, bidi: "\uE00C" },
    backspace: { key: "Backspace", code: "Backspace", keyCode: 8, bidi: "\uE003" },
    delete: { key: "Delete", code: "Delete", keyCode: 46, bidi: "\uE017" },
    insert: { key: "Insert", code: "Insert", keyCode: 45, bidi: "\uE016" },
    arrowup: { key: "ArrowUp", code: "ArrowUp", keyCode: 38, bidi: "\uE013" },
    arrowdown: { key: "ArrowDown", code: "ArrowDown", keyCode: 40, bidi: "\uE015" },
    arrowleft: { key: "ArrowLeft", code: "ArrowLeft", keyCode: 37, bidi: "\uE012" },
    arrowright: { key: "ArrowRight", code: "ArrowRight", keyCode: 39, bidi: "\uE014" },
    up: { key: "ArrowUp", code: "ArrowUp", keyCode: 38, bidi: "\uE013" },
    down: { key: "ArrowDown", code: "ArrowDown", keyCode: 40, bidi: "\uE015" },
    left: { key: "ArrowLeft", code: "ArrowLeft", keyCode: 37, bidi: "\uE012" },
    right: { key: "ArrowRight", code: "ArrowRight", keyCode: 39, bidi: "\uE014" },
    home: { key: "Home", code: "Home", keyCode: 36, bidi: "\uE011" },
    end: { key: "End", code: "End", keyCode: 35, bidi: "\uE010" },
    pageup: { key: "PageUp", code: "PageUp", keyCode: 33, bidi: "\uE00E" },
    pagedown: { key: "PageDown", code: "PageDown", keyCode: 34, bidi: "\uE00F" },
    space: { key: " ", code: "Space", keyCode: 32, bidi: " " },
    shift: { key: "Shift", code: "ShiftLeft", keyCode: 16, bidi: "\uE008", modifier: true },
    control: { key: "Control", code: "ControlLeft", keyCode: 17, bidi: "\uE009", modifier: true },
    ctrl: { key: "Control", code: "ControlLeft", keyCode: 17, bidi: "\uE009", modifier: true },
    alt: { key: "Alt", code: "AltLeft", keyCode: 18, bidi: "\uE00A", modifier: true },
    meta: { key: "Meta", code: "MetaLeft", keyCode: 91, bidi: "\uE03D", modifier: true }
  });

  var PUNCTUATION_CODES = Object.freeze({
    " ": "Space",
    "-": "Minus",
    "=": "Equal",
    "[": "BracketLeft",
    "]": "BracketRight",
    "\\": "Backslash",
    ";": "Semicolon",
    "'": "Quote",
    ",": "Comma",
    ".": "Period",
    "/": "Slash",
    "`": "Backquote",
    "\n": "Enter"
  });

  function codeForCharacter(character) {
    if (PUNCTUATION_CODES[character]) return PUNCTUATION_CODES[character];
    if (/^[a-zA-Z]$/.test(character)) return "Key" + character.toUpperCase();
    if (/^[0-9]$/.test(character)) return "Digit" + character;
    return "";
  }

  function resolve(name) {
    if (typeof name !== "string" || !name) return NAMED.enter;
    var lower = name.toLowerCase();
    if (Object.prototype.hasOwnProperty.call(NAMED, lower)) return NAMED[lower];
    if (name.length === 1) {
      return {
        key: name,
        code: codeForCharacter(name),
        keyCode: name.charCodeAt(0),
        bidi: name,
        printable: true
      };
    }
    return { key: name, code: "", keyCode: 0, bidi: name };
  }

  function bidiValue(name) {
    return resolve(name).bidi;
  }

  root.LB = root.LB || {};
  root.LB.keys = { NAMED: NAMED, resolve: resolve, bidiValue: bidiValue, codeForCharacter: codeForCharacter };
})(globalThis);
