"use client";

import { createContext, useContext } from "react";

export const WorkspaceOnlineContext = createContext(true);
export const useWorkspaceOnline = () => useContext(WorkspaceOnlineContext);
export const RECONNECT_TO_CREATE = "Reconnect to create";
