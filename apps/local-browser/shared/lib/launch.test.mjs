import test from "node:test";
import assert from "node:assert/strict";
import { loadShared } from "./test-ext.mjs";

const { launch } = loadShared(["lib/launch.js"]).LB;

const ORIGIN = "moz-extension://0a1b2c3d-1111-2222-3333-444455556666";
const ARGS = "--remote-debugging-port 9333 --remote-allow-origins " + ORIGIN;

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function plan(input) {
  return plain(launch.plan({ port: 9333, origin: ORIGIN, ...input }));
}

test("detect maps getBrowserInfo and getPlatformInfo to a browser and OS", () => {
  const cases = [
    [{ name: "Firefox", version: "158.0" }, { os: "win" }, "firefox", "windows"],
    [{ name: "Firefox", version: "160.0a1" }, { os: "mac" }, "firefox-nightly", "macos"],
    [{ name: "Firefox", version: "158.0b4" }, { os: "linux" }, "firefox", "linux"],
    [{ name: "Zen", version: "1.17b" }, { os: "win" }, "zen", "windows"],
    [{ name: "LibreWolf", version: "158.0-1" }, { os: "linux" }, "librewolf", "linux"],
    [{ name: "Waterfox", version: "6.5" }, { os: "openbsd" }, "waterfox", "linux"],
    [{ name: "Floorp", version: "12.0" }, { os: "android" }, "floorp", "linux"],
    [{ name: "Mystery Fox", version: "1.0a" }, { os: "mac" }, "other", "macos"],
    [null, null, "other", "linux"],
  ];
  for (const [info, platform, browser, os] of cases) {
    assert.deepEqual(plain(launch.detect(info, platform)), { os, browser }, JSON.stringify(info));
  }
});

test("the browser table carries the documented typical locations", () => {
  const table = plain(launch.BROWSERS);
  assert.deepEqual(plain(launch.BROWSER_KEYS), ["firefox", "firefox-developer", "firefox-nightly", "zen", "librewolf", "waterfox", "floorp", "other"]);
  assert.deepEqual(
    Object.fromEntries(Object.entries(table).map(([key, entry]) => [key, [entry.windows, entry.mac, entry.linux, entry.flatpak, entry.snap]])),
    {
      firefox: ["C:\\Program Files\\Mozilla Firefox\\firefox.exe", "Firefox", "firefox", "org.mozilla.firefox", "firefox"],
      "firefox-developer": ["C:\\Program Files\\Firefox Developer Edition\\firefox.exe", "Firefox Developer Edition", "firefox-developer-edition", "", ""],
      "firefox-nightly": ["C:\\Program Files\\Firefox Nightly\\firefox.exe", "Firefox Nightly", "firefox-nightly", "", ""],
      zen: ["C:\\Program Files\\Zen Browser\\zen.exe", "Zen", "zen-browser", "app.zen_browser.zen", ""],
      librewolf: ["C:\\Program Files\\LibreWolf\\librewolf.exe", "LibreWolf", "librewolf", "io.gitlab.librewolf-community", ""],
      waterfox: ["C:\\Program Files\\Waterfox\\waterfox.exe", "Waterfox", "waterfox", "net.waterfox.waterfox", ""],
      floorp: ["C:\\Program Files\\Ablaze Floorp\\floorp.exe", "Floorp", "floorp", "one.ablaze.floorp", ""],
      other: ["", "", "", "", ""],
    }
  );
});

test("install types depend on the OS and browser", () => {
  const keys = (os, browser) => plain(launch.installs(os, browser)).map((item) => item.key);
  assert.deepEqual(keys("windows", "zen"), ["default", "custom"]);
  assert.deepEqual(keys("macos", "zen"), ["default", "custom"]);
  assert.deepEqual(keys("linux", "firefox"), ["default", "flatpak", "snap", "custom"]);
  assert.deepEqual(keys("linux", "librewolf"), ["default", "flatpak", "custom"]);
  assert.deepEqual(keys("windows", "other"), ["custom"]);
  assert.deepEqual(keys("macos", "other"), ["custom"]);
  assert.deepEqual(keys("linux", "other"), ["flatpak", "custom"]);
  assert.equal(plain(launch.installs("macos", "zen"))[0].label, "Applications folder");
  assert.equal(plain(launch.installs("linux", "zen"))[0].label, "Package");
  assert.equal(launch.defaultInstall("linux", "other"), "flatpak");
  assert.equal(plan({ os: "windows", browser: "zen", install: "snap" }).install, "default");
});

