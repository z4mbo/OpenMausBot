import { test, expect } from '../support/fixtures.mjs';
import * as Y from 'yjs';

test('O-084 O-086 O-087 Draw basics persist across two browser contexts', async ({ clients, f }) => {
  const a = await clients.login(f.admin, `/${f.workspace.slug}?view=draw`);
  const b = await clients.login(f.member, `/${f.workspace.slug}?view=draw`);
  for (const [page, key, offset] of [[a, 'r', 0], [b, 'o', 160]]) {
    await expect(page.locator('.excalidraw canvas.interactive').first()).toBeVisible();
    await page.locator('.excalidraw canvas.interactive').first().click({ position: { x: 400, y: 300 } });
    await page.keyboard.press(key);
    const box = await page.locator('.excalidraw canvas.interactive').first().boundingBox();
    await page.mouse.move(box.x + 400 + offset, box.y + 300);
    await page.mouse.down(); await page.mouse.move(box.x + 500 + offset, box.y + 400, { steps: 8 }); await page.mouse.up();
    // A scene update can arrive during the drag. Await the final pointer-up
    // geometry before taking the persistence snapshot.
    await expect.poll(async () => {
      const elements = (await f.admin.api.q('draw:scene', { teamId: f.teamId })).map(s => JSON.parse(s)).filter(e => !e.isDeleted);
      return { count: elements.length, complete: elements.every(e => e.width === 100 && e.height === 100) };
    }).toEqual({ count: offset ? 2 : 1, complete: true });
  }
  const saved = await f.admin.api.q('draw:scene', { teamId: f.teamId });
  expect(saved.map(s => JSON.parse(s).type).sort()).toEqual(['ellipse', 'rectangle']);
  await expect.poll(async () => (await f.admin.api.q('draw:presence', { teamId: f.teamId })).length).toBeGreaterThanOrEqual(2);
  await b.reload();
  await expect(b.locator('.excalidraw canvas.interactive').first()).toBeVisible();
  // Excalidraw repairs fractional indices/bindings and increments versions on
  // remount. Preserve visible content, rather than its internal serialization.
  const content = rows => rows.map(row => { const { id, type, x, y, width, height, isDeleted } = JSON.parse(row); return { id, type, x, y, width, height, isDeleted }; }).sort((x, y) => x.id.localeCompare(y.id));
  expect(content(await f.member.api.q('draw:scene', { teamId: f.teamId }))).toEqual(content(saved));
});

test('O-085 O-086 canvas isolation and concurrent version conflict convergence', async ({ f }) => {
  const canvasId = await f.member.api.m('draw:createCanvas', { ...f.project, name: 'Canvas one' });
  const other = await f.member.api.m('draw:createCanvas', { ...f.project, name: 'Canvas two' });
  const scope = { teamId: f.teamId, canvasId };
  const element = { id: 'shared-rectangle', version: 1, versionNonce: 100, type: 'rectangle', x: 0, y: 0, width: 100, height: 100 };
  await f.member.api.m('draw:updateElements', { ...scope, elements: [JSON.stringify(element)] });
  await Promise.all([
    f.member.api.m('draw:updateElements', { ...scope, elements: [JSON.stringify({ ...element, version: 2, versionNonce: 20, x: 20 })] }),
    f.admin.api.m('draw:updateElements', { ...scope, elements: [JSON.stringify({ ...element, version: 2, versionNonce: 10, x: 10 })] }),
  ]);
  expect(JSON.parse((await f.member.api.q('draw:scene', scope))[0]).x).toBe(10);
  expect(await f.member.api.q('draw:scene', { teamId: f.teamId, canvasId: other })).toEqual([]);
  await f.member.api.m('draw:renameCanvas', { ...scope, name: 'Renamed canvas' });
  expect((await f.admin.api.q('draw:canvases', f.project)).some(c => c.name === 'Renamed canvas')).toBe(true);
});

test('O-091 O-092 O-093 O-094 document/wiki public API edit and Yjs convergence', async ({ f }) => {
  // Docs is component/API-only on this baseline: test real deployed functions, never invent a route.
  for (const type of ['wiki', 'process', 'decision', 'credential_note']) {
    const pageId = await f.member.api.m('wiki:create', { ...f.project, title: `Fixture ${type}`, content: 'Legacy content', type, tags: ['fixture'] });
    await f.member.api.m('documents:open', { pageId });
    const page = await f.member.api.q('documents:get', { pageId });
    const a = new Y.Doc(), b = new Y.Doc();
    Y.applyUpdate(a, new Uint8Array(page.collaborationState)); Y.applyUpdate(b, new Uint8Array(page.collaborationState));
    const vector = Y.encodeStateVector(a);
    a.getText('content').insert(a.getText('content').length, ' member');
    b.getText('content').insert(b.getText('content').length, ' admin');
    await Promise.all([
      f.member.api.m('documents:applyUpdate', { pageId, update: Y.encodeStateAsUpdate(a, vector).buffer }),
      f.admin.api.m('documents:applyUpdate', { pageId, update: Y.encodeStateAsUpdate(b, vector).buffer }),
    ]);
    const result = await f.member.api.q('documents:get', { pageId });
    expect(result.content).toContain('Legacy content'); expect(result.content).toContain('member'); expect(result.content).toContain('admin');
    await f.member.api.m('documents:rename', { pageId, title: `Updated ${type}` });
    expect((await f.admin.api.q('documents:list', { ...f.scope })).some(p => p.title === `Updated ${type}`)).toBe(true);
    await expect(f.viewer.api.m('wiki:update', { ...f.project, pageId, content: 'Forbidden' })).rejects.toThrow(/Edit/);
    await expect(f.other.api.q('documents:get', { pageId })).rejects.toThrow(/access/);
    await f.member.api.m('wiki:remove', { ...f.project, pageId });
    expect(await f.member.api.q('documents:get', { pageId })).toBeNull();
    a.destroy(); b.destroy();
  }
});

test('Legacy project/issue URL preserves reachable surfaces', async ({ clients, f }) => {
  const taskId = await f.task('Legacy issue link');
  const page = await clients.login(f.member, f.url(`issue=${taskId}`));
  await expect(page.getByLabel('Issue title', { exact: true })).toHaveValue('Legacy issue link');
});
