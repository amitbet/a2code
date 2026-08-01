import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import {
  BoldIcon,
  CheckIcon,
  ChevronDownIcon,
  HighlighterIcon,
  ItalicIcon,
  ListIcon,
  ListOrderedIcon,
  LoaderIcon,
  PaletteIcon,
  SlashIcon,
  TypeIcon,
  UnderlineIcon,
  XIcon,
} from "lucide-react";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { EnvironmentId, type EnvironmentId as EnvironmentIdType } from "@t3tools/contracts";

import { Button } from "./ui/button";
import {
  Sheet,
  SheetDescription,
  SheetHeader,
  SheetPanel,
  SheetPopup,
  SheetTitle,
} from "./ui/sheet";
import { Popover, PopoverPopup, PopoverTrigger } from "./ui/popover";
import { useProjectFileQuery } from "./files/projectFilesQueryState";
import { projectEnvironment } from "../state/projects";
import { useAtomCommand } from "../state/use-atom-command";
import { cn } from "../lib/utils";
import {
  clearProjectFileQueryData,
  confirmProjectFileQueryData,
  setProjectFileQueryData,
} from "./files/projectFilesQueryState";

const TODO_FILE_PATH = ".t3.todo.html";
const SAVE_DEBOUNCE_MS = 2_000;
const FONT_CHOICES = [
  { label: "Sans", value: "system-ui" },
  { label: "Serif", value: "Georgia" },
  { label: "Mono", value: "'JetBrains Mono'" },
] as const;
const TEXT_COLOR_CHOICES = [
  { label: "Default", value: "", swatch: "#64748b" },
  { label: "Slate", value: "#334155", swatch: "#334155" },
  { label: "Blue", value: "#2563eb", swatch: "#2563eb" },
  { label: "Green", value: "#15803d", swatch: "#15803d" },
  { label: "Red", value: "#dc2626", swatch: "#dc2626" },
  { label: "Amber", value: "#d97706", swatch: "#d97706" },
] as const;
const HIGHLIGHT_CHOICES = [
  { label: "None", value: "", swatch: "transparent" },
  { label: "Yellow", value: "#fef08a", swatch: "#fef08a" },
  { label: "Mint", value: "#bbf7d0", swatch: "#bbf7d0" },
  { label: "Sky", value: "#bae6fd", swatch: "#bae6fd" },
  { label: "Rose", value: "#fecdd3", swatch: "#fecdd3" },
] as const;

type ProjectTodoSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: {
    environmentId: EnvironmentIdType;
    workspaceRoot: string;
    displayName: string;
  } | null;
};

const EMPTY_ENVIRONMENT_ID = EnvironmentId.make("environment-project-todo-sheet");

function isMissingFileError(error: string | null): boolean {
  return (
    error !== null &&
    /(enoent|not found|does not exist|no such file|failed to read workspace file)/i.test(error)
  );
}

function normalizeEditorHtml(html: string): string {
  const trimmed = html.trim();
  return trimmed === "<br>" || trimmed === "<div><br></div>" || trimmed === "<p><br></p>"
    ? ""
    : trimmed;
}

function isHtmlEffectivelyEmpty(html: string): boolean {
  if (html.length === 0) return true;
  if (typeof DOMParser === "undefined") {
    return (
      html
        .replace(/<[^>]+>/g, "")
        .replace(/\u200B/g, "")
        .trim().length === 0
    );
  }
  const document = new DOMParser().parseFromString(html, "text/html");
  return document.body.textContent?.replace(/\u200B/g, "").trim().length === 0;
}

function normalizeColorValue(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (normalized.startsWith("#")) return normalized;

  const rgb = normalized.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (!rgb) return normalized;

  return `#${[rgb[1], rgb[2], rgb[3]]
    .map((channel) => Number(channel).toString(16).padStart(2, "0"))
    .join("")}`;
}

