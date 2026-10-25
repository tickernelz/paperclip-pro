(function (root) {
  "use strict";

  var DEFAULT_PORT = 9222;

  var BROWSERS = {
    firefox: {
      label: "Firefox",
      names: ["firefox", "mozilla firefox"],
      windows: "C:\\Program Files\\Mozilla Firefox\\firefox.exe",
      mac: "Firefox",
      linux: "firefox",
      flatpak: "org.mozilla.firefox",
      snap: "firefox",
      desktop: "firefox.desktop",
      search: "firefox"
    },
    "firefox-developer": {
      label: "Firefox Developer Edition",
      names: ["firefox developer edition", "firefoxdeveloperedition", "firefox-developer-edition"],
      windows: "C:\\Program Files\\Firefox Developer Edition\\firefox.exe",
      mac: "Firefox Developer Edition",
      linux: "firefox-developer-edition",
      flatpak: "",
      snap: "",
      desktop: "firefox-developer-edition.desktop",
      search: "firefox"
    },
    "firefox-nightly": {
      label: "Firefox Nightly",
      names: ["firefox nightly", "nightly"],
      windows: "C:\\Program Files\\Firefox Nightly\\firefox.exe",
      mac: "Firefox Nightly",
      linux: "firefox-nightly",
      flatpak: "",
      snap: "",
      desktop: "firefox-nightly.desktop",
      search: "nightly"
    },
    zen: {
      label: "Zen",
      names: ["zen", "zen browser"],
      windows: "C:\\Program Files\\Zen Browser\\zen.exe",
      mac: "Zen",
      linux: "zen-browser",
      flatpak: "app.zen_browser.zen",
      snap: "",
      desktop: "zen.desktop",
      search: "zen"
    },
    librewolf: {
      label: "LibreWolf",
      names: ["librewolf"],
      windows: "C:\\Program Files\\LibreWolf\\librewolf.exe",
      mac: "LibreWolf",
      linux: "librewolf",
      flatpak: "io.gitlab.librewolf-community",
      snap: "",
      desktop: "librewolf.desktop",
      search: "librewolf"
    },
    waterfox: {
      label: "Waterfox",
      names: ["waterfox"],
      windows: "C:\\Program Files\\Waterfox\\waterfox.exe",
      mac: "Waterfox",
      linux: "waterfox",
      flatpak: "net.waterfox.waterfox",
      snap: "",
      desktop: "waterfox.desktop",
      search: "waterfox"
    },
    floorp: {
      label: "Floorp",
      names: ["floorp"],
      windows: "C:\\Program Files\\Ablaze Floorp\\floorp.exe",
      mac: "Floorp",
      linux: "floorp",
      flatpak: "one.ablaze.floorp",
      snap: "",
      desktop: "floorp.desktop",
      search: "floorp"
    },
    other: {
      label: "Other Firefox-based browser",
      noun: "the browser",
      names: [],
      windows: "",
      mac: "",
      linux: "",
      flatpak: "",
      snap: "",
      desktop: "",
      search: ""
    }
  };

  var BROWSER_KEYS = Object.keys(BROWSERS);

  var OSES = [
    { key: "windows", label: "Windows" },
    { key: "macos", label: "macOS" },
    { key: "linux", label: "Linux" }
  ];

  var LOCATE_DIRS = "/usr/share/applications /var/lib/flatpak/exports/share/applications ~/.local/share/flatpak/exports/share/applications /var/lib/snapd/desktop/applications";

  function text(value) {
    return typeof value === "string" ? value : "";
  }

  function osKey(value) {
    return value === "windows" || value === "macos" || value === "linux" ? value : "linux";
  }

  function browserKey(value) {
    return Object.prototype.hasOwnProperty.call(BROWSERS, value) ? value : "other";
  }

  function detect(browserInfo, platformInfo) {
    var platform = platformInfo && typeof platformInfo === "object" ? text(platformInfo.os) : "";
    var os = platform === "win" ? "windows" : platform === "mac" ? "macos" : "linux";
    var info = browserInfo && typeof browserInfo === "object" ? browserInfo : {};
    var name = text(info.name).trim().toLowerCase();
    var browser = "other";
    for (var i = 0; i < BROWSER_KEYS.length; i += 1) {
      if (BROWSERS[BROWSER_KEYS[i]].names.indexOf(name) !== -1) {
        browser = BROWSER_KEYS[i];
        break;
      }
    }
    if (browser === "firefox" && text(info.version).indexOf("a") !== -1) browser = "firefox-nightly";
    return { os: os, browser: browser };
  }

  function installs(os, browser) {
    var entry = BROWSERS[browserKey(browser)];
    var target = osKey(os);
    var list = [];
    if (target === "windows") {
      if (entry.windows) list.push({ key: "default", label: "Default location" });
    } else if (target === "macos") {
      if (entry.mac) list.push({ key: "default", label: "Applications folder" });
    } else {
      if (entry.linux) list.push({ key: "default", label: "Package" });
      list.push({ key: "flatpak", label: "Flatpak" });
      if (entry.snap) list.push({ key: "snap", label: "Snap" });
    }
    list.push({ key: "custom", label: "Custom path" });
    return list;
  }

  function defaultInstall(os, browser) {
    return installs(os, browser)[0].key;
  }

  function cleanPath(value) {
    var trimmed = text(value).trim();
    var quoted = /^(["'])(.*)\1$/.exec(trimmed);
    return quoted ? quoted[2].trim() : trimmed;
  }

  function shQuote(value) {
    return '"' + String(value).replace(/(["\\$`])/g, "\\$1") + '"';
  }

  function psQuote(value) {
    return '"' + String(value).replace(/([`$"])/g, "`$1") + '"';
  }

  function cmdQuote(value) {
    return '"' + String(value) + '"';
  }

  function desktopQuote(value) {
    return '"' + String(value).replace(/\\/g, "\\\\\\\\").replace(/(["`$])/g, "\\\\$1").replace(/%/g, "%%") + '"';
  }

  function portOf(value) {
    var port = typeof value === "number" ? value : Number(value);
    return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : DEFAULT_PORT;
  }

  function flags(port, origin, profile, quote) {
    var out = "--remote-debugging-port " + port + " --remote-allow-origins " + origin;
    if (profile) out += " -P " + quote(profile);
    return out;
  }

  function slug(entry, key) {
    if (key === "other") return "Browser";
    return entry.label.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");
  }

  function baseName(value) {
    var parts = String(value).split(/[\\/]/).filter(Boolean);
    var last = parts.length ? parts[parts.length - 1] : "";
    return last.replace(/\.(exe|app)$/i, "");
  }

  function quitSteps(os, label) {
    if (os === "windows") {
      return [
        "Close every " + label + " window.",
        "Check the system tray next to the clock: if " + label + " still has an icon there, right-click it and choose Exit. In Task Manager no " + label + " process should be left."
      ];
    }
    if (os === "macos") {
      return [
        "Switch to " + label + " and press Cmd+Q. Closing the window with the red button is not enough: the app keeps running.",
        "Its icon in the Dock should no longer show a dot underneath."
      ];
    }
    return [
      "Close every " + label + " window.",
      "Wait a few seconds so the browser process can exit before you start it again."
    ];
  }

  function notes(input) {
    var list = [
      "While remote control is on, the address bar turns striped and shows a robot icon. That is normal.",
      "Only programs on this computer can reach the port: the browser listens on 127.0.0.1 only.",
      "The moz-extension address in the command is unique to this browser profile. After reinstalling the extension, copy the command again.",
      "To stop, quit the browser and start it the normal way.",
      "If another program already uses port " + input.port + ", pick another port above and the commands update."
    ];
    if (input.install !== "custom") {
      list.push("Default locations are the typical install locations, not guaranteed. If the command reports that the file is not found, choose Custom path and paste the Application Binary row from about:support.");
    }
    if (input.profile) {
      list.push("-P starts the profile named \"" + input.profile + "\". Use the profile where this extension is installed, because the extension address differs per profile.");
    }
    return list;
  }

  function pathField(os, install, entry) {
    var hint = "Open about:support in this browser and copy the Application Binary row.";
    if (install === "custom") {
      var placeholder = os === "windows"
        ? "C:\\Program Files\\Mozilla Firefox\\firefox.exe"
        : os === "macos"
          ? "/Applications/Firefox.app/Contents/MacOS/firefox"
          : "/usr/lib/firefox/firefox";
      return { label: "Path to the browser program", placeholder: placeholder, hint: hint };
    }
    if (install === "flatpak" && !entry.flatpak) {
      return {
        label: "Flatpak app ID",
        placeholder: "org.example.Browser",
        hint: "Run flatpak list --app | grep -i " + (entry.search || "browser") + " in a terminal and copy the Application ID column."
      };
    }
    return null;
  }

  function windowsPlan(input, entry) {
    var exe = input.install === "custom" ? cleanPath(input.customPath) : entry.windows;
    if (!exe) return { missing: "Paste the path to the browser program to get the command." };
    var target = cmdQuote(exe) + " " + flags(input.port, input.origin, input.profile, cmdQuote);
    return {
      run: { shell: "PowerShell", command: "& " + psQuote(exe) + " " + flags(input.port, input.origin, input.profile, psQuote) },
      alt: { label: "Command Prompt", command: target },
      permanent: {
        title: "Start it this way every time",
        steps: [
          { text: "Right-click the " + (entry.noun ? "browser" : entry.label) + " shortcut on the desktop and choose Properties. For the Start menu entry: right-click it, choose More, then Open file location, and right-click the shortcut there." },
          { text: "On the Shortcut tab, replace the whole Target field with the line below and press OK.", command: target },
          { text: "Pinned to the taskbar? Right-click the taskbar icon, right-click " + (entry.noun ? "the browser name" : entry.label) + " in the menu that opens, choose Properties and change Target the same way." }
        ],
        command: target
      }
    };
  }

  function printfFormat(line) {
    return ("#!/bin/sh\\n" + line.replace(/\\/g, "\\\\").replace(/%/g, "%%") + "\\n").replace(/'/g, "'\\''");
  }

  function macPlan(input, entry, key) {
    var app = "";
    var binary = "";
    if (input.install === "custom") {
      var path = cleanPath(input.customPath);
      var at = path.indexOf(".app/");
      if (at !== -1) app = path.slice(0, at + 4);
      else if (/\.app$/.test(path)) app = path;
      else binary = path;
    } else {
      app = entry.mac;
    }
    if (!app && !binary) return { missing: "Paste the path to the browser program to get the command." };
    var command = app
      ? "open -a " + shQuote(app) + " --args " + flags(input.port, input.origin, input.profile, shQuote)
      : shQuote(binary) + " " + flags(input.port, input.origin, input.profile, shQuote);
    var file = "~/Desktop/" + slug(entry, key) + "-Paperclip.command";
    var save = "printf '" + printfFormat(command) + "' > " + file + " && chmod +x " + file;
    return {
      run: { shell: "Terminal", command: command },
      permanent: {
        title: "Start it this way every time",
        steps: [
          { text: "Run this once in Terminal. It saves a small script on your Desktop.", command: save },
          { text: "From now on, quit the browser and double-click " + file.slice(10) + " instead of the Dock icon. Drag it to the right side of the Dock to keep it handy." },
          { text: "The first time, macOS may ask you to confirm opening it." }
        ],
        command: save
      }
    };
  }

  function sedArgs(value) {
    return value.replace(/\\/g, "\\\\").replace(/&/g, "\\&").replace(/\|/g, "\\|").replace(/'/g, "'\\''");
  }

  function linuxPlan(input, entry, key) {
    var kind = input.install;
    var path = cleanPath(input.customPath);
    var flatpakId = "";
    var snapName = "";
    var binary = "";
    var named = false;
    if (kind === "flatpak") {
      flatpakId = path && path.indexOf("/") === -1 ? path : entry.flatpak;
    } else if (kind === "snap") {
      snapName = entry.snap || "firefox";
    } else if (kind === "custom") {
      if (path.indexOf("/app/") === 0) {
        kind = "flatpak";
        flatpakId = entry.flatpak;
        if (!flatpakId) {
          return {
            missing: "This path is inside a Flatpak. Run flatpak list --app | grep -i " + (entry.search || "browser") + " in a terminal, then choose Install type Flatpak and paste the Application ID."
          };
        }
      } else if (path.indexOf("/snap/") === 0) {
        kind = "snap";
        var parts = path.split("/").filter(Boolean);
        snapName = parts[1] === "bin" ? parts[2] || "" : parts[1] || "";
      } else {
        binary = path;
      }
    } else {
      binary = entry.linux;
      named = true;
    }
    if (kind === "flatpak" && !flatpakId) return { missing: "Paste the Flatpak app ID to get the command." };
    if (kind === "snap" && !snapName) return { missing: "Paste the path to the browser program to get the command." };
    if ((kind === "default" || kind === "custom") && !binary) return { missing: "Paste the path to the browser program to get the command." };
    var args = flags(input.port, input.origin, input.profile, shQuote);
    var command;
    if (kind === "flatpak") command = "flatpak run " + flatpakId + " " + args;
    else if (kind === "snap") command = "snap run " + snapName + " " + args;
    else command = (named ? binary : shQuote(binary)) + " " + args;

    var desktopArgs = sedArgs(flags(input.port, input.origin, input.profile, desktopQuote));
    var dir;
    var file;
    var expression;
    var search;
    if (kind === "flatpak") {
      dir = "/var/lib/flatpak/exports/share/applications";
      file = flatpakId + ".desktop";
      expression = "s|^\\(Exec=.*\\)$|\\1 " + desktopArgs + "|";
      search = entry.search || flatpakId.split(".").pop();
    } else if (kind === "snap") {
      dir = "/var/lib/snapd/desktop/applications";
      file = snapName + "_" + snapName + ".desktop";
      expression = "s|^\\(Exec=.*/snap/bin/" + snapName + "\\)|\\1 " + desktopArgs + "|";
      search = snapName;
    } else {
      dir = "/usr/share/applications";
      search = entry.search || baseName(binary).toLowerCase();
      file = entry.desktop || search + ".desktop";
      expression = "s|^Exec=\\([^ ]*\\)|Exec=\\1 " + desktopArgs + "|";
    }
    var locate = "ls " + LOCATE_DIRS + " 2>/dev/null | grep -i " + search;
    var local = "~/.local/share/applications/" + file;
    var copy = "mkdir -p ~/.local/share/applications && cp " + dir + "/" + file + " ~/.local/share/applications/ && sed -i '" + expression + "' " + local;
    return {
      run: { shell: "Terminal", command: command },
      permanent: {
        title: "Start it this way every time",
        steps: [
          { text: "Find the launcher file. It is usually " + file + "; if this prints another name or folder, use that in the next command.", command: locate },
          { text: "Copy the launcher into your own applications folder and add the flags to every Exec line:", command: copy },
          { text: "Start " + (entry.noun || entry.label) + " from the app menu or dock as usual. If it still starts without the flags, log out and back in so the desktop reloads its launchers. Delete " + local + " to undo." }
        ],
        command: copy
      }
    };
  }

  function plan(options) {
    var source = options && typeof options === "object" ? options : {};
    var os = osKey(source.os);
    var key = browserKey(source.browser);
    var entry = BROWSERS[key];
    var allowed = installs(os, key).map(function (item) { return item.key; });
    var install = allowed.indexOf(source.install) !== -1 ? source.install : allowed[0];
    var profile = text(source.profile).trim();
    var input = {
      install: install,
      customPath: text(source.customPath),
      profile: profile,
      port: portOf(source.port),
      origin: text(source.origin).trim() || "moz-extension://"
    };
    var warnings = [];
    if (profile.indexOf('"') !== -1) {
      warnings.push("Profile names with double quotes cannot be passed safely. Rename the profile in about:profiles.");
      input.profile = profile.replace(/"/g, "");
    }
    if (!text(source.origin).trim()) warnings.push("The extension address is missing. Reopen this page from the extension.");
    var built = os === "windows" ? windowsPlan(input, entry) : os === "macos" ? macPlan(input, entry, key) : linuxPlan(input, entry, key);
    return {
      os: os,
      browser: key,
      label: entry.label,
      install: install,
      installs: installs(os, key),
      args: flags(input.port, input.origin, input.profile, shQuote),
      quit: quitSteps(os, entry.noun || entry.label),
      run: built.run || null,
      alt: built.alt || null,
      permanent: built.permanent || null,
      notes: notes(input),
      needsPath: !built.run,
      missing: built.missing || "",
      path: pathField(os, install, entry),
      warnings: warnings
    };
  }

  root.LB = root.LB || {};
  root.LB.launch = {
    DEFAULT_PORT: DEFAULT_PORT,
    BROWSERS: BROWSERS,
    BROWSER_KEYS: BROWSER_KEYS,
    OSES: OSES,
    detect: detect,
    installs: installs,
    defaultInstall: defaultInstall,
    plan: plan
  };
})(globalThis);
