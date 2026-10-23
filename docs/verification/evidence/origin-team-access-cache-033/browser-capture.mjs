import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';

const output = join(dirname(fileURLToPath(import.meta.url)), 'sidebar-proof-4');
mkdirSync(output);
const root = 'C:/Users/aless/.codex/worktrees/origin-team-cache-033/Origin';
const base = 'd09a9202130ef58976aea8ee6c221dc433f97e25';
const git = (...args) => execFileSync('C:/Program Files/Git/cmd/git.exe', ['-C', root, ...args], { encoding: 'utf8', windowsHide: true });
const baselineStore = git('show', `${base}:src/state/store.tsx`);
const fixedStore = readFileSync(join(root, 'src/state/store.tsx'), 'utf8').replace(/\r\n/g, '\n');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const safe = Object.fromEntries(Object.entries(process.env).filter(([key]) => ['SYSTEMROOT', 'WINDIR', 'COMSPEC', 'PATHEXT'].includes(key.toUpperCase())));
for (const key of Object.keys(process.env)) delete process.env[key];
Object.assign(process.env, safe, { PATH: dirname(process.execPath), TEMP: output, TMP: output, TMPDIR: output,
  HOME: join(output, 'bootstrap'), USERPROFILE: join(output, 'bootstrap'), OMB_DATA_DIR: join(output, 'bootstrap'),
  APPDATA: join(output, 'bootstrap/AppData/Roaming'), LOCALAPPDATA: join(output, 'bootstrap/AppData/Local'), OMB_TEST_SEALED_PATH: '1' });
mkdirSync(process.env.OMB_DATA_DIR, { recursive: true });
const { chromium } = createRequire('C:/Users/aless/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core/package.json')('playwright-core');
const { launchVerificationServer } = await import(pathToFileURL(join(root, 'scripts/control-omb.ts')));
const { mountPreview } = await import(pathToFileURL(join(root, 'scripts/testing/preview-fixture.ts')));
const report = { base, fix: git('rev-parse', 'HEAD').trim(), startedAt: new Date().toISOString(),
  baselineStoreSha256: sha(baselineStore), fixedStoreSha256: sha(fixedStore), cases: [], fixtures: [], errors: [], blockedRequests: [],
  corrections: ['The Additional teams panel is hidden by SHOWS_CHIEF_LABEL=false in shipped Origin. Its prior direct component render was conditional, not a visible Origin screen. This capture targets the actual App/Sidebar workspace-project consumer instead.'],
  boundary: 'Actual Sidebar component and StoreProvider against isolated local fake-engine server, known account-workspace membership supplied through the same setAccountWorkspaces API used after Origin sync; OriginSync and full App excluded; no cloud backend or Origin session, native bridge simulated; role transitions use registered owner PATCH route, not a shipped role-toggle control' };
