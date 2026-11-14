# Web Terminal

Wardmote has a browser terminal: a full xterm session in the app, opened from **Terminal** in the sidebar or from the task drawer. It runs a shell on the Wardmote host, an SSH session to a registered environment, or the host's own `ssh` client to a host from `~/.ssh/config`.

## Who can open what

| Session kind | Allowed for |
|---|---|
| `local` (shell on this host) | `local_trusted` operators, and instance admins signed in through the browser |
| `ssh` (registered environment) | active, non-viewer company members signed in through the browser |
| SSH host (`~/.ssh/config` or saved), adding hosts and keys | same as `local`: it runs the host's `ssh` client with the Wardmote user's keys, agent and `known_hosts` |

Agents, company-owner agents, board API keys, and MCP OAuth tokens are refused for both kinds. A non-admin member sees no local option; the server is the authority and returns 403 for any local action they attempt.

A local shell runs as the user that runs Wardmote, so it can read anything that user can read, including other companies' data on the same host, and it inherits that user's `SSH_AUTH_SOCK`, so it can use the user's ssh agent. That is why it is limited to instance admins.

## Origins

Every mutating route and the WebSocket upgrade require a trusted origin:

- `auth.publicBaseUrl` and `WARDMOTE_PUBLIC_URL`, matched exactly
- each `server.allowedHostnames` entry, over https on the default port only
- the server's own address, `http://<bind host>:<listen port>`, for local use

A missing `Origin` is accepted only in `local_trusted` mode. A Vite dev server on another port is not a trusted origin.

Behind a reverse proxy or tunnel, set `auth.publicBaseUrl` to the public URL and let the proxy pass the public `Host` through, because the upgrade check reads the raw `Host` header.

## Sessions

- A session keeps running when the tab closes or you switch to another terminal tab. The server keeps a live copy of each session's screen, so reattaching restores the exact current screen, including full-screen programs such as vim or OMP and their terminal modes, plus up to 2,000 rows of scrollback. Inline images are not part of that copy and are not redrawn on reattach.
- A session with no attached client for 24 hours is killed. All sessions end when the service restarts.
- Closing a session sends SIGHUP to the shell's whole process group and session, then SIGKILL after 2 seconds, so background jobs do not outlive it.
- Limits: 16 running sessions per user, 64 per company.
- A terminal opened from a task starts in that task's execution workspace (`providerRef`, then `cwd`), then the project workspace, then the home directory.

## Access over the life of a session

- An attach token is single-use, valid for 60 seconds, and sent only in the first WebSocket frame, never in the URL.
- Access is checked when the token is minted, again when the socket attaches, and every 60 seconds afterwards against the database: role, membership, and the login session that minted the token. Losing any of them closes the socket.
- Opening, attaching, closing, uploading, and downloading are written to the activity log.

## Opening a terminal

With no session open, the terminal page offers two choices: **Local terminal** (instance admins only; other members see it disabled with the reason) and **SSH terminal**, which opens the host picker. The toolbar's **SSH** button opens the same picker.

The picker searches by name and destination. Arrow keys move, Enter opens, Esc closes, and `/` jumps to the search box. Hosts you opened recently are listed first, and each host shows the result of its last connection test from this browser.

## SSH hosts

The picker lists:

- **SSH hosts**: every literal `Host` alias in the Wardmote user's `~/.ssh/config`, including files pulled in by `Include`. Wildcard patterns and `Match` blocks are not listed. Opening one runs `ssh -- <alias>`, so the alias's `HostName`, `User`, `Port`, `IdentityFile`, `ProxyJump` and other options apply.
- **Environments**: SSH environments registered under **Instance settings → Environments**, which connect with their own stored key.
- **Saved in Wardmote only**: destinations saved by older versions in the `terminal_ssh_hosts` table. They still open, but agents cannot use them. **Move to ssh config** (or **Move all**) writes each one into `~/.ssh/config` and then deletes the saved entry. The group is hidden when there are none.

Members who are not instance admins see only environments.

### Adding a host

**Add host** writes a `Host` block to `~/.ssh/config` of the user that runs Wardmote, so the terminal and every agent that runs on this server as that user can use `ssh <name>`. The form asks for a name, host or IP, user and port, and a key:

- **Key in ~/.ssh**: any private key file at the top of `~/.ssh`, shown with its type and SHA256 fingerprint. Keys with a passphrase are flagged: agents can use them only while `ssh-agent` on the server holds them unlocked.
- **Create new key**: runs `ssh-keygen -t ed25519 -N ""` and shows the public key to copy into `~/.ssh/authorized_keys` on the server.
- **Paste a key**: stores the pasted private key as `~/.ssh/<name>` (mode 600) and writes `<name>.pub` when the public half can be derived. The API never returns a private key, and the request body is kept out of HTTP logs.
- **ssh defaults**: no `IdentityFile`; ssh tries its default keys and the agent.