test("every OS x browser x install combination yields a usable plan", () => {
  for (const os of ["windows", "macos", "linux"]) {
    for (const browser of launch.BROWSER_KEYS) {
      const entry = launch.BROWSERS[browser];
      for (const { key: install } of plain(launch.installs(os, browser))) {
        const label = os + "/" + browser + "/" + install;
        const result = plan({ os, browser, install });
        assert.equal(result.install, install, label);
        assert.equal(result.args, ARGS, label);
        assert.ok(result.quit.length >= 2, label);
        assert.ok(result.notes.length >= 5, label);
        assert.deepEqual(result.warnings, [], label);
        const blank = install === "custom" || (install === "flatpak" && !entry.flatpak);
        if (blank) {
          assert.equal(result.needsPath, true, label);
          assert.equal(result.run, null, label);
          assert.equal(result.permanent, null, label);
          assert.ok(result.missing, label);
          assert.ok(result.path && result.path.label && result.path.hint, label);
          continue;
        }
        assert.equal(result.needsPath, false, label);
        assert.equal(result.missing, "", label);
        assert.equal(result.path, null, label);
        assert.ok(result.run.command.endsWith(" " + ARGS), label + ": " + result.run.command);
        assert.ok(result.permanent.title && result.permanent.steps.length >= 2 && result.permanent.command, label);
        if (os === "windows") {
          assert.equal(result.run.shell, "PowerShell", label);
          assert.equal(result.run.command, "& \"" + entry.windows + "\" " + ARGS, label);
          assert.deepEqual(result.alt, { label: "Command Prompt", command: "\"" + entry.windows + "\" " + ARGS }, label);
          assert.equal(result.permanent.command, result.alt.command, label);
        } else if (os === "macos") {
          assert.equal(result.run.shell, "Terminal", label);
          assert.equal(result.alt, null, label);
          assert.equal(result.run.command, "open -a \"" + entry.mac + "\" --args " + ARGS, label);
          const file = "~/Desktop/" + entry.label.replace(/ /g, "-") + "-Paperclip.command";
          assert.equal(result.permanent.command, "printf '#!/bin/sh\\n" + result.run.command + "\\n' > " + file + " && chmod +x " + file, label);
        } else {
          assert.equal(result.run.shell, "Terminal", label);
          assert.equal(result.alt, null, label);
          const expected = install === "flatpak" ? "flatpak run " + entry.flatpak : install === "snap" ? "snap run firefox" : entry.linux;
          assert.equal(result.run.command, expected + " " + ARGS, label);
          assert.match(result.permanent.steps[0].command, /^ls \/usr\/share\/applications \/var\/lib\/flatpak\/exports\/share\/applications ~\/\.local\/share\/flatpak\/exports\/share\/applications .* 2>\/dev\/null \| grep -i \S+$/, label);
          assert.match(result.permanent.command, /^mkdir -p ~\/\.local\/share\/applications && cp \S+\.desktop ~\/\.local\/share\/applications\/ && sed -i '.*' ~\/\.local\/share\/applications\/\S+\.desktop$/, label);
        }
      }
    }
  }
});

test("the four reference commands are exact", () => {
  assert.equal(plan({ os: "windows", browser: "zen", install: "default" }).run.command, "& \"C:\\Program Files\\Zen Browser\\zen.exe\" " + ARGS);
  assert.equal(plan({ os: "macos", browser: "firefox", install: "default" }).run.command, "open -a \"Firefox\" --args " + ARGS);
  const flat = plan({ os: "linux", browser: "librewolf", install: "flatpak" });
  assert.equal(flat.run.command, "flatpak run io.gitlab.librewolf-community " + ARGS);
  assert.equal(
    flat.permanent.command,
    "mkdir -p ~/.local/share/applications && cp /var/lib/flatpak/exports/share/applications/io.gitlab.librewolf-community.desktop ~/.local/share/applications/ && sed -i 's|^\\(Exec=.*\\)$|\\1 " + ARGS + "|' ~/.local/share/applications/io.gitlab.librewolf-community.desktop"
  );
  const custom = plan({ os: "windows", browser: "other", install: "custom", customPath: "\"D:\\Portable Apps\\My Fox\\fox.exe\"", profile: "Work Stuff" });
  assert.equal(custom.run.command, "& \"D:\\Portable Apps\\My Fox\\fox.exe\" " + ARGS + " -P \"Work Stuff\"");
  assert.equal(custom.alt.command, "\"D:\\Portable Apps\\My Fox\\fox.exe\" " + ARGS + " -P \"Work Stuff\"");
  assert.equal(custom.permanent.command, custom.alt.command);
});