const browser = await chromium.launch({ executablePath: 'C:/Users/aless/AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe', headless: true, args: ['--no-first-run', '--disable-background-networking'] });
try {
  for (const phase of ['before', 'after']) {
    const fixture = await launchVerificationServer({ ...safe, OMB_TEST_PORTS: phase === 'before' ? '23300-23330' : '23332-23362' });
    let preview;
    const metadata = { phase, info: fixture.info };
    report.fixtures.push(metadata);
    const api = async (method, path, body, expected = 200) => {
      const response = await fetch(fixture.info.url + path, { method, headers: { 'content-type': 'application/json', origin: fixture.info.url }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      const result = await response.json(); assert.equal(response.status, expected, JSON.stringify(result)); return result;
    };
    try {
      const starter = (await api('GET', '/api/bots')).bots.find(bot => bot.name === 'Fixture Starter');
      if (starter) await api('DELETE', `/api/bots/${starter.id}`);
      await api('PUT', '/api/config', { language: 'en', onboarding: { completedAt: '2026-10-18T00:00:00.000Z', version: 1, firstTurnAt: '2026-10-18T00:00:00.000Z', memberSetupAt: '2026-10-18T00:00:00.000Z', hintsSeen: ['first-conversation', 'project-tour'] } });
      const a = (await api('POST', '/api/workspaces', { name: 'Cache proof' }, 201)).bot;
      const b = (await api('POST', '/api/bots', { name: 'Replacement workspace Chief', section: a.section, modelSelection: a.modelSelection }, 201)).bot;
      const rawProject = (await api('POST', '/api/bots', { name: 'Research project', modelSelection: a.modelSelection }, 201)).bot;
      const project = (await api('POST', `/api/bots/${rawProject.id}/default-team`, { workspaceId: a.id }, 201)).chief;
      metadata.workspaceId = a.id;
      metadata.projectId = project.id;
      const entry = `import { createRoot } from 'react-dom/client';
        import { Sidebar } from '../../src/components/Sidebar';
        import { StoreProvider } from '../../src/state/store';
        import { setAccountWorkspaces } from '../../src/lib/origin-workspaces';
        import { setAnalyticsEnabled, setEmailGateDone } from '../../src/lib/analytics';
        import { initialDesktopCapabilities } from '../../src/lib/desktop';
        import { rememberConversation } from '../../src/lib/last-conversation';
        import { setAdvancedMode } from '../../src/lib/interface-mode';
        import { saveSidebarWidth, setSidebarDensity } from '../../src/lib/sidebar-preferences';
        import { applySkin } from '../../src/lib/skins';
        import '../../src/styles.css';
        setAnalyticsEnabled(false); setEmailGateDone('skipped'); setAdvancedMode(true);
        setSidebarDensity('comfortable'); saveSidebarWidth(272);
        localStorage.setItem('origin-workspaces', JSON.stringify({ active: ${JSON.stringify(a.id)}, order: [${JSON.stringify(project.id)}], sort: 'custom', collapsed: false }));
        setAccountWorkspaces([${JSON.stringify(a.id)}]);
        localStorage.removeItem('origin-cloud-url'); localStorage.removeItem('origin-cloud-session');
        rememberConversation(${JSON.stringify(a.id)});
        applySkin(new URLSearchParams(location.search).get('theme') === 'light' ? 'daylight' : 'midnight');
        Object.assign(window, { ogb: { platform: 'win32', getCapabilities: async () => initialDesktopCapabilities(), workspaces: { state: async () => ({ local: true, name: 'This computer' }), menu: async () => {} } } });
        createRoot(document.getElementById('root')!).render(<StoreProvider><div className='flex h-screen bg-app text-ink'><Sidebar open={true} onClose={() => {}} /></div></StoreProvider>);`;
      metadata.fixtureEntrySha256 = sha(entry);
      writeFileSync(join(output, `${phase}-entry.tsx`), entry, { flag: 'wx' });
      preview = await mountPreview(fixture, { entry: '/scripts/testing/threads-preview.tsx', route: '/__team-cache-sidebar.html', title: 'Origin isolated workspace membership', logLevel: 'warn', hmr: false,
        plugins: [{ name: 'team-cache-sidebar-proof', enforce: 'pre', load(id) {
          const path = id.replace(/\\/g, '/').split('?')[0];
          if (path === join(root, 'scripts/testing/threads-preview.tsx').replace(/\\/g, '/')) return entry;
          if (phase === 'before' && path === join(root, 'src/state/store.tsx').replace(/\\/g, '/')) return baselineStore;
        } }],
      });
      metadata.previewUrl = preview.previewUrl;
      console.log(JSON.stringify({ phase, stage: 'preview-ready', url: preview.previewUrl }));
      for (const theme of ['light', 'dark']) {
        await api('PATCH', `/api/bots/${a.id}`, { chiefOfStaff: true });
        await api('PATCH', `/api/bots/${a.id}`, { managedSections: [project.section], acknowledgePeerScope: true });
        const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1, colorScheme: theme, reducedMotion: 'reduce', serviceWorkers: 'block' });
        const allowed = new Set([new URL(preview.previewUrl).origin, fixture.info.url]);
        await context.route('**/*', async route => {
          const url = new URL(route.request().url());
          if (allowed.has(url.origin) || ['data:', 'blob:'].includes(url.protocol)) await route.continue();
          else { report.blockedRequests.push({ phase, theme, origin: url.origin, path: url.pathname }); await route.abort(); }
        });
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        try {
          await page.goto(preview.previewUrl + '?theme=' + theme, { waitUntil: 'domcontentloaded', timeout: 240000 });
          const row = page.locator(`[data-sidebar-bot-row="${project.id}"]`);
          await row.waitFor({ state: 'visible', timeout: 240000 });
          await api('PATCH', `/api/bots/${b.id}`, { chiefOfStaff: true });
          const headRow = page.locator(`[data-sidebar-bot-row="${a.id}"]`);
          await headRow.waitFor({ state: 'hidden', timeout: 10000 });
          await api('PATCH', `/api/bots/${a.id}`, { chiefOfStaff: true });
          await headRow.waitFor({ state: 'visible', timeout: 10000 });
          if (phase === 'before') await row.waitFor({ state: 'visible', timeout: 10000 });
          else {
            assert.equal(await row.count(), 0);
          }
          const saved = (await api('GET', '/api/bots?messages=0')).bots.find(bot => bot.id === a.id);
          assert.equal(saved.chiefOfStaff, true);
          assert.equal(Object.hasOwn(saved, 'managedSections'), false);
          const record = { phase, theme, visibleProjectRows: await row.count(), authoritative: { chiefOfStaff: saved.chiefOfStaff, hasManagedSections: Object.hasOwn(saved, 'managedSections') },
            layout: await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth, skin: document.documentElement.dataset.skin, reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches })), errors,
          };
          assert.equal(record.visibleProjectRows, phase === 'before' ? 1 : 0);
          assert.deepEqual(errors, []);
          assert.ok(record.layout.scrollWidth <= record.layout.width);
          const filename = `${phase}-1440-${theme}.png`;
          const bytes = await page.screenshot({ path: join(output, filename), fullPage: false, animations: 'disabled' });
          record.screenshot = { filename, bytes: bytes.length, sha256: sha(bytes) };
          report.cases.push(record);
          console.log(JSON.stringify({ phase, theme, stage: 'captured', visibleProjectRows: record.visibleProjectRows }));
        } catch (error) {
          writeFileSync(join(output, `${phase}-${theme}-failed-dom.txt`), await page.locator('body').innerText(), { flag: 'wx' });
          await page.screenshot({ path: join(output, `${phase}-${theme}-failed.png`), fullPage: false });
          throw error;
        } finally { await context.close(); }
      }
      metadata.fakeEngineStarted = existsSync(fixture.fixtureDumpPath);
      assert.equal(metadata.fakeEngineStarted, false);
    } finally {
      await preview?.close(); await fixture.close();
      metadata.stopped = fixture.child.exitCode !== null || fixture.child.signalCode !== null;
      metadata.fixtureDataRemoved = !existsSync(fixture.info.dataDir);
    }
  }
} catch (error) { report.errors.push({ name: error.name, message: error.message, stack: error.stack }); process.exitCode = 1; }
finally {
  await browser.close(); report.browserClosed = !browser.isConnected(); report.endedAt = new Date().toISOString();
  const path = join(output, 'report.json'); writeFileSync(path, JSON.stringify(report, null, 2), { flag: 'wx' });
  console.log(JSON.stringify({ report: path, sha256: sha(readFileSync(path)), cases: report.cases.length, errors: report.errors }));
}
