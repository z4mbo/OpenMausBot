export type CloudUser = { _id: string; email: string; name?: string; username?: string };

export type CloudWorkspace = { _id: string; name: string; slug?: string };

export type CloudProject = { _id: string; teamId: string; name: string; description?: string; repoUrl?: string; accent?: string };
