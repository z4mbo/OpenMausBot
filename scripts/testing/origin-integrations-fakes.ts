// Stand-ins for the Origin workspace, project, GitHub and cloud modules the Integrations settings read, so the isolated
// page renders a signed-in workspace owner while every /api request still reaches only the disposable server.
const github = {
  configured: true, localApp: false, canSetup: false, login: "acme", sealing: true, canManage: true, canShare: false, shareError: null,
  shared: { accountLogin: "acme", accountType: "Organization", connectorLogin: "ada", sharedByName: "Ada", updatedAt: 1 },
  sharedStale: false, linkedLogin: "mia", prPermissionNotice: null, permissionApprovalUrl: "", installationUrl: null,
};

export const originGitHub = new Proxy({ workspace: async () => github } as Record<string, unknown>, {
  get: (target, name: string) => target[name] ?? (async () => ({})),
});

export const useActiveOriginWorkspace = () => ({ headId: "fixture-head", teamId: "fixture-team" });
export const useCanCreateProject = () => true;
export const useWorkspacePeople = () => ({ members: [], myEmail: "ada@fixture.test" });
export const useWorkspaceAccess = () => ({ teamId: "fixture-team", slug: "acme", role: "owner" });
export const useWorkspaceMembers = () => [];
export const useOriginProjects = () => ({ rows: [{ _id: "fixture-project", teamId: "fixture-team", name: "Origin", status: "active", memberRole: "owner" }], status: new Map() });
export const canManageProject = () => true;
export const sessionStore = { get: () => "origin-integrations-fixture-token" };
export const cloudAction = async () => null;
export const cloudMutation = async () => null;
export const useCloudQuery = () => undefined;
export const useCloudSession = () => ({ token: sessionStore.get(), user: { _id: "fixture-user", email: "ada@fixture.test" }, ready: true });
export const useCloudUrl = () => location.origin;
export const cloudUrl = () => location.origin;
export const createOriginWorkspace = async () => ({ teamId: "fixture-team" });