function resolveColorChoice(value: string, choices: ReadonlyArray<{ value: string }>): string {
  const normalized = normalizeColorValue(value);
  return (
    choices.find((choice) => choice.value && normalizeColorValue(choice.value) === normalized)
      ?.value ?? ""
  );
}

export function ProjectTodoSheet({ open, onOpenChange, project }: ProjectTodoSheetProps) {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const savedSelectionRef = useRef<Range | null>(null);
  const latestDraftHtmlRef = useRef("");
  const persistedDraftHtmlRef = useRef("");
  const saveTimeoutRef = useRef<number | null>(null);
  const saveInFlightRef = useRef<Promise<boolean> | null>(null);
  const closeRequestInFlightRef = useRef(false);
  const missingFileBootstrapRef = useRef<string | null>(null);
  const [draftHtml, setDraftHtml] = useState("");
  const [lastSavedHtml, setLastSavedHtml] = useState("");
  const [initializedProjectKey, setInitializedProjectKey] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isFocused, setIsFocused] = useState(false);
  const [isCreatingInitialFile, setIsCreatingInitialFile] = useState(false);
  const [fontValue, setFontValue] = useState<string>(FONT_CHOICES[0].value);
  const [textColorValue, setTextColorValue] = useState<string>(TEXT_COLOR_CHOICES[0].value);
  const [highlightValue, setHighlightValue] = useState<string>(HIGHLIGHT_CHOICES[0].value);
  const writeProjectFile = useAtomCommand(projectEnvironment.writeFile, {
    reportFailure: false,
  });

  const projectKey = project
    ? `${project.environmentId}:${project.workspaceRoot}:${project.displayName}`
    : null;
  const fileQuery = useProjectFileQuery(
    project?.environmentId ?? EMPTY_ENVIRONMENT_ID,
    project?.workspaceRoot ?? "",
    TODO_FILE_PATH,
    open && project !== null,
  );
  const missingFile = isMissingFileError(fileQuery.error);
  const loadError = fileQuery.error && !missingFile ? fileQuery.error : null;
  const isDirty = draftHtml !== lastSavedHtml;
  const isEmpty = useMemo(() => isHtmlEffectivelyEmpty(draftHtml), [draftHtml]);

  useEffect(() => {
    latestDraftHtmlRef.current = draftHtml;
  }, [draftHtml]);

  const syncToolbarState = useCallback(() => {
    const editor = editorRef.current;
    const selection = document.getSelection();
    if (!editor || !selection || !editor.contains(selection.anchorNode)) return;
    if (selection.rangeCount > 0) {
      savedSelectionRef.current = selection.getRangeAt(0).cloneRange();
    }

    const fontName = document.queryCommandValue("fontName").toLowerCase();
    const matchingFont = FONT_CHOICES.find(
      (choice) =>
        fontName === choice.value.toLowerCase() ||
        fontName.includes(choice.value.replace(/['"]/g, "").toLowerCase()),
    );
    setFontValue(matchingFont?.value ?? FONT_CHOICES[0].value);
    setTextColorValue(
      resolveColorChoice(document.queryCommandValue("foreColor"), TEXT_COLOR_CHOICES),
    );
    setHighlightValue(
      resolveColorChoice(
        document.queryCommandValue("hiliteColor") || document.queryCommandValue("backColor"),
        HIGHLIGHT_CHOICES,
      ),
    );
  }, []);

  useEffect(() => {
    document.addEventListener("selectionchange", syncToolbarState);
    return () => document.removeEventListener("selectionchange", syncToolbarState);
  }, [syncToolbarState]);

  useEffect(() => {
    if (!open || !project || !missingFile || fileQuery.isPending || projectKey === null) return;
    if (missingFileBootstrapRef.current === projectKey) return;

    missingFileBootstrapRef.current = projectKey;
    setSaveError(null);
    setDraftHtml("");
    setLastSavedHtml("");
    latestDraftHtmlRef.current = "";
    persistedDraftHtmlRef.current = "";
    setInitializedProjectKey(projectKey);
    if (editorRef.current && editorRef.current.innerHTML !== "") {
      editorRef.current.innerHTML = "";
    }

    setIsCreatingInitialFile(true);
    setProjectFileQueryData(project.environmentId, project.workspaceRoot, TODO_FILE_PATH, "");
    void (async () => {
      const result = await writeProjectFile({
        environmentId: project.environmentId,
        input: {
          cwd: project.workspaceRoot,
          relativePath: TODO_FILE_PATH,
          contents: "",
        },
      });
      setIsCreatingInitialFile(false);
      if (result._tag === "Success") {
        confirmProjectFileQueryData(
          project.environmentId,
          project.workspaceRoot,
          TODO_FILE_PATH,
          "",
        );
        return;
      }
      clearProjectFileQueryData(project.environmentId, project.workspaceRoot, TODO_FILE_PATH);
      missingFileBootstrapRef.current = null;
      const error = squashAtomCommandFailure(result);
      setSaveError(error instanceof Error ? error.message : "Could not create project todo.");
    })();
  }, [fileQuery.isPending, missingFile, open, project, projectKey, writeProjectFile]);

  useEffect(() => {
    if (!open || !project || fileQuery.isPending) return;
    const nextHtml = missingFile ? "" : (fileQuery.data?.contents ?? "");
    if (loadError) {
      setSaveError(loadError);
      return;
    }
    setSaveError(null);
    if (initializedProjectKey === projectKey && isDirty) {
      return;
    }
    setDraftHtml(nextHtml);
    setLastSavedHtml(nextHtml);
    latestDraftHtmlRef.current = nextHtml;
    persistedDraftHtmlRef.current = nextHtml;
    setInitializedProjectKey(projectKey);
    if (editorRef.current && editorRef.current.innerHTML !== nextHtml) {
      editorRef.current.innerHTML = nextHtml;
    }
  }, [
    fileQuery.data?.contents,
    fileQuery.isPending,
    initializedProjectKey,
    isDirty,
    loadError,
    missingFile,
    open,
    project,
    projectKey,
  ]);

  const persistDraft = useCallback(
    async (initialHtml: string): Promise<boolean> => {
      if (!project || initializedProjectKey !== projectKey) return false;

      let nextHtml = initialHtml;
      while (true) {
        const existingSave = saveInFlightRef.current;
        if (existingSave) {
          const existingSaveSucceeded = await existingSave;
          nextHtml = latestDraftHtmlRef.current;
          if (!existingSaveSucceeded) return false;
          if (nextHtml === persistedDraftHtmlRef.current) return true;
          continue;
        }

        if (nextHtml === persistedDraftHtmlRef.current) return true;

        let didSave = false;
        const saveOperation = (async () => {
          setIsSaving(true);
          setSaveError(null);
          setProjectFileQueryData(
            project.environmentId,
            project.workspaceRoot,
            TODO_FILE_PATH,
            nextHtml,
          );
          try {
            const result = await writeProjectFile({
              environmentId: project.environmentId,
              input: {
                cwd: project.workspaceRoot,
                relativePath: TODO_FILE_PATH,
                contents: nextHtml,
              },
            });
            setIsSaving(false);
            if (result._tag === "Success") {
              didSave = true;
              persistedDraftHtmlRef.current = nextHtml;
              setLastSavedHtml(nextHtml);
              confirmProjectFileQueryData(
                project.environmentId,
                project.workspaceRoot,
                TODO_FILE_PATH,
                nextHtml,
              );
              return true;
            }
            clearProjectFileQueryData(project.environmentId, project.workspaceRoot, TODO_FILE_PATH);
            const error = squashAtomCommandFailure(result);
            setSaveError(error instanceof Error ? error.message : "Could not save todo.");
            return false;
          } catch (error) {
            setIsSaving(false);
            clearProjectFileQueryData(project.environmentId, project.workspaceRoot, TODO_FILE_PATH);
            setSaveError(error instanceof Error ? error.message : "Could not save todo.");
            return false;
          }
        })();
        saveInFlightRef.current = saveOperation;
        try {
          await saveOperation;
        } finally {
          if (saveInFlightRef.current === saveOperation) {
            saveInFlightRef.current = null;
          }
        }

        if (!didSave) return false;
        if (latestDraftHtmlRef.current === nextHtml) return true;
        nextHtml = latestDraftHtmlRef.current;
      }
    },
    [initializedProjectKey, project, projectKey, writeProjectFile],
  );

  useEffect(() => {
    if (!open || !project || initializedProjectKey !== projectKey || !isDirty) return;
    saveTimeoutRef.current = window.setTimeout(() => {
      saveTimeoutRef.current = null;
      void persistDraft(draftHtml);
    }, SAVE_DEBOUNCE_MS);

    return () => {
      if (saveTimeoutRef.current !== null) {
        window.clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
      }
    };
  }, [draftHtml, initializedProjectKey, isDirty, open, persistDraft, project, projectKey]);

  const handleInput = useCallback(() => {
    const nextHtml = normalizeEditorHtml(editorRef.current?.innerHTML ?? "");
    setDraftHtml(nextHtml);
    if (editorRef.current && nextHtml.length === 0 && editorRef.current.innerHTML !== "") {
      editorRef.current.innerHTML = "";
    }
  }, []);

  const handleEditorKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.key !== "Tab") return;

      const editor = editorRef.current;
      const selection = document.getSelection();
      const anchorNode = selection?.anchorNode;
      if (!editor || !selection || !anchorNode || !editor.contains(anchorNode)) return;

      const anchorElement = anchorNode instanceof Element ? anchorNode : anchorNode.parentElement;
      const listItem = anchorElement?.closest("li");
      if (!listItem || !editor.contains(listItem)) return;

      event.preventDefault();
      document.execCommand(event.shiftKey ? "outdent" : "indent", false);
      handleInput();
      syncToolbarState();
    },
    [handleInput, syncToolbarState],
  );

  const runEditorCommand = useCallback(
    (command: string, value?: string) => {
      const editor = editorRef.current;
      editor?.focus();
      const savedSelection = savedSelectionRef.current;
      const selection = document.getSelection();
      if (editor && savedSelection && editor.contains(savedSelection.commonAncestorContainer)) {
        selection?.removeAllRanges();
        selection?.addRange(savedSelection);
      }
      document.execCommand(command, false, value);
      handleInput();
      syncToolbarState();
    },
    [handleInput, syncToolbarState],
  );

  const handleSheetOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (nextOpen) {
        onOpenChange(true);
        return;
      }
      if (closeRequestInFlightRef.current) return;

      closeRequestInFlightRef.current = true;
      if (saveTimeoutRef.current !== null) {
        window.clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
      }

      void (async () => {
        try {
          const currentHtml = normalizeEditorHtml(
            editorRef.current?.innerHTML ?? latestDraftHtmlRef.current,
          );
          latestDraftHtmlRef.current = currentHtml;
          if (currentHtml !== draftHtml) setDraftHtml(currentHtml);
          if (
            project &&
            initializedProjectKey === projectKey &&
            (currentHtml !== lastSavedHtml || saveInFlightRef.current)
          ) {
            await persistDraft(currentHtml);
          }
        } finally {
          closeRequestInFlightRef.current = false;
          onOpenChange(false);
        }
      })();
    },
    [
      draftHtml,
      initializedProjectKey,
      lastSavedHtml,
      onOpenChange,
      persistDraft,
      project,
      projectKey,
    ],
  );

  const saveStateLabel = loadError
    ? "Load failed"
    : isCreatingInitialFile
      ? "Creating file..."
      : isSaving
        ? "Saving..."
        : saveError
          ? "Save failed"
          : isDirty
            ? "Unsaved changes"
            : "Saved";

  return (
    <Sheet onOpenChange={handleSheetOpenChange} open={open}>
      <SheetPopup
        side="right"
        showCloseButton={false}
        className="h-dvh! w-[min(42rem,100vw)]! max-w-[42rem]! rounded-none border-s border-sidebar-border bg-sidebar surface-grain text-sidebar-foreground shadow-2xl"
      >
        <SheetHeader className="gap-3 border-b border-sidebar-border/70 pb-4">
          <div className="flex items-start justify-between gap-3 pr-1">
            <div className="min-w-0">
              <SheetTitle className="text-base">Project Todo</SheetTitle>
              <SheetDescription className="mt-1">
                {project
                  ? `${project.displayName} • saved as ${TODO_FILE_PATH}`
                  : "Project todo list"}
              </SheetDescription>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <div className="pt-0.5 text-xs text-muted-foreground/75">{saveStateLabel}</div>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                className="-me-1 -mt-1 size-8 rounded-lg text-muted-foreground hover:bg-background hover:text-foreground"
                aria-label="Close project todo"
                title="Close project todo"
                onClick={() => handleSheetOpenChange(false)}
              >
                <XIcon />
              </Button>
            </div>
          </div>
          <div className="rounded-2xl border border-sidebar-border/75 bg-sidebar-control-surface/90 p-2 shadow-sm">
            <div className="flex flex-wrap items-center gap-1.5">
              <ToolbarIconButton
                label="Bold"
                onClick={() => runEditorCommand("bold")}
                icon={<BoldIcon className="size-4" />}
              />
              <ToolbarIconButton
                label="Italic"
                onClick={() => runEditorCommand("italic")}
                icon={<ItalicIcon className="size-4" />}
              />
              <ToolbarIconButton
                label="Underline"
                onClick={() => runEditorCommand("underline")}
                icon={<UnderlineIcon className="size-4" />}
              />
              <ToolbarDivider />
              <ToolbarIconButton
                label="Bullets"
                onClick={() => runEditorCommand("insertUnorderedList")}
                icon={<ListIcon className="size-4" />}
              />
              <ToolbarIconButton
                label="Numbering"
                onClick={() => runEditorCommand("insertOrderedList")}
                icon={<ListOrderedIcon className="size-4" />}
              />
              <ToolbarDivider />
              <ToolbarSelect
                ariaLabel="Choose font"
                icon={<TypeIcon className="size-4" />}
                options={FONT_CHOICES}
                value={fontValue}
                onChange={(value) => {
                  setFontValue(value);
                  runEditorCommand("fontName", value);
                }}
              />
              <ToolbarSelect
                ariaLabel="Choose text color"
                icon={<PaletteIcon className="size-4" />}
                options={TEXT_COLOR_CHOICES}
                value={textColorValue}
                onChange={(value) => {
                  setTextColorValue(value);
                  runEditorCommand("foreColor", value || "inherit");
                }}
              />
              <ToolbarSelect
                ariaLabel="Choose highlight color"
                icon={<HighlighterIcon className="size-4" />}
                options={HIGHLIGHT_CHOICES}
                value={highlightValue}
                onChange={(value) => {
                  setHighlightValue(value);
                  runEditorCommand("hiliteColor", value || "transparent");
                }}
              />
            </div>
          </div>
        </SheetHeader>
        <SheetPanel className="h-full min-h-0 p-4">
          {loadError ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/8 px-3 py-2 text-sm text-destructive">
              {loadError}
            </div>
          ) : null}
          <div
            className={cn(
              "relative mt-3 min-h-[24rem] rounded-xl border border-sidebar-border/80 bg-background/70 shadow-inner",
              isFocused && "ring-2 ring-ring/40",
            )}
          >
            {(fileQuery.isPending && initializedProjectKey !== projectKey) ||
            isCreatingInitialFile ? (
              <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground/70">
                <LoaderIcon className="mr-2 size-4 animate-spin" />
                {isCreatingInitialFile ? "Creating project todo..." : "Loading todo…"}
              </div>
            ) : null}
            {isEmpty && !isFocused ? (
              <div className="pointer-events-none absolute left-4 top-4 text-sm text-muted-foreground/45">
                Capture tasks, notes, and checklists for this project.
              </div>
            ) : null}
            <div
              ref={editorRef}
              className="min-h-[24rem] px-5 py-4 text-[15px] leading-7 outline-none [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_font]:inherit [&_li]:my-1 [&_ol]:ml-5 [&_ol]:list-decimal [&_p]:my-2 [&_strong]:font-semibold [&_u]:underline [&_ul]:ml-5 [&_ul]:list-disc"
              contentEditable
              onFocus={() => setIsFocused(true)}
              onBlur={() => setIsFocused(false)}
              onInput={handleInput}
              onKeyDown={handleEditorKeyDown}
              suppressContentEditableWarning
              spellCheck
            />
          </div>
        </SheetPanel>
      </SheetPopup>
    </Sheet>
  );
}

