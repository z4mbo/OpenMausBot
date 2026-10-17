import { test as base, expect } from '@playwright/test';
import { ConvexHttpClient } from 'convex/browser';
import { makeFunctionReference } from 'convex/server';
import { randomUUID } from 'node:crypto';

export { expect };
export function apiClient(person) {
  const client = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL, { logger: false });
  const args = values => ({ ...(person ? { sessionToken: person.sessionToken } : {}), ...values });
  return {
    q: (name, values = {}) => client.query(makeFunctionReference(name), args(values)),
    m: (name, values = {}) => client.mutation(makeFunctionReference(name), args(values)),
    a: (name, values = {}) => client.action(makeFunctionReference(name), args(values)),
  };
}
export async function fixture() {
  const id = randomUUID().slice(0, 8), password = `E2e-${randomUUID()}!`;
  const anon = apiClient();
  const signup = async (name, inviteToken) => {
    const email = `${name.toLowerCase()}-${id}@e2e.test`;
    const person = await anon.a('auth:signup', { name, email, password, workspaceName: `Gate ${id}`, ...(inviteToken ? { inviteToken } : {}) });
    return { ...person, name, email, handle: person.user.username || email.split('@')[0], password, api: apiClient(person) };
  };
  const owner = await signup('Owner');
  const workspace = (await owner.api.q('workspaces:list'))[0], teamId = workspace._id;
  const alpha = await owner.api.m('projects:create', { teamId, name: `Alpha ${id}` });
  const beta = await owner.api.m('projects:create', { teamId, name: `Beta ${id}` });
  async function join(name, role, projectId) {
    const invite = await owner.api.m('workspaces:createInvite', { teamId, ...(projectId ? { projectId } : {}), email: `${name.toLowerCase()}-${id}@e2e.test`, role });
    const person = await signup(name, invite.token);
    await person.api.m('workspaces:acceptInvite', { token: invite.token });
    return person;
  }
  const admin = await join('Admin', 'admin');
  const member = await join('Member', 'member', alpha);
  const other = await join('Other', 'member', beta);
  const viewer = await join('Viewer', 'viewer', alpha);
  // Intentionally project-member + workspace-viewer: effective access must remain read-only.
  const memberships = await admin.api.q('members:list', { projectId: alpha });
  const viewerMembership = memberships.find(m => m.email === viewer.email);
  if (viewerMembership) await admin.api.m('members:updateRole', { projectId: alpha, memberId: viewerMembership._id, role: 'member' });
  const board = await admin.api.q('tasks:board', { projectId: alpha });
  return { id, owner, admin, member, other, viewer, workspace, teamId, alpha, beta, board,
    scope: { teamId, projectId: alpha }, project: { projectId: alpha },
    url: (query = '') => `/${workspace.slug}?project=${alpha}${query ? `&${query}` : ''}`,
    task: (title, columnId = board.columns[0]._id) => member.api.m('tasks:createTask', { projectId: alpha, columnId, title, priority: 'medium', assignedToEmail: member.email, dueDate: '2026-12-31' }),
  };
}
export const test = base.extend({
  f: async ({}, provide) => { await provide(await fixture()); },
  clients: async ({ browser, f }, provide, testInfo) => {
    const contexts = [];
    const login = async (person, path = f.url(), options = {}) => {
      const context = await browser.newContext({ baseURL: process.env.ORIGIN_E2E_APP_URL, reducedMotion: 'reduce', permissions: ['camera', 'microphone'], viewport: { width: 1440, height: 1000 }, ...options });
      contexts.push(context);
      await context.addInitScript(({ token, userId }) => { localStorage.setItem('origin.sessionToken', token); localStorage.setItem(`origin.release-seen.${userId}`, '1.1'); }, { token: person.sessionToken, userId: person.user.id || person.user._id });
      const page = await context.newPage();
      page.setDefaultTimeout(15000);
      await page.goto(path);
      await expect(page.locator('.workspace-app')).toBeVisible();
      return page;
    };
    await provide({ login });
    for (const [index, context] of contexts.entries()) {
      if (testInfo.status !== testInfo.expectedStatus) {
        for (const [pageIndex, page] of context.pages().entries()) {
          await testInfo.attach(`client-${index}-page-${pageIndex}`, { body: await page.screenshot(), contentType: 'image/png' });
        }
      }
      // Playwright Test automatically traces every browser.newContext() with this
      // config, including these explicit multi-client contexts. Do not start or
      // stop its trace again; closing flushes this client's recording.
      await context.close();
    }
  },
});
export async function local(person, path, body) {
  const response = await fetch(`${process.env.ORIGIN_E2E_APP_URL}${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { Authorization: `Bearer ${person.sessionToken}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const result = await response.json();
  expect(response.ok, JSON.stringify(result)).toBeTruthy();
  return result;
}
