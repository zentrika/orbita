"use client";

import { createContext, useContext } from "react";

export type TaskDefaults = { project_id?: number; status_id?: number; due_date?: string; start_date?: string };
export const WorkspaceCtx = createContext<{ newTask: (d?: TaskDefaults) => void; newProject: () => void }>({
  newTask: () => {},
  newProject: () => {},
});
export const useWorkspace = () => useContext(WorkspaceCtx);
