// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useIssuesSearchSync } from "./Issues";

vi.mock("./Inbox", () => ({ Inbox: () => null }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("useIssuesSearchSync", () => {
  let container: HTMLDivElement;
  let root: Root;
  let latest: ReturnType<typeof useIssuesSearchSync>;

  function Probe({ urlSearch, locationSearch }: { urlSearch: string; locationSearch: string }) {
    latest = useIssuesSearchSync(urlSearch, locationSearch);
    return null;
  }

  function render(urlSearch: string, locationSearch: string) {
    act(() => {
      root.render(<Probe urlSearch={urlSearch} locationSearch={locationSearch} />);
    });
  }

  beforeEach(() => {
    window.history.replaceState(null, "", "/issues?view=all");
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("keeps the search when the same value is emitted again while router params lag behind", () => {
    render("", "?view=all");
    act(() => latest.handleSearchChange('title:"internal status"'));
    expect(window.location.search).toBe("?view=all&q=title%3A%22internal+status%22");
    expect(latest.syncedSearch).toBe('title:"internal status"');

    act(() => latest.handleSearchChange('title:"internal status"'));
    expect(latest.syncedSearch).toBe('title:"internal status"');
  });

  it("follows the URL again after navigation changes the location", () => {
    render("", "?view=all");
    act(() => latest.handleSearchChange("auth"));
    expect(latest.syncedSearch).toBe("auth");

    window.history.replaceState(null, "", "/issues?view=all&q=billing");
    render("billing", "?view=all&q=billing");
    expect(latest.syncedSearch).toBe("billing");
  });
});
