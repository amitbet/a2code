import { useCallback, useRef, useState, type DragEvent } from "react";
import { stackedThreadToast, toastManager } from "../components/ui/toast";
import { getEnvironmentBrowsePlatform } from "../lib/environmentPlatform";
import { ensureLocalApi } from "../localApi";
import { usePrimaryEnvironment } from "../state/environments";
import { useAddProjectFromPath } from "./useAddProjectFromPath";

export interface AddProjectDropZone {
  readonly isDropActive: boolean;
  readonly dropZoneProps: {
    readonly onDragEnter: (event: DragEvent<HTMLElement>) => void;
    readonly onDragOver: (event: DragEvent<HTMLElement>) => void;
    readonly onDragLeave: (event: DragEvent<HTMLElement>) => void;
    readonly onDrop: (event: DragEvent<HTMLElement>) => void;
  };
}

function failedDropToast(description: string) {
  toastManager.add(
    stackedThreadToast({
      type: "error",
      title: "Failed to add project",
      description,
    }),
  );
}

/**
 * Turn an element into a drop target that adds each dropped OS folder as a
 * project in the primary (local) environment. Dropped files only carry an
 * absolute path inside the desktop shell; plain browsers get a toast pointing
 * at the Add project flow instead.
 */
export function useAddProjectDropZone(): AddProjectDropZone {
  const [isDropActive, setIsDropActive] = useState(false);
  const dragDepthRef = useRef(0);
  const primaryEnvironment = usePrimaryEnvironment();
  const addProjectFromPath = useAddProjectFromPath();

  const onDragEnter = useCallback((event: DragEvent<HTMLElement>) => {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    dragDepthRef.current += 1;
    setIsDropActive(true);
  }, []);

  const onDragOver = useCallback((event: DragEvent<HTMLElement>) => {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setIsDropActive(true);
  }, []);

  const onDragLeave = useCallback((event: DragEvent<HTMLElement>) => {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) {
      setIsDropActive(false);
    }
  }, []);

  const onDrop = useCallback(
    (event: DragEvent<HTMLElement>) => {
      if (!event.dataTransfer.types.includes("Files")) return;
      event.preventDefault();
      dragDepthRef.current = 0;
      setIsDropActive(false);

      // Directory checks and path resolution must happen synchronously: the
      // DataTransfer items are only readable during the drop event.
      const droppedDirectories: File[] = [];
      let sawNonDirectory = false;
      for (const item of Array.from(event.dataTransfer.items)) {
        if (item.kind !== "file") continue;
        const file = item.getAsFile();
        if (item.webkitGetAsEntry()?.isDirectory === true && file) {
          droppedDirectories.push(file);
        } else {
          sawNonDirectory = true;
        }
      }

      if (droppedDirectories.length === 0) {
        if (sawNonDirectory) {
          failedDropToast("Only folders can be added as projects.");
        }
        return;
      }

      const localApi = ensureLocalApi();
      const paths = droppedDirectories
        .map((file) => localApi.files.getPathForFile(file))
        .filter((path): path is string => path !== null && path.length > 0);
      if (paths.length === 0) {
        failedDropToast("Dropping folders requires the desktop app.");
        return;
      }

      const environment = primaryEnvironment;
      if (!environment) {
        failedDropToast("No environment is available.");
        return;
      }
      const platform = getEnvironmentBrowsePlatform(
        environment.serverConfig?.environment.platform.os,
      );

      void (async () => {
        for (const path of paths) {
          await addProjectFromPath({
            environmentId: environment.environmentId,
            rawCwd: path,
            platform,
            currentProjectCwd: null,
          });
        }
      })();
    },
    [addProjectFromPath, primaryEnvironment],
  );

  return {
    isDropActive,
    dropZoneProps: { onDragEnter, onDragOver, onDragLeave, onDrop },
  };
}
