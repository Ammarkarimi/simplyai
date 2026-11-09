import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface WorkspaceState {
  workspaceId: string | null;
  sidebarCollapsed: boolean;
  setWorkspace(id: string | null): void;
  toggleSidebar(): void;
}

export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set) => ({
      workspaceId: null,
      sidebarCollapsed: false,
      setWorkspace: (workspaceId) => set({ workspaceId }),
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
    }),
    { name: 'simplyai.workspace' },
  ),
);
