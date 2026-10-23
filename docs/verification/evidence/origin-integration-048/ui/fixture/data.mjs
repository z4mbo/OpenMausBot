import { fixtureProject, fixtureMe } from '/scripts/testing/origin-pages-cloud.ts';
import { newNode } from '/shared/canvas-ops.ts';
import { encodeNode } from '/shared/canvas-scene.ts';
import { DEFAULT_LEAD_FORM } from '/shared/canvas-page.ts';
import '/__chiefdata048.ts';

const params = new URLSearchParams(location.search);
const empty = params.get('state') === 'empty';
const canEdit = params.get('role') !== 'viewer';
const now = Date.now();
const store = window.originPagesFixture;
const art = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240"><rect width="320" height="240" fill="#23475a"/><circle cx="160" cy="120" r="75" fill="#8bb9c7"/></svg>');
const post = { _id: 'fixture-post', projectId: fixtureProject._id, variants: [{ channel: 'x', text: 'Synthetic project launch announcement.' }], assetIds: [], status: 'draft', createdAt: now, updatedAt: now, media: [], needsApproval: true, agentName: 'Copywriter' };
const campaign = { _id: 'fixture-campaign', name: 'Spring launch', slug: 'spring-launch', goal: '200 beta sign-ups from indie founders.', audience: 'Indie founders', channels: ['x', 'bluesky'], startDate: '2026-10-20', endDate: '2026-11-20', budgetNote: 'Synthetic planning budget', status: 'running', counts: { posts: 2, published: 1, generations: 1, leads: 2, won: 1, openIssues: 1 }, createdAt: now, updatedAt: now };
const leads = [
  { _id: 'fixture-lead', projectId: fixtureProject._id, name: 'Aria Example', company: 'Example Studio', email: 'aria@example.test', phone: '+12025550101', source: 'spring-launch', stage: 'Qualified', order: 1, value: 5000, tags: ['Review'], nextStep: 'Arrange a walkthrough', unreadReplies: 1, lastReplyAt: now - 3600000, stageChangedAt: now - 8 * 86400000, createdAt: now - 10 * 86400000, updatedAt: now },
  { _id: 'fixture-lead-second', projectId: fixtureProject._id, name: 'Robin Example', company: 'Example Studio', email: 'robin@example.test', source: 'Synthetic fixture', stage: 'New', order: 1, value: 1200, tags: [], createdAt: now, updatedAt: now },
];
const sequence = { _id: 'fixture-sequence', leadId: 'fixture-lead', status: 'active', steps: [{ day: 0, channel: 'email', subject: 'Hello {first_name}', body: 'Synthetic introduction', state: 'done' }, { day: 3, channel: 'sms', body: 'Synthetic follow-up', state: 'drafted' }, { day: 7, channel: 'call_task', body: 'Ask about the next milestone', state: 'waiting' }], startedAt: now - 3 * 86400000, nextDueAt: now + 86400000, createdBy: { kind: 'member', id: fixtureMe._id, name: fixtureMe.name }, updatedAt: now };
const nodes = [
  newNode('frame', null, 1, { id: 'fixture-frame', name: 'Waitlist', x: 0, y: 0, width: 960, height: 640, fill: '#13232f', radius: 16 }),
  newNode('text', 'fixture-frame', 1, { id: 'fixture-heading', name: 'Heading', x: 48, y: 48, width: 800, height: 70, text: 'Every project gets a team', fontSize: 42, fontWeight: 700, fill: '#ffffff' }),
  newNode('rect', 'fixture-frame', 2, { id: 'fixture-link', name: 'Linked button', x: 48, y: 150, width: 220, height: 54, fill: '#347eb0', radius: 12, link: 'https://example.test/product' }),
  newNode('frame', 'fixture-frame', 3, { id: 'fixture-form', name: 'Waitlist form', x: 48, y: 260, width: 420, height: 250, fill: '#e8edf0', radius: 12, leadForm: { ...DEFAULT_LEAD_FORM } }),
];
const published = { _id: 'fixture-page', canvasId: 'fixture-canvas', frameId: 'fixture-frame', slug: 'waitlist', title: 'Early access', description: 'Synthetic preview page', url: 'https://origin.example.test/p/synthetic/waitlist', views: 124, leads: 9, leadForms: 1, publishedBy: 'Synthetic reviewer', updatedAt: now };
const settings = { configured: true, captureEnabled: false, inboundEnabled: true, autoSend: false, currency: 'USD', aiAgentId: 'synthetic-agent', aiPhoneNumberId: 'synthetic-number' };
const replies = [{ _id: 'fixture-reply', leadId: 'fixture-lead', kind: 'email', status: 'received', actor: { kind: 'member', name: 'Aria Example' }, subject: 'Project walkthrough', body: 'A synthetic inbound reply for UI inspection.', createdAt: now - 3600000, updatedAt: now }];
const values = {
  'workspaces:list': [{ _id: 'fixture-team', name: 'Synthetic workspace' }],
  'broadcast:list': { canEdit, posts: empty ? [] : [post] },
  'campaigns:list': { canEdit, campaigns: empty ? [] : [campaign] },
  'campaigns:get': { ...campaign, posts: [{ ...post, excerpt: post.variants[0].text }, { _id: 'fixture-published', status: 'published', needsApproval: false, excerpt: 'Synthetic published announcement', variants: [{ channel: 'x', result: 'published', publishedAt: now - 86400000 }] }], generations: [{ _id: 'fixture-generation', kind: 'image', status: 'done', prompt: 'Synthetic launch card', modelLabel: 'Fixture', output: art, createdAt: now }], leads: leads.map(lead => ({ ...lead, linked: true })), stages: [{ stage: 'Qualified', count: 1, value: 5000 }], currency: 'USD', issues: [{ _id: 'fixture-task-one', title: 'Review the launch page', done: false, column: 'Draft', priority: 'medium' }], metrics: [{ postId: 'fixture-published', channel: 'x', likes: 24, reposts: 7, replies: 3, impressions: 400, at: now }], metricsAt: now },
  'studio:list': empty ? [] : [{ _id: 'fixture-generation', projectId: fixtureProject._id, kind: 'image', status: 'done', prompt: 'Synthetic launch card', modelLabel: 'Fixture', outputs: [{ url: art, kind: 'image' }], createdAt: now }],
  'design:list': { assets: [], tokens: [], folders: [] },
  'pipeline:board': { stages: ['New', 'Contacted', 'Qualified', 'Proposal', 'Won', 'Lost'], leads: empty ? [] : leads, settings, pending: [] },
  'pipeline:lead': { lead: leads[0], activities: replies },
  'pipelineSequences:forLead': params.get('sequence') === 'none' ? null : sequence,
  'draw:canvases': empty ? [] : [{ _id: 'fixture-canvas', name: 'Website' }],
  'draw:scene': empty ? [] : nodes.map(encodeNode),
  'draw:files': [], 'draw:presence': [],
  'pages:list': { pages: params.get('pages') === 'empty' || empty ? [] : [published], captureEnabled: false },
};
for (const [name, value] of Object.entries(values)) store.setQuery(name, value);
export { leads, replies, sequence };