test("Windows steps explain the shortcut Target and PowerShell escapes $ and backticks", () => {
  const result = plan({ os: "windows", browser: "firefox" });
  const steps = result.permanent.steps.map((step) => step.text).join(" ");
  assert.match(steps, /Properties/);
  assert.match(steps, /Shortcut tab/);
  assert.match(steps, /Target/);
  assert.match(steps, /taskbar/);
  assert.equal(result.permanent.steps[1].command, result.permanent.command);
  assert.match(result.quit.join(" "), /tray/);
  const odd = plan({ os: "windows", browser: "other", install: "custom", customPath: "C:\\Apps\\$fox`x\\fox.exe" });
  assert.equal(odd.run.command, "& \"C:\\Apps\\`$fox``x\\fox.exe\" " + ARGS);
  assert.equal(odd.alt.command, "\"C:\\Apps\\$fox`x\\fox.exe\" " + ARGS);
});

test("macOS custom paths use the .app bundle or the binary", () => {
  const bundle = plan({ os: "macos", browser: "firefox-nightly", install: "custom", customPath: "/Applications/Firefox Nightly.app/Contents/MacOS/firefox" });
  assert.equal(bundle.run.command, "open -a \"/Applications/Firefox Nightly.app\" --args " + ARGS);
  assert.equal(bundle.permanent.command, "printf '#!/bin/sh\\nopen -a \"/Applications/Firefox Nightly.app\" --args " + ARGS + "\\n' > ~/Desktop/Firefox-Nightly-Paperclip.command && chmod +x ~/Desktop/Firefox-Nightly-Paperclip.command");
  assert.equal(plan({ os: "macos", browser: "zen", install: "custom", customPath: "~/Apps/Zen.app" }).run.command, "open -a \"~/Apps/Zen.app\" --args " + ARGS);
  const binary = plan({ os: "macos", browser: "other", install: "custom", customPath: "/opt/it's 100%/fox" });
  assert.equal(binary.run.command, "\"/opt/it's 100%/fox\" " + ARGS);
  assert.equal(binary.permanent.command, "printf '#!/bin/sh\\n\"/opt/it'\\''s 100%%/fox\" " + ARGS + "\\n' > ~/Desktop/Browser-Paperclip.command && chmod +x ~/Desktop/Browser-Paperclip.command");
  assert.match(plan({ os: "macos", browser: "firefox" }).quit.join(" "), /Cmd\+Q.*red button is not enough/);
});