**More options** sets **Connect via** (`ProxyJump` through another host in the config) and keep-alive (`ServerAliveInterval`, `ServerAliveCountMax`).

**Test connection** runs `ssh -o BatchMode=yes -o ConnectTimeout=15 <options> -- <name> true` from the server without writing anything, and explains the result: connected, key rejected, host name not found, host unreachable, timeout, key unusable, host key changed, or host not trusted yet. For a host whose key is not in `known_hosts`, the test reads the server's host key with authentication turned off and shows its fingerprint. **Trust this host** appends that key to `~/.ssh/known_hosts` only if the server still presents the fingerprint you saw, and refuses when `known_hosts` already holds a different key for the host. Wardmote never sets `StrictHostKeyChecking=no`.

### What Wardmote writes

Each block is fenced by marker comments:

```
# >>> wardmote host prod-web (added from the Wardmote Terminal; edit it there)
Host prod-web
    HostName 203.0.113.10
    User deploy
    IdentityFile ~/.ssh/wardmote_prod-web
    IdentitiesOnly yes
# <<< wardmote host prod-web
```

- Only `HostName`, `User`, `Port`, `IdentityFile`, `IdentitiesOnly`, `ProxyJump`, `ServerAliveInterval` and `ServerAliveCountMax` are ever written. `ProxyCommand`, `LocalCommand`, `Match`, `Include` and every other option are rejected, as are values with spaces, newlines or control characters, names with wildcards or a leading `-` or `!`, and names already used in the config (case-insensitive) or by a saved host.
- New blocks go before the first `Host` or `Match` line, after any global options at the top, so they are not overridden by a later `Host *`.
- Only marked blocks can be edited or removed from the app, and only while their content is still what Wardmote wrote; a marked block edited by hand becomes read-only. Everything outside the markers stays byte for byte.
- Writes take a lock file (`config.wardmote.lock`), write a temp file in the same directory and rename it over the config, follow a symlinked config to its target, and leave the file at mode 600. `~/.ssh` is created with mode 700 when missing. Before the first change after each server start, the old file is copied to `config.wardmote-backup-<UTC time>`. A config changed on disk while saving is not overwritten; the save fails and can be retried.
- Adding, editing, removing, moving a saved host, trusting a host key and creating a key are written to the activity log, without key contents.

### Which agents can use these hosts

Agents that run on this server as the Wardmote user with the normal home directory read the same `~/.ssh/config`, so `ssh -o BatchMode=yes <name> true` works for them once the key is accepted by the server. Agents running in a sandbox get a managed `HOME` and agents on an SSH environment run on another machine; neither sees this file.

All SSH host, key and connection-test routes need local terminal access (instance admin or `local_trusted`), the same as a local shell, because `ssh_config` can run commands as the Wardmote user.

## Terminal features

- WebGL rendering with a fallback when WebGL is unavailable
- inline images over Sixel, the iTerm2 protocol, and the kitty graphics protocol. Kitty images must be sent inline (`t=d`, PNG or raw pixels, optionally zlib-compressed); the file, temp-file and shared-memory transfer modes are refused with `EINVAL`. OMP picks Sixel on its own; set `PI_FORCE_IMAGE_PROTOCOL=kitty` to make it use kitty.
- clickable links, search (Ctrl/Cmd+F), copy and paste (Ctrl+Shift+C/V)
- a right-click menu: copy, paste, select all, find, clear scrollback, upload a file, download a file
- pasting an image (Ctrl+V, Ctrl+Shift+V, the right-click **Paste**, or the browser's paste) saves it as `pasted-image-<time>-<id>.<ext>` in a private `$TMPDIR/wardmote-pasted-<uid>/` folder (mode 700, files 600) on the machine the shell runs on, and types its path at the cursor. PNG, JPEG, GIF, WebP and BMP are accepted. When the clipboard holds no image, Ctrl+V reaches the program as a normal Ctrl+V. Reading the clipboard on Ctrl+V needs the browser's clipboard permission; without it, use the browser's own paste.
- tabs and a side-by-side split
- drag a file onto the terminal to upload it into the session's directory; download a file by path

Uploads never overwrite an existing file and cannot leave the session's directory. Output that asks for the clipboard (OSC 52 read) gets an empty answer, so a program in the terminal cannot read your clipboard; programs can still copy into it.
