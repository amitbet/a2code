import { ChevronDownIcon, ChevronUpIcon, SearchIcon, XIcon } from "lucide-react";
import { type KeyboardEvent, useEffect, useRef } from "react";
import { Button } from "../ui/button";
import { cn } from "~/lib/utils";

interface ChatSearchBarProps {
  query: string;
  /** Total number of matches across the whole chat. */
  matchCount: number;
  /** 0-based index of the active match, or -1 when there are none. */
  activeIndex: number;
  /** Bumped each time Cmd/Ctrl+F is pressed, to refocus an already-open bar. */
  focusNonce: number;
  onQueryChange: (query: string) => void;
  onNext: () => void;
  onPrevious: () => void;
  onClose: () => void;
}

/**
 * Floating find-in-chat bar (Cmd/Ctrl+F). Mirrors a browser's find toolbar:
 * type to filter, Enter / Shift+Enter to step through matches, Escape to close.
 */
export function ChatSearchBar({
  query,
  matchCount,
  activeIndex,
  focusNonce,
  onQueryChange,
  onNext,
  onPrevious,
  onClose,
}: ChatSearchBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus and select on open (and each time Cmd/Ctrl+F is re-pressed) so an
  // immediate retype replaces the prior query.
  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, [focusNonce]);

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      if (event.shiftKey) onPrevious();
      else onNext();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
  };

  const hasQuery = query.trim().length > 0;
  const countLabel = !hasQuery
    ? null
    : matchCount === 0
      ? "No results"
      : `${activeIndex + 1}/${matchCount}`;

  return (
    <div className="pointer-events-auto absolute right-3 top-3 z-40 flex items-center gap-1 rounded-lg border border-border/70 bg-card/95 p-1 shadow-md backdrop-blur supports-[backdrop-filter]:bg-card/80 sm:right-5">
      <SearchIcon className="ml-1.5 size-3.5 shrink-0 text-muted-foreground/70" aria-hidden />
      <input
        ref={inputRef}
        type="text"
        value={query}
        placeholder="Search chat"
        aria-label="Search chat"
        spellCheck={false}
        onChange={(event) => onQueryChange(event.target.value)}
        onKeyDown={handleKeyDown}
        className="h-6 w-40 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/60 sm:w-52"
      />
      <span
        className={cn(
          "min-w-12 px-1 text-right text-xs tabular-nums",
          matchCount === 0 && hasQuery ? "text-muted-foreground/60" : "text-muted-foreground",
        )}
      >
        {countLabel}
      </span>
      <div className="flex items-center">
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          disabled={matchCount === 0}
          aria-label="Previous match"
          onClick={onPrevious}
        >
          <ChevronUpIcon className="size-3.5" />
        </Button>
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          disabled={matchCount === 0}
          aria-label="Next match"
          onClick={onNext}
        >
          <ChevronDownIcon className="size-3.5" />
        </Button>
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          aria-label="Close search"
          onClick={onClose}
        >
          <XIcon className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}
