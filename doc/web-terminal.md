# Web Terminal

Paperclip has a browser terminal: a full xterm session in the app, opened from **Terminal** in the sidebar or from the task drawer. It runs a shell on the Paperclip host, an SSH session to a registered environment, or the host's own `ssh` client to a host from `~/.ssh/config` or a saved destination.

## Who can open what

| Session kind | Allowed for |
|---|---|
| `local` (shell on this host) | `local_trusted` operators, and instance admins signed in through the browser |
| `ssh` (registered environment) | active, non-viewer company members signed in through the browser |
| SSH host (`~/.ssh/config` or saved) | same as `local`: it runs the host's `ssh` client with the Paperclip user's keys, agent and `known_hosts` |

Agents, company-owner agents, board API keys, and MCP OAuth tokens are refused for both kinds. A non-admin member sees no local option; the server is the authority and returns 403 for any local action they attempt.

A local shell runs as the user that runs Paperclip, so it can read anything that user can read, including other companies' data on the same host, and it inherits that user's `SSH_AUTH_SOCK`, so it can use the user's ssh agent. That is why it is limited to instance admins.

## Origins

Every mutating route and the WebSocket upgrade require a trusted origin:

- `auth.publicBaseUrl` and `PAPERCLIP_PUBLIC_URL`, matched exactly
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

## SSH hosts

The **SSH** menu lists three groups:

- **~/.ssh/config**: every literal `Host` alias in the Paperclip user's `~/.ssh/config`, including files pulled in by `Include`. Wildcard patterns and `Match` blocks are not listed. Opening one runs `ssh -- <alias>`, so the alias's `HostName`, `User`, `Port`, `IdentityFile`, `ProxyJump` and other options apply.
- **Saved**: destinations added with **Connect to host…** (name, `user@host` or a config alias, optional port), stored per company. Opening one runs `ssh [-p <port>] -- <destination>`. A raw `user@ip` destination does not pick up an alias's `IdentityFile`; enter the alias as the destination to reuse it.
- **Environments**: SSH environments registered under **Instance settings → Environments** (**Manage SSH environments**), which connect with their own stored key.

SSH host routes and sessions require local terminal access. Saving and removing a host is written to the activity log; hosts from `~/.ssh/config` cannot be removed from the app.

## Terminal features

- WebGL rendering with a fallback when WebGL is unavailable
- inline images over Sixel, the iTerm2 protocol, and the kitty graphics protocol. Kitty images must be sent inline (`t=d`, PNG or raw pixels, optionally zlib-compressed); the file, temp-file and shared-memory transfer modes are refused with `EINVAL`. OMP picks Sixel on its own; set `PI_FORCE_IMAGE_PROTOCOL=kitty` to make it use kitty.
- clickable links, search (Ctrl/Cmd+F), copy and paste (Ctrl+Shift+C/V)
- a right-click menu: copy, paste, select all, find, clear scrollback, upload a file, download a file
- pasting an image (Ctrl+V, Ctrl+Shift+V, the right-click **Paste**, or the browser's paste) saves it as `pasted-image-<time>-<id>.<ext>` in a private `$TMPDIR/paperclip-pasted-<uid>/` folder (mode 700, files 600) on the machine the shell runs on, and types its path at the cursor. PNG, JPEG, GIF, WebP and BMP are accepted. When the clipboard holds no image, Ctrl+V reaches the program as a normal Ctrl+V. Reading the clipboard on Ctrl+V needs the browser's clipboard permission; without it, use the browser's own paste.
- tabs and a side-by-side split
- drag a file onto the terminal to upload it into the session's directory; download a file by path

Uploads never overwrite an existing file and cannot leave the session's directory. Output that asks for the clipboard (OSC 52 read) gets an empty answer, so a program in the terminal cannot read your clipboard; programs can still copy into it.
