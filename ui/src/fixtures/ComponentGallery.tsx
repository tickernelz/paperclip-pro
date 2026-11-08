import { useState } from "react";
import { createRoot } from "react-dom/client";
import { Inbox, Search, Trash2 } from "lucide-react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { CompanyProvider } from "@/context/CompanyContext";
import { SidebarProvider } from "@/context/SidebarContext";
import { SidebarNavItem } from "@/components/SidebarNavItem";
import { MarkdownBody } from "@/components/MarkdownBody";
import { MarkdownEditor } from "@/components/MarkdownEditor";
import { MootLoading } from "@/components/MootLoading";
import { ThemeProvider } from "@/context/ThemeContext";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Segmented, SegmentedItem } from "@/components/ui/segmented";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import "@/index.css";

const GALLERY_THEMES = ["light", "dark"] as const;
const GALLERY_SURFACES = [
  { key: "bg", className: "bg-bg" },
  { key: "bg-2", className: "bg-bg-2" },
  { key: "bg-3", className: "bg-bg-3" },
] as const;
const VARIANTS = ["primary", "secondary", "ghost", "danger", "delete", "link"] as const;
const STATES = [
  { key: "default", props: {} },
  { key: "disabled", props: { disabled: true } },
  { key: "loading", props: { loading: true } },
] as const;
const SELECTABLE_VARIANTS = new Set(["secondary", "ghost"]);
const BADGE_TONES = ["default", "danger", "warning"] as const;
const TAB_VARIANTS = ["default", "line"] as const;
const MARKDOWN_SAMPLE = "Plain text with a [link](https://example.com), `inline code` and **bold** words.\n\n> A quoted line";

function Surface({ theme, surface }: { theme: string; surface: (typeof GALLERY_SURFACES)[number] }) {
  const [switchOn, setSwitchOn] = useState(true);
  const [switchOff, setSwitchOff] = useState(false);
  const id = (name: string) => `${theme}/${surface.key}/${name}`;
  return (
    <div data-gallery-surface={surface.key} className={cn(surface.className, "flex flex-col gap-3 rounded-lg p-4")}>
      <div className="flex flex-wrap items-center gap-2">
        {VARIANTS.flatMap((variant) => [
          ...STATES.map((state) => (
            <Button key={`${variant}-${state.key}`} data-gallery-item={id(`button.${variant}.${state.key}`)} variant={variant} size="sm" {...state.props}>
              Approve
            </Button>
          )),
          ...(SELECTABLE_VARIANTS.has(variant)
            ? [
                <Button key={`${variant}-active`} data-gallery-item={id(`button.${variant}.active`)} variant={variant} size="sm" active>
                  Approve
                </Button>,
              ]
            : []),
        ])}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button data-gallery-item={id("icon.ghost")} variant="ghost" size="icon-sm" aria-label="Search">
          <Search />
        </Button>
        <Button data-gallery-item={id("icon.secondary")} variant="secondary" size="icon-sm" aria-label="Search">
          <Search />
        </Button>
        <Button data-gallery-item={id("icon.danger")} variant="danger" size="icon-sm" aria-label="Delete">
          <Trash2 />
        </Button>
        <Button data-gallery-item={id("icon.ghost.active")} variant="ghost" size="icon-sm" aria-label="Search" active>
          <Search />
        </Button>
        <Segmented data-gallery-item={id("segmented")} aria-label="View">
          <SegmentedItem data-gallery-item={id("segmented.item.on")} selected>
            List
          </SegmentedItem>
          <SegmentedItem data-gallery-item={id("segmented.item")}>Board</SegmentedItem>
          <SegmentedItem data-gallery-item={id("segmented.item.disabled")} disabled>
            Tree
          </SegmentedItem>
        </Segmented>
        <Chip data-gallery-item={id("chip.on")} selected>
          Open
        </Chip>
        <Chip data-gallery-item={id("chip")}>Done</Chip>
        <Chip data-gallery-item={id("chip.disabled")} disabled>
          Blocked
        </Chip>
        <ToggleSwitch data-gallery-item={id("switch.on")} aria-label="On" checked={switchOn} onCheckedChange={setSwitchOn} />
        <ToggleSwitch data-gallery-item={id("switch.off")} aria-label="Off" checked={switchOff} onCheckedChange={setSwitchOff} />
        <ToggleSwitch data-gallery-item={id("switch.disabled")} aria-label="Disabled" checked={false} onCheckedChange={() => undefined} disabled />
      </div>
      <div className="flex flex-wrap items-center gap-4">
        {TAB_VARIANTS.map((variant) => (
          <Tabs key={variant} defaultValue="recent">
            <TabsList variant={variant}>
              <TabsTrigger value="recent" data-gallery-item={id(`tabs.${variant}.trigger.on`)}>
                Recent
              </TabsTrigger>
              <TabsTrigger value="unread" data-gallery-item={id(`tabs.${variant}.trigger`)}>
                Unread
              </TabsTrigger>
            </TabsList>
          </Tabs>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div data-gallery-item={id("moot.loading")} data-gallery-kind="graphic">
          <MootLoading className="min-h-0" />
        </div>
        <div data-gallery-item={id("markdown.body")} data-gallery-kind="text">
          <MarkdownBody>{MARKDOWN_SAMPLE}</MarkdownBody>
        </div>
        <div data-gallery-item={id("markdown.editor.filled")} data-gallery-kind="text">
          <MarkdownEditor value={MARKDOWN_SAMPLE} onChange={() => undefined} placeholder="Write a comment" bordered />
        </div>
        <div data-gallery-item={id("markdown.editor.empty")} data-gallery-kind="text">
          <MarkdownEditor value="" onChange={() => undefined} placeholder="Write a comment" bordered />
        </div>
      </div>
      <nav className="flex w-60 flex-col gap-1" aria-label={id("nav")}>
        {BADGE_TONES.map((tone) => (
          <div key={tone} data-gallery-item={id(`navitem.on.badge-${tone}`)}>
            <SidebarNavItem to={`/${tone}`} label="Inbox" icon={Inbox} badge={12} badgeTone={tone} active />
          </div>
        ))}
        <div data-gallery-item={id("navitem.badge-default")}>
          <SidebarNavItem to="/rest" label="Inbox" icon={Inbox} badge={3} active={false} />
        </div>
      </nav>
    </div>
  );
}

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

function Gallery() {
  return (
    <QueryClientProvider client={queryClient}>
    <ThemeProvider>
    <MemoryRouter initialEntries={["/"]}>
      <CompanyProvider>
      <TooltipProvider>
        <SidebarProvider>
          <main data-gallery-ready className="flex flex-col">
            {GALLERY_THEMES.map((theme) => (
              <section key={theme} data-gallery-theme={theme} className={cn(theme === "dark" && "dark", "flex flex-col gap-4 bg-bg p-6 text-ink")}>
                {GALLERY_SURFACES.map((surface) => (
                  <Surface key={surface.key} theme={theme} surface={surface} />
                ))}
              </section>
            ))}
          </main>
        </SidebarProvider>
      </TooltipProvider>
      </CompanyProvider>
    </MemoryRouter>
    </ThemeProvider>
    </QueryClientProvider>
  );
}

createRoot(document.getElementById("root")!).render(<Gallery />);
