(function (root) {
  "use strict";

  var BUTTONS = Object.freeze({ left: 0, middle: 1, right: 2 });
  var MODIFIERS = Object.freeze(["alt", "ctrl", "meta", "shift"]);
  var MODIFIER_KEYS = Object.freeze({ Shift: "shift", Control: "ctrl", Alt: "alt", Meta: "meta" });
  var MODIFIER_VALUES = Object.freeze({ shift: "\uE008", ctrl: "\uE009", alt: "\uE00A", meta: "\uE03D" });
  var ACTIONS = Object.freeze({ mouse: ["move", "down", "up"], key: ["down", "up"] });
  var COMBO_MODIFIERS = Object.freeze({ control: "ctrl", ctrl: "ctrl", shift: "shift", alt: "alt", option: "alt", meta: "meta", cmd: "meta", command: "meta" });
  var ACT_CLICKS = Object.freeze({ click: 1, check: 1, uncheck: 1, type: 1, dblclick: 2, hover: 0 });
  var TEXT_CHUNK = 64;
  var ENTER = "\uE007";
  var BACKSPACE = "\uE003";

  function clickCountOf(value) {
    var count = typeof value === "number" && Number.isFinite(value) ? Math.round(value) : 1;
    if (count < 1) return 1;
    if (count > 3) return 3;
    return count;
  }

  function buttonOf(value) {
    var name = typeof value === "string" && Object.prototype.hasOwnProperty.call(BUTTONS, value) ? value : "left";
    return { name: name, index: BUTTONS[name] };
  }

  function coordinate(value) {
    var number = Number(value);
    if (!Number.isFinite(number) || number < 0) return 0;
    return Math.round(number);
  }

  function createInputState() {
    var latched = new Set();
    var pointer = null;
    var sequence = 0;

    function modifiersOf(args) {
      var flags = {};
      for (var i = 0; i < MODIFIERS.length; i += 1) {
        var name = MODIFIERS[i];
        flags[name] = (args && args[name] === true) || latched.has(name);
      }
      return flags;
    }

    function takeLatched() {
      var names = [];
      MODIFIERS.forEach(function (name) {
        if (latched.has(name)) names.push(name);
      });
      return names;
    }

    function releaseAll(effects) {
      var released = takeLatched();
      for (var i = 0; i < released.length; i += 1) {
        var name = released[i];
        latched.delete(name);
        effects.push({ type: "keyUp", key: name, code: "", value: MODIFIER_VALUES[name], modifier: name, release: true });
      }
      return released;
    }

    function mouse(args) {
      var button = buttonOf(args.button);
      var clickCount = clickCountOf(args.clickCount);
      var x = coordinate(args.x);
      var y = coordinate(args.y);
      var effects = [];

      if (args.action === "down") {
        sequence += 1;
        pointer = { button: button.name, x: x, y: y, id: sequence };
        effects.push({ type: "pointerDown", x: x, y: y, button: button.name, buttonIndex: button.index, clickCount: clickCount });
        return { kind: "mouse", action: "down", effects: effects, clicked: false, released: [], modifiers: modifiersOf(args) };
      }

      if (args.action === "up") {
        var latchedPointer = pointer;
        pointer = null;
        effects.push({ type: "pointerUp", x: x, y: y, button: button.name, buttonIndex: button.index, clickCount: clickCount });
        var clicked = Boolean(latchedPointer) && latchedPointer.button === button.name;
        if (clicked) effects.push({ type: "click", x: x, y: y, button: button.name, buttonIndex: button.index, clickCount: clickCount });
        var released = releaseAll(effects);
        return { kind: "mouse", action: "up", effects: effects, clicked: clicked, released: released, modifiers: modifiersOf(args) };
      }

      effects.push({ type: "pointerMove", x: x, y: y, button: button.name, buttonIndex: button.index });
      return { kind: "mouse", action: "move", effects: effects, clicked: false, released: [], modifiers: modifiersOf(args) };
    }

    function key(args) {
      var name = String(args.key || "");
      var code = typeof args.code === "string" ? args.code : "";
      var flags = modifiersOf(args);
      var modifier = Object.prototype.hasOwnProperty.call(MODIFIER_KEYS, name) ? MODIFIER_KEYS[name] : null;
      var effects = [];

      if (args.action === "up") {
        if (modifier) latched.delete(modifier);
        effects.push({ type: "keyUp", key: name, code: code, value: MODIFIER_VALUES[modifier] || name, modifier: modifier });
        var released = modifier ? [modifier] : releaseAll(effects);
        return { kind: "key", action: "up", effects: effects, released: released, modifiers: flags };
      }

      if (modifier) latched.add(modifier);
      var text = typeof args.text === "string" ? args.text : "";
      var insert = null;
      if (text) insert = text;
      else if (!modifier && name.length === 1) insert = name;
      effects.push({
        type: "keyDown",
        key: name,
        code: code,
        value: MODIFIER_VALUES[modifier] || name,
        modifier: modifier,
        insert: insert,
        modifiers: flags
      });
      return { kind: "key", action: "down", effects: effects, released: [], modifiers: flags };
    }

    function wheel(args) {
      var x = coordinate(args.x);
      var y = coordinate(args.y);
      var deltaX = Number(args.deltaX);
      var deltaY = Number(args.deltaY);
      return {
        kind: "wheel",
        action: "scroll",
        effects: [
          {
            type: "wheel",
            x: x,
            y: y,
            deltaX: Number.isFinite(deltaX) ? deltaX : 0,
            deltaY: Number.isFinite(deltaY) ? deltaY : 0
          }
        ],
        released: []
      };
    }

    function apply(args) {
      var kind = args && args.kind;
      if (kind === "mouse") {
        if (ACTIONS.mouse.indexOf(args.action) === -1) throw new Error("mouse action must be move, down or up");
        return mouse(args);
      }
      if (kind === "key") {
        if (ACTIONS.key.indexOf(args.action) === -1) throw new Error("key action must be down or up");
        return key(args);
      }
      if (kind === "wheel") return wheel(args);
      throw new Error("input kind must be mouse, key or wheel");
    }

    function reset() {
      latched = new Set();
      pointer = null;
      sequence = 0;
    }

    function latchedModifiers() {
      return takeLatched();
    }

    return { apply: apply, reset: reset, latchedModifiers: latchedModifiers, modifiersOf: modifiersOf };
  }

  function bidiActions(plan) {
    var pointer = [];
    var keyboard = [];
    var wheelActions = [];

    for (var i = 0; i < plan.effects.length; i += 1) {
      var effect = plan.effects[i];
      if (effect.type === "pointerMove") {
        pointer.push({ type: "pointerMove", x: effect.x, y: effect.y, origin: "viewport" });
        continue;
      }
      if (effect.type === "pointerDown") {
        pointer.push({ type: "pointerMove", x: effect.x, y: effect.y, origin: "viewport" });
        pointer.push({ type: "pointerDown", button: effect.buttonIndex });
        continue;
      }
      if (effect.type === "pointerUp") {
        pointer.push({ type: "pointerMove", x: effect.x, y: effect.y, origin: "viewport" });
        pointer.push({ type: "pointerUp", button: effect.buttonIndex });
        continue;
      }
      if (effect.type === "click") {
        continue;
      }
      if (effect.type === "keyDown") {
        keyboard.push({ type: "keyDown", value: effect.value });
        if (effect.insert && effect.insert.length > 1) {
          for (var c = 0; c < effect.insert.length; c += 1) {
            keyboard.push({ type: "keyDown", value: effect.insert[c] });
            keyboard.push({ type: "keyUp", value: effect.insert[c] });
          }
        }
        continue;
      }
      if (effect.type === "keyUp") {
        keyboard.push({ type: "keyUp", value: effect.value });
        continue;
      }
      if (effect.type === "wheel") {
        wheelActions.push({
          type: "scroll",
          x: effect.x,
          y: effect.y,
          deltaX: effect.deltaX,
          deltaY: effect.deltaY,
          origin: "viewport",
          duration: 0
        });
      }
    }

    var sources = [];
    if (pointer.length) sources.push({ type: "pointer", id: "mouse", parameters: { pointerType: "mouse" }, actions: pointer });
    if (keyboard.length) sources.push({ type: "key", id: "keyboard", actions: keyboard });
    if (wheelActions.length) sources.push({ type: "wheel", id: "wheel", actions: wheelActions });
    return sources;
  }

  function parseCombo(text) {
    var value = String(text || "");
    var parts = value.length > 1 ? value.split("+") : [value];
    var key = parts.pop();
    if (key === "" && parts.length) {
      parts.pop();
      key = "+";
    }
    var modifiers = [];
    for (var i = 0; i < parts.length; i += 1) {
      var name = COMBO_MODIFIERS[parts[i].toLowerCase()];
      if (!name) return { key: value, modifiers: [] };
      if (modifiers.indexOf(name) === -1) modifiers.push(name);
    }
    return { key: key, modifiers: modifiers };
  }

  function keySource(actions) {
    return [{ type: "key", id: "keyboard", actions: actions }];
  }

  function tap(value) {
    return [
      { type: "keyDown", value: value },
      { type: "keyUp", value: value }
    ];
  }

  function comboActions(text) {
    var combo = parseCombo(text);
    var down = combo.modifiers.map(function (name) {
      return { type: "keyDown", value: MODIFIER_VALUES[name] };
    });
    var up = combo.modifiers
      .slice()
      .reverse()
      .map(function (name) {
        return { type: "keyUp", value: MODIFIER_VALUES[name] };
      });
    return down.concat(tap(root.LB.keys.bidiValue(combo.key)), up);
  }

  function pointerSource(x, y, clicks) {
    var actions = [{ type: "pointerMove", x: Math.round(x), y: Math.round(y), origin: "viewport" }];
    for (var count = 0; count < clicks; count += 1) {
      actions.push({ type: "pointerDown", button: BUTTONS.left });
      actions.push({ type: "pointerUp", button: BUTTONS.left });
    }
    return [{ type: "pointer", id: "mouse", parameters: { pointerType: "mouse" }, actions: actions }];
  }

  function textBatches(text) {
    var characters = Array.from(text);
    var batches = [];
    for (var start = 0; start < characters.length; start += TEXT_CHUNK) {
      var actions = [];
      characters.slice(start, start + TEXT_CHUNK).forEach(function (character) {
        if (character === "\r") return;
        actions = actions.concat(tap(character === "\n" ? ENTER : character));
      });
      if (actions.length) batches.push(keySource(actions));
    }
    return batches;
  }

  function actBatches(args, target, mac) {
    if (args.action === "press") return [keySource(comboActions(args.key))];
    if (target.done === true) return [];
    var batches = [pointerSource(target.x, target.y, ACT_CLICKS[args.action] || 0)];
    if (args.action !== "type") return batches;
    var modifier = mac ? MODIFIER_VALUES.meta : MODIFIER_VALUES.ctrl;
    batches.push(keySource([{ type: "keyDown", value: modifier }].concat(tap("a"), [{ type: "keyUp", value: modifier }])));
    var text = args.text === undefined || args.text === null ? "" : String(args.text);
    batches = batches.concat(text.length ? textBatches(text) : [keySource(tap(BACKSPACE))]);
    if (args.submit === true) batches.push(keySource(tap(ENTER)));
    return batches;
  }

  root.LB = root.LB || {};
  root.LB.input = {
    TEXT_CHUNK: TEXT_CHUNK,
    parseCombo: parseCombo,
    actBatches: actBatches,
    BUTTONS: BUTTONS,
    MODIFIERS: MODIFIERS,
    MODIFIER_KEYS: MODIFIER_KEYS,
    MODIFIER_VALUES: MODIFIER_VALUES,
    clickCountOf: clickCountOf,
    buttonOf: buttonOf,
    createInputState: createInputState,
    bidiActions: bidiActions
  };
})(globalThis);
