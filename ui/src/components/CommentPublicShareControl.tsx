import { EyeOff, Globe, MoreHorizontal } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function CommentPublicShareBadge() {
  return (
    <Badge
      variant="outline"
      className="gap-1 text-(length:--text-nano) uppercase tracking-(--tracking-eyebrow)"
      title="Visible on the public link"
    >
      <Globe className="h-3 w-3" aria-hidden />
      Public
    </Badge>
  );
}

export function CommentPublicShareMenu({
  visible,
  onToggle,
}: {
  visible: boolean;
  onToggle: (visible: boolean) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          className="text-muted-foreground hover:text-foreground"
          title="Comment actions"
          aria-label="Comment actions"
        >
          <MoreHorizontal className="h-3.5 w-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => onToggle(!visible)}>
          {visible ? (
            <EyeOff className="mr-2 h-3.5 w-3.5" />
          ) : (
            <Globe className="mr-2 h-3.5 w-3.5" />
          )}
          {visible ? "Hide from public link" : "Show on public link"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
