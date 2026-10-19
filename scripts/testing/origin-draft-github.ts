import "./origin-pages-cloud";

const calls: { projectId: string; taskIds: string[] }[] = [];
Object.assign((window as unknown as { originPagesFixture: object }).originPagesFixture, { githubCalls: calls });
export const originGitHub = {
  async mirrorIssues(projectId: string, taskIds: string[]) {
    calls.push({ projectId, taskIds });
    return { results: taskIds.map(taskId => ({ taskId, issueNumber: 42 })) };
  },
};
