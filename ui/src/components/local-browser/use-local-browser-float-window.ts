import { useCallback, useEffect, useRef, useState } from "react";

export type LocalBrowserFloatMode = "pip" | "popup";

export interface LocalBrowserFloatTarget {
  mode: LocalBrowserFloatMode;
  container: HTMLElement;
}

export interface UseLocalBrowserFloatWindowResult {
  target: LocalBrowserFloatTarget | null;
  open: () => Promise<LocalBrowserFloatMode | null>;
  close: () => void;
}

interface DocumentPictureInPictureApi {
  requestWindow(options: { width: number; height: number }): Promise<Window>;
}

const WIDTH = 480;
const HEIGHT = 400;
const POPUP_NAME = "paperclip-local-browser";
const ROOT_ATTRIBUTE = "data-local-browser-float-root";

function pictureInPictureApi(): DocumentPictureInPictureApi | null {
  const candidate = (window as Window & { documentPictureInPicture?: Partial<DocumentPictureInPictureApi> })
    .documentPictureInPicture;
  return typeof candidate?.requestWindow === "function" ? (candidate as DocumentPictureInPictureApi) : null;
}

function documentReady(target: Document): Promise<boolean> {
  if (target.head && target.body) return Promise.resolve(true);
  return new Promise((resolve) => {
    const onReady = () => {
      if (!target.head || !target.body) return;
      target.removeEventListener("DOMContentLoaded", onReady);
      resolve(true);
    };
    target.addEventListener("DOMContentLoaded", onReady);
    onReady();
  });
}

function prepareDocument(source: Document, target: Document): HTMLElement {
  target.head.replaceChildren();
  target.body.replaceChildren();
  for (const node of source.head.querySelectorAll('style, link[rel~="stylesheet"]')) {
    target.head.appendChild(node.cloneNode(true));
  }
  for (const attribute of Array.from(target.documentElement.attributes)) {
    if (attribute.name !== "xmlns") target.documentElement.removeAttribute(attribute.name);
  }
  for (const attribute of Array.from(source.documentElement.attributes)) {
    target.documentElement.setAttribute(attribute.name, attribute.value);
  }
  target.title = source.title;
  target.body.className = source.body.className;
  target.body.style.margin = "0";
  target.body.style.minHeight = "100vh";
  const root = target.createElement("div");
  root.setAttribute(ROOT_ATTRIBUTE, "");
  target.body.appendChild(root);
  return root;
}

function acquireWindow(): { child: Promise<Window | null>; mode: LocalBrowserFloatMode } {
  const pip = pictureInPictureApi();
  if (pip) {
    return { mode: "pip", child: pip.requestWindow({ width: WIDTH, height: HEIGHT }).catch(() => null) };
  }
  let popup: Window | null = null;
  try {
    popup = window.open("", POPUP_NAME, `popup,width=${WIDTH},height=${HEIGHT}`);
  } catch {
    popup = null;
  }
  return { mode: "popup", child: Promise.resolve(popup) };
}

export function useLocalBrowserFloatWindow(onClosed?: () => void): UseLocalBrowserFloatWindowResult {
  const [target, setTarget] = useState<LocalBrowserFloatTarget | null>(null);
  const childRef = useRef<Window | null>(null);
  const pageHideRef = useRef<(() => void) | null>(null);
  const generationRef = useRef(0);
  const onClosedRef = useRef(onClosed);

  useEffect(() => {
    onClosedRef.current = onClosed;
  });

  const release = useCallback((closeWindow: boolean) => {
    const child = childRef.current;
    const pageHide = pageHideRef.current;
    childRef.current = null;
    pageHideRef.current = null;
    if (child && pageHide) child.removeEventListener("pagehide", pageHide);
    if (closeWindow && child && !child.closed) {
      try {
        child.close();
      } catch {
        return;
      }
    }
  }, []);

  const close = useCallback(() => {
    generationRef.current += 1;
    release(true);
    setTarget(null);
  }, [release]);

  const open = useCallback(async (): Promise<LocalBrowserFloatMode | null> => {
    generationRef.current += 1;
    const generation = generationRef.current;
    release(true);
    setTarget(null);
    if (typeof window === "undefined") return null;
    const acquired = acquireWindow();
    const child = await acquired.child;
    if (!child) return null;
    const discard = () => {
      if (!child.closed) {
        try {
          child.close();
        } catch {
          return;
        }
      }
    };
    if (generationRef.current !== generation) {
      discard();
      return null;
    }
    try {
      if (!(await documentReady(child.document)) || generationRef.current !== generation || child.closed) {
        discard();
        return null;
      }
      const container = prepareDocument(document, child.document);
      const pageHide = () => {
        if (generationRef.current !== generation || childRef.current !== child) return;
        release(false);
        setTarget(null);
        onClosedRef.current?.();
      };
      childRef.current = child;
      pageHideRef.current = pageHide;
      child.addEventListener("pagehide", pageHide);
      setTarget({ mode: acquired.mode, container });
      try {
        child.focus();
      } catch {
        void 0;
      }
      return acquired.mode;
    } catch {
      discard();
      return null;
    }
  }, [release]);

  useEffect(() => {
    const onUnload = () => release(true);
    window.addEventListener("pagehide", onUnload);
    return () => {
      window.removeEventListener("pagehide", onUnload);
      generationRef.current += 1;
      release(true);
    };
  }, [release]);

  return { target, open, close };
}
