"use client";

import { useState, type ComponentType, type ReactElement } from "react";
import { Button } from "@/components/ui/button";
import { useChromeIcons } from "@/components/branding/branding-icons-provider";

type PanelProps = {
  trigger?: ReactElement;
  defaultOpen?: boolean;
};

/**
 * Search icon for the header bundle. The drawer module, which renders
 * product cards, is imported the first time this icon is pressed.
 */
function DefaultSearchButton({ onOpen }: { onOpen: () => void }) {
  const { Search } = useChromeIcons();
  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-9 w-9"
      aria-label="Search"
      onClick={onOpen}
    >
      <Search className="h-6 w-6 text-primary transition-opacity hover:opacity-70" />
    </Button>
  );
}

/**
 * Header search control. The icon paints with the nav. The drawer chunk
 * loads on the first press and then stays mounted.
 */
export function SearchDrawer({ trigger }: { trigger?: ReactElement }) {
  const [Panel, setPanel] = useState<ComponentType<PanelProps> | null>(null);

  const open = (): void => {
    void import("@/components/headkit-ui/search-drawer").then((mod) => {
      setPanel(() => mod.SearchDrawer);
    });
  };

  if (!Panel) {
    if (!trigger) return <DefaultSearchButton onOpen={open} />;
    return (
      <span style={{ display: "contents" }} onClick={open}>
        {trigger}
      </span>
    );
  }

  if (!trigger) return <Panel defaultOpen />;
  return <Panel trigger={trigger} defaultOpen />;
}
