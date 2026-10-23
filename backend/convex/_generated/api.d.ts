/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as agentHosts from "../agentHosts.js";
import type * as agentRuns from "../agentRuns.js";
import type * as agentThreads from "../agentThreads.js";
import type * as agents from "../agents.js";
import type * as agentsTables from "../agentsTables.js";
import type * as modelHosts from "../modelHosts.js";
import type * as modelHostsTables from "../modelHostsTables.js";
import type * as auth from "../auth.js";
import type * as brand from "../brand.js";
import type * as brandTables from "../brandTables.js";
import type * as broadcast from "../broadcast.js";
import type * as broadcastTables from "../broadcastTables.js";
import type * as budgets from "../budgets.js";
import type * as callNotes from "../callNotes.js";
import type * as campaignTables from "../campaignTables.js";
import type * as campaigns from "../campaigns.js";
import type * as canvasCollab from "../canvasCollab.js";
import type * as chat from "../chat.js";
import type * as chiefHeartbeat from "../chiefHeartbeat.js";
import type * as chiefOpsTables from "../chiefOpsTables.js";
import type * as commits from "../commits.js";
import type * as connectors from "../connectors.js";
import type * as credentials from "../credentials.js";
import type * as crons from "../crons.js";
import type * as design from "../design.js";
import type * as documents from "../documents.js";
import type * as draw from "../draw.js";
import type * as drawTables from "../drawTables.js";
import type * as featureTables from "../featureTables.js";
import type * as feedback from "../feedback.js";
import type * as github from "../github.js";
import type * as githubLinks from "../githubLinks.js";
import type * as githubProtection from "../githubProtection.js";
import type * as githubPulls from "../githubPulls.js";
import type * as http from "../http.js";
import type * as inbox from "../inbox.js";
import type * as integrationTables from "../integrationTables.js";
import type * as integrations from "../integrations.js";
import type * as issueRelations from "../issueRelations.js";
import type * as legacyImport from "../legacyImport.js";
import type * as lib_agentAccess from "../lib/agentAccess.js";
import type * as lib_agentRunner from "../lib/agentRunner.js";
import type * as lib_agentThreadRows from "../lib/agentThreadRows.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_columns from "../lib/columns.js";
import type * as lib_completions from "../lib/completions.js";
import type * as lib_features from "../lib/features.js";
import type * as lib_githubAccess from "../lib/githubAccess.js";
import type * as lib_githubApi from "../lib/githubApi.js";
import type * as lib_invitationMail from "../lib/invitationMail.js";
import type * as lib_permissions from "../lib/permissions.js";
import type * as lib_repository from "../lib/repository.js";
import type * as lib_sealing from "../lib/sealing.js";
import type * as lib_storage from "../lib/storage.js";
import type * as lib_storageValidators from "../lib/storageValidators.js";
import type * as lib_taskBranches from "../lib/taskBranches.js";
import type * as lib_validators from "../lib/validators.js";
import type * as lib_vaultService from "../lib/vaultService.js";
import type * as memberProfiles from "../memberProfiles.js";
import type * as members from "../members.js";
import type * as meta from "../meta.js";
import type * as notifications from "../notifications.js";
import type * as org from "../org.js";
import type * as pages from "../pages.js";
import type * as pagesHttp from "../pagesHttp.js";
import type * as pagesTables from "../pagesTables.js";
import type * as personalCredentials from "../personalCredentials.js";
import type * as pipelineTables from "../pipelineTables.js";
import type * as planning from "../planning.js";
import type * as preferences from "../preferences.js";
import type * as projectDocs from "../projectDocs.js";
import type * as projectMilestones from "../projectMilestones.js";
import type * as projectPresence from "../projectPresence.js";
import type * as realtime from "../realtime.js";
import type * as realtimeTables from "../realtimeTables.js";
import type * as projects from "../projects.js";
import type * as pulse from "../pulse.js";
import type * as pulseTables from "../pulseTables.js";
import type * as sharedKeys from "../sharedKeys.js";
import type * as ship from "../ship.js";
import type * as shipTables from "../shipTables.js";
import type * as standup from "../standup.js";
import type * as standupTables from "../standupTables.js";
import type * as storage from "../storage.js";
import type * as studio from "../studio.js";
import type * as studioLibrary from "../studioLibrary.js";
import type * as studioTables from "../studioTables.js";
import type * as studioTemplates from "../studioTemplates.js";
import type * as studioUpload from "../studioUpload.js";
import type * as studioWorkflows from "../studioWorkflows.js";
import type * as taskPRs from "../taskPRs.js";
import type * as tasks from "../tasks.js";
import type * as teamGitHub from "../teamGitHub.js";
import type * as teams from "../teams.js";
import type * as wiki from "../wiki.js";
import type * as workspaceSearch from "../workspaceSearch.js";
import type * as workspaces from "../workspaces.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  agentHosts: typeof agentHosts;
  agentRuns: typeof agentRuns;
  agentThreads: typeof agentThreads;
  agents: typeof agents;
  agentsTables: typeof agentsTables;
  modelHosts: typeof modelHosts;
  modelHostsTables: typeof modelHostsTables;
  auth: typeof auth;
  brand: typeof brand;
  brandTables: typeof brandTables;
  broadcast: typeof broadcast;
  broadcastTables: typeof broadcastTables;
  budgets: typeof budgets;
  callNotes: typeof callNotes;
  campaignTables: typeof campaignTables;
  campaigns: typeof campaigns;
  canvasCollab: typeof canvasCollab;
  chat: typeof chat;
  chiefHeartbeat: typeof chiefHeartbeat;
  chiefOpsTables: typeof chiefOpsTables;
  commits: typeof commits;
  connectors: typeof connectors;
  credentials: typeof credentials;
  crons: typeof crons;
  design: typeof design;
  documents: typeof documents;
  draw: typeof draw;
  drawTables: typeof drawTables;
  featureTables: typeof featureTables;
  feedback: typeof feedback;
  github: typeof github;
  githubLinks: typeof githubLinks;
  githubProtection: typeof githubProtection;
  githubPulls: typeof githubPulls;
  http: typeof http;
  inbox: typeof inbox;
  integrationTables: typeof integrationTables;
  integrations: typeof integrations;
  issueRelations: typeof issueRelations;
  legacyImport: typeof legacyImport;
  "lib/agentAccess": typeof lib_agentAccess;
  "lib/agentRunner": typeof lib_agentRunner;
  "lib/agentThreadRows": typeof lib_agentThreadRows;
  "lib/auth": typeof lib_auth;
  "lib/columns": typeof lib_columns;
  "lib/completions": typeof lib_completions;
  "lib/features": typeof lib_features;
  "lib/githubAccess": typeof lib_githubAccess;
  "lib/githubApi": typeof lib_githubApi;
  "lib/invitationMail": typeof lib_invitationMail;
  "lib/permissions": typeof lib_permissions;
  "lib/repository": typeof lib_repository;
  "lib/sealing": typeof lib_sealing;
  "lib/storage": typeof lib_storage;
  "lib/storageValidators": typeof lib_storageValidators;
  "lib/taskBranches": typeof lib_taskBranches;
  "lib/validators": typeof lib_validators;
  "lib/vaultService": typeof lib_vaultService;
  memberProfiles: typeof memberProfiles;
  members: typeof members;
  meta: typeof meta;
  notifications: typeof notifications;
  org: typeof org;
  pages: typeof pages;
  pagesHttp: typeof pagesHttp;
  pagesTables: typeof pagesTables;
  personalCredentials: typeof personalCredentials;
  pipelineTables: typeof pipelineTables;
  planning: typeof planning;
  preferences: typeof preferences;
  projectDocs: typeof projectDocs;
  projectMilestones: typeof projectMilestones;
  projectPresence: typeof projectPresence;
  realtime: typeof realtime;
  realtimeTables: typeof realtimeTables;
  projects: typeof projects;
  pulse: typeof pulse;
  pulseTables: typeof pulseTables;
  sharedKeys: typeof sharedKeys;
  ship: typeof ship;
  shipTables: typeof shipTables;
  standup: typeof standup;
  standupTables: typeof standupTables;
  storage: typeof storage;
  studio: typeof studio;
  studioLibrary: typeof studioLibrary;
  studioTables: typeof studioTables;
  studioTemplates: typeof studioTemplates;
  studioUpload: typeof studioUpload;
  studioWorkflows: typeof studioWorkflows;
  taskPRs: typeof taskPRs;
  tasks: typeof tasks;
  teamGitHub: typeof teamGitHub;
  teams: typeof teams;
  wiki: typeof wiki;
  workspaceSearch: typeof workspaceSearch;
  workspaces: typeof workspaces;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