function ToolbarIconButton(props: { label: string; onClick: () => void; icon: ReactNode }) {
  return (
    <Button
      type="button"
      size="icon-sm"
      variant="ghost"
      className="size-9 rounded-lg text-muted-foreground hover:bg-background hover:text-foreground"
      onClick={props.onClick}
      title={props.label}
      aria-label={props.label}
    >
      {props.icon}
    </Button>
  );
}

function ToolbarDivider() {
  return <div className="mx-1 h-6 w-px shrink-0 bg-sidebar-border/70" aria-hidden="true" />;
}

function ToolbarSelect(props: {
  ariaLabel: string;
  icon: ReactNode;
  options: ReadonlyArray<{ label: string; value: string; swatch?: string }>;
  value: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selectedOption =
    props.options.find((option) => option.value === props.value) ?? props.options[0];
  if (!selectedOption) return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        type="button"
        aria-label={props.ariaLabel}
        className="inline-flex h-9 min-w-0 max-w-full cursor-pointer items-center gap-2 rounded-lg border border-sidebar-border/80 bg-background/85 px-3 text-sm text-foreground outline-none transition-colors hover:bg-background focus-visible:ring-2 focus-visible:ring-ring"
      >
        {props.icon}
        {selectedOption.swatch !== undefined ? (
          <ColorSwatch color={selectedOption.swatch} label={selectedOption.label} />
        ) : null}
        <span className="font-medium">{selectedOption.label}</span>
        <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground/70" />
      </PopoverTrigger>
      <PopoverPopup align="start" className="w-44" viewportClassName="p-1">
        <div className="flex flex-col gap-0.5" role="listbox" aria-label={props.ariaLabel}>
          {props.options.map((option) => {
            const isSelected = option.value === selectedOption.value;
            return (
              <button
                key={`${props.ariaLabel}:${option.label}:${option.value}`}
                type="button"
                role="option"
                aria-selected={isSelected}
                className="flex min-h-9 w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-foreground outline-none hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground"
                onClick={() => {
                  props.onChange(option.value);
                  setOpen(false);
                }}
              >
                {option.swatch !== undefined ? (
                  <ColorSwatch color={option.swatch} label={option.label} />
                ) : (
                  <span
                    className="flex size-5 shrink-0 items-center justify-center rounded-md border border-border/70 text-muted-foreground"
                    style={{ fontFamily: option.value }}
                  >
                    A
                  </span>
                )}
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
                {isSelected ? <CheckIcon className="size-4 text-primary" /> : null}
              </button>
            );
          })}
        </div>
      </PopoverPopup>
    </Popover>
  );
}

function ColorSwatch(props: { color: string; label: string }) {
  const isNone = props.color === "transparent";
  return (
    <span
      aria-label={`${props.label} color`}
      className={cn(
        "relative size-5 shrink-0 rounded-full border border-black/12 shadow-inner",
        isNone && "rounded-md bg-background",
      )}
      style={isNone ? undefined : { backgroundColor: props.color }}
    >
      {isNone ? (
        <SlashIcon className="absolute inset-0 size-full p-0.5 text-muted-foreground" />
      ) : null}
    </span>
  );
}