test("Linux custom paths detect Flatpak and Snap installs", () => {
  const flatpak = plan({ os: "linux", browser: "zen", install: "custom", customPath: "/app/zen/zen" });
  assert.equal(flatpak.run.command, "flatpak run app.zen_browser.zen " + ARGS);
  assert.match(flatpak.permanent.command, /sed -i 's\|\^\\\(Exec=\.\*\\\)\$\|/);
  const unknown = plan({ os: "linux", browser: "firefox-developer", install: "custom", customPath: "/app/lib/firefox/firefox" });
  assert.equal(unknown.needsPath, true);
  assert.equal(unknown.run, null);
  assert.match(unknown.missing, /flatpak list --app \| grep -i firefox/);
  const flatpakId = plan({ os: "linux", browser: "firefox-developer", install: "flatpak", customPath: "org.mozilla.FirefoxDevEdition" });
  assert.equal(flatpakId.run.command, "flatpak run org.mozilla.FirefoxDevEdition " + ARGS);
  assert.equal(flatpakId.path.label, "Flatpak app ID");
  assert.match(flatpakId.path.hint, /flatpak list --app \| grep -i firefox/);
  assert.equal(plan({ os: "linux", browser: "firefox", install: "custom", customPath: "/snap/bin/firefox" }).run.command, "snap run firefox " + ARGS);
  const snapLib = plan({ os: "linux", browser: "firefox", install: "custom", customPath: "/snap/firefox/current/usr/lib/firefox/firefox" });
  assert.equal(snapLib.run.command, "snap run firefox " + ARGS);
  assert.equal(
    snapLib.permanent.command,
    "mkdir -p ~/.local/share/applications && cp /var/lib/snapd/desktop/applications/firefox_firefox.desktop ~/.local/share/applications/ && sed -i 's|^\\(Exec=.*/snap/bin/firefox\\)|\\1 " + ARGS + "|' ~/.local/share/applications/firefox_firefox.desktop"
  );
  const opt = plan({ os: "linux", browser: "other", install: "custom", customPath: " '/opt/My Fox/$fox' " });
  assert.equal(opt.run.command, "\"/opt/My Fox/\\$fox\" " + ARGS);
  assert.match(opt.permanent.command, /cp \/usr\/share\/applications\/\$fox\.desktop/);
  const pkg = plan({ os: "linux", browser: "waterfox" });
  assert.equal(
    pkg.permanent.command,
    "mkdir -p ~/.local/share/applications && cp /usr/share/applications/waterfox.desktop ~/.local/share/applications/ && sed -i 's|^Exec=\\([^ ]*\\)|Exec=\\1 " + ARGS + "|' ~/.local/share/applications/waterfox.desktop"
  );
  assert.equal(pkg.permanent.steps[0].command, "ls /usr/share/applications /var/lib/flatpak/exports/share/applications ~/.local/share/flatpak/exports/share/applications /var/lib/snapd/desktop/applications 2>/dev/null | grep -i waterfox");
});

test("the profile flag is quoted for every shell and launcher", () => {
  const profile = "Work Stuff";
  assert.ok(plan({ os: "windows", browser: "firefox", profile }).run.command.endsWith(ARGS + " -P \"Work Stuff\""));
  assert.ok(plan({ os: "macos", browser: "firefox", profile }).run.command.endsWith(ARGS + " -P \"Work Stuff\""));
  const linux = plan({ os: "linux", browser: "firefox", profile });
  assert.equal(linux.args, ARGS + " -P \"Work Stuff\"");
  assert.ok(linux.permanent.command.includes("Exec=\\1 " + ARGS + " -P \"Work Stuff\"|'"));
  assert.match(linux.notes.join(" "), /-P starts the profile named "Work Stuff"/);
  const odd = plan({ os: "linux", browser: "firefox", profile: "a$b 5%" });
  assert.ok(odd.run.command.endsWith(" -P \"a\\$b 5%\""));
  assert.ok(odd.permanent.command.includes(" -P \"a\\\\\\\\$b 5%%\"|'"));
  const quoted = plan({ os: "windows", browser: "firefox", profile: "say \"hi\"" });
  assert.ok(quoted.run.command.endsWith(" -P \"say hi\""));
  assert.match(quoted.warnings[0], /double quotes/);
  assert.equal(plan({ os: "windows", browser: "firefox", profile: "   " }).args, ARGS);
});

test("notes, port fallback and the missing origin warning", () => {
  const result = plan({ os: "linux", browser: "firefox" });
  const notes = result.notes.join(" ");
  assert.match(notes, /striped and shows a robot icon/);
  assert.match(notes, /127\.0\.0\.1/);
  assert.match(notes, /unique to this browser profile/);
  assert.match(notes, /start it the normal way/);
  assert.match(notes, /port 9333, pick another port/);
  assert.match(notes, /typical install locations, not guaranteed/);
  assert.doesNotMatch(plan({ os: "linux", browser: "other", install: "custom", customPath: "/opt/fox" }).notes.join(" "), /typical install locations/);
  assert.equal(plain(launch.plan({ os: "linux", browser: "firefox", port: 70000, origin: ORIGIN })).args, "--remote-debugging-port 9222 --remote-allow-origins " + ORIGIN);
  assert.equal(plain(launch.plan({ os: "linux", browser: "firefox", port: "9555", origin: ORIGIN })).args, "--remote-debugging-port 9555 --remote-allow-origins " + ORIGIN);
  const missing = plain(launch.plan({ os: "linux", browser: "firefox", port: 9333 }));
  assert.match(missing.warnings[0], /extension address is missing/);
  assert.equal(plain(launch.plan(undefined)).os, "linux");
});
