import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  BoldIcon,
  ChevronDownIcon,
  HighlighterIcon,
  ItalicIcon,
  ListIcon,
  ListOrderedIcon,
  LoaderIcon,
  PaletteIcon,
  TypeIcon,
  UnderlineIcon,
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
const SAVE_DEBOUNCE_MS = 500;
const FONT_CHOICES = [
  { label: "Sans", value: "system-ui" },
  { label: "Serif", value: "Georgia" },
  { label: "Mono", value: "'JetBrains Mono'" },
];
const TEXT_COLOR_CHOICES = [
  { label: "Default", value: "" },
  { label: "Slate", value: "#334155" },
  { label: "Blue", value: "#2563eb" },
  { label: "Green", value: "#15803d" },
  { label: "Red", value: "#dc2626" },
  { label: "Amber", value: "#d97706" },
];
const HIGHLIGHT_CHOICES = [
  { label: "None", value: "" },
  { label: "Yellow", value: "#fef08a" },
  { label: "Mint", value: "#bbf7d0" },
  { label: "Sky", value: "#bae6fd" },
  { label: "Rose", value: "#fecdd3" },
];

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

export function ProjectTodoSheet({ open, onOpenChange, project }: ProjectTodoSheetProps) {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const missingFileBootstrapRef = useRef<string | null>(null);
  const [draftHtml, setDraftHtml] = useState("");
  const [lastSavedHtml, setLastSavedHtml] = useState("");
  const [initializedProjectKey, setInitializedProjectKey] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isFocused, setIsFocused] = useState(false);
  const [isCreatingInitialFile, setIsCreatingInitialFile] = useState(false);
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
    if (!open || !project || !missingFile || fileQuery.isPending || projectKey === null) return;
    if (missingFileBootstrapRef.current === projectKey) return;

    missingFileBootstrapRef.current = projectKey;
    setSaveError(null);
    setDraftHtml("");
    setLastSavedHtml("");
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

  useEffect(() => {
    if (!open || !project || initializedProjectKey !== projectKey || !isDirty) return;
    const timeoutId = window.setTimeout(() => {
      const nextHtml = draftHtml;
      setIsSaving(true);
      setSaveError(null);
      setProjectFileQueryData(
        project.environmentId,
        project.workspaceRoot,
        TODO_FILE_PATH,
        nextHtml,
      );
      void (async () => {
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
          setLastSavedHtml(nextHtml);
          confirmProjectFileQueryData(
            project.environmentId,
            project.workspaceRoot,
            TODO_FILE_PATH,
            nextHtml,
          );
          return;
        }
        clearProjectFileQueryData(project.environmentId, project.workspaceRoot, TODO_FILE_PATH);
        const error = squashAtomCommandFailure(result);
        setSaveError(error instanceof Error ? error.message : "Could not save todo.");
      })();
    }, SAVE_DEBOUNCE_MS);

    return () => window.clearTimeout(timeoutId);
  }, [draftHtml, initializedProjectKey, isDirty, open, project, projectKey, writeProjectFile]);

  const handleInput = useCallback(() => {
    const nextHtml = normalizeEditorHtml(editorRef.current?.innerHTML ?? "");
    setDraftHtml(nextHtml);
    if (editorRef.current && nextHtml.length === 0 && editorRef.current.innerHTML !== "") {
      editorRef.current.innerHTML = "";
    }
  }, []);

  const runEditorCommand = useCallback(
    (command: string, value?: string) => {
      editorRef.current?.focus();
      document.execCommand(command, false, value);
      handleInput();
    },
    [handleInput],
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
    <Sheet onOpenChange={onOpenChange} open={open}>
      <SheetPopup
        side="left"
        className="h-dvh! w-[min(42rem,100vw)]! max-w-[42rem]! rounded-none border-e border-sidebar-border bg-sidebar surface-grain text-sidebar-foreground shadow-2xl"
      >
        <SheetHeader className="gap-3 border-b border-sidebar-border/70 pb-4">
          <div className="flex items-start justify-between gap-3 pr-8">
            <div className="min-w-0">
              <SheetTitle className="text-base">Project Todo</SheetTitle>
              <SheetDescription className="mt-1">
                {project
                  ? `${project.displayName} • saved as ${TODO_FILE_PATH}`
                  : "Project todo list"}
              </SheetDescription>
            </div>
            <div className="pt-0.5 text-xs text-muted-foreground/75">{saveStateLabel}</div>
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
                label="Font"
                icon={<TypeIcon className="size-4" />}
                options={FONT_CHOICES}
                onChange={(value) => runEditorCommand("fontName", value)}
              />
              <ToolbarSelect
                ariaLabel="Choose text color"
                label="Text"
                icon={<PaletteIcon className="size-4" />}
                options={TEXT_COLOR_CHOICES}
                onChange={(value) => runEditorCommand("foreColor", value || "inherit")}
              />
              <ToolbarSelect
                ariaLabel="Choose highlight color"
                label="Highlight"
                icon={<HighlighterIcon className="size-4" />}
                options={HIGHLIGHT_CHOICES}
                onChange={(value) => runEditorCommand("hiliteColor", value || "transparent")}
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
  label: string;
  icon: ReactNode;
  options: ReadonlyArray<{ label: string; value: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <label className="relative flex h-9 items-center gap-2 rounded-lg border border-sidebar-border/80 bg-background/85 px-3 text-sm text-muted-foreground">
      {props.icon}
      <span className="font-medium text-foreground/90">{props.label}</span>
      <select
        aria-label={props.ariaLabel}
        className="min-w-0 appearance-none bg-transparent pr-6 text-foreground outline-none"
        defaultValue=""
        onChange={(event) => {
          props.onChange(event.target.value);
          event.target.value = "";
        }}
      >
        <option value="" disabled>
          {props.label}
        </option>
        {props.options.map((option) => (
          <option key={`${props.ariaLabel}:${option.label}:${option.value}`} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDownIcon className="pointer-events-none absolute right-2.5 size-4 text-muted-foreground/70" />
    </label>
  );
}
