#!/usr/bin/env python3
import sys
SCREENS = "home inbox inbox-item approvals tasks task agents agent agent-setup org routines costs connectors browser chat settings instance features features-more advanced defaults all-settings providers ob-check ob-old ob-offline ob-remote ob-connect ob-task tasks-empty tasks-loading tasks-error keyboard i18n pwa-install pwa-update pwa-offline pwa-notify system".split()
SIZES = [(360, 740), (390, 844), (768, 1024), (1024, 768), (1440, 900), (1920, 1080)]
EXTRA = [("pwa-wco", 1440, 900), ("pwa-wco", 1920, 1080)]


def jobs():
    for s in SCREENS:
        for w, h in SIZES:
            for t in ("light", "dark"):
                yield s, t, w, h
    for s, w, h in EXTRA:
        for t in ("light", "dark"):
            yield s, t, w, h


if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "render"
    for s, t, w, h in jobs():
        if mode == "audit":
            print(f"screen={s}&theme={t} {w} {h}")
        else:
            print(f"{s} {t} {w} {h}")
