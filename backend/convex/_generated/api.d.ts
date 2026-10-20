/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as agentRuns from "../agentRuns.js";
import type * as agentThreads from "../agentThreads.js";
import type * as agents from "../agents.js";
import type * as agentsTables from "../agentsTables.js";
import type * as modelHosts from "../modelHosts.js";
import type * as modelHostsTables from "../modelHostsTables.js";
import type * as auth from "../auth.js";
import type * as broadcast from "../broadcast.js";
import type * as broadcastTables from "../broadcastTables.js";
import type * as budgets from "../budgets.js";
import type * as callNotes from "../callNotes.js";
import type * as campaignTables from "../campaignTables.js";
import type * as campaigns from "../campaigns.js";
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
import type * as featureTables from "../featureTables.js";
import type * as feedback from "../feedback.js";
import type * as github from "../github.js";
import type * as http from "../http.js";
import type * as inbox from "../inbox.js";
import type * as integrations from "../integrations.js";
import type * as issueRelations from "../issueRelations.js";
import type * as legacyImport from "../legacyImport.js";
import type * as lib_agentAccess from "../lib/agentAccess.js";
import type * as lib_agentThreadRows from "../lib/agentThreadRows.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_columns from "../lib/columns.js";
import type * as lib_completions from "../lib/completions.js";
import type * as lib_features from "../lib/features.js";
import type * as lib_invitationMail from "../lib/invitationMail.js";
import type * as lib_permissions from "../lib/permissions.js";
import type * as lib_pipelineCore from "../lib/pipelineCore.js";
import type * as lib_repository from "../lib/repository.js";
import type * as lib_storage from "../lib/storage.js";
import type * as lib_storageValidators from "../lib/storageValidators.js";
import type * as lib_taskBranches from "../lib/taskBranches.js";
import type * as lib_validators from "../lib/validators.js";
import type * as memberProfiles from "../memberProfiles.js";
import type * as members from "../members.js";
import type * as meta from "../meta.js";
import type * as notifications from "../notifications.js";
import type * as org from "../org.js";
import type * as pages from "../pages.js";
import type * as pagesHttp from "../pagesHttp.js";
import type * as pagesTables from "../pagesTables.js";
import type * as pipeline from "../pipeline.js";
import type * as pipelineCapture from "../pipelineCapture.js";
import type * as pipelineInbound from "../pipelineInbound.js";
import type * as pipelineSequences from "../pipelineSequences.js";
import type * as pipelineTables from "../pipelineTables.js";
import type * as planning from "../planning.js";
import type * as preferences from "../preferences.js";
import type * as projectPresence from "../projectPresence.js";
import type * as projects from "../projects.js";
import type * as standup from "../standup.js";
import type * as standupTables from "../standupTables.js";
import type * as storage from "../storage.js";
import type * as studio from "../studio.js";
import type * as studioTables from "../studioTables.js";
import type * as taskPRs from "../taskPRs.js";
import type * as tasks from "../tasks.js";
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
  agentRuns: typeof agentRuns;
  agentThreads: typeof agentThreads;
  agents: typeof agents;
  agentsTables: typeof agentsTables;
  modelHosts: typeof modelHosts;
  modelHostsTables: typeof modelHostsTables;
  auth: typeof auth;
  broadcast: typeof broadcast;
  broadcastTables: typeof broadcastTables;
  budgets: typeof budgets;
  callNotes: typeof callNotes;
  campaignTables: typeof campaignTables;
  campaigns: typeof campaigns;
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
  featureTables: typeof featureTables;
  feedback: typeof feedback;
  github: typeof github;
  http: typeof http;
  inbox: typeof inbox;
  integrations: typeof integrations;
  issueRelations: typeof issueRelations;
  legacyImport: typeof legacyImport;
  "lib/agentAccess": typeof lib_agentAccess;
  "lib/agentThreadRows": typeof lib_agentThreadRows;
  "lib/auth": typeof lib_auth;
  "lib/columns": typeof lib_columns;
  "lib/completions": typeof lib_completions;
  "lib/features": typeof lib_features;
  "lib/invitationMail": typeof lib_invitationMail;
  "lib/permissions": typeof lib_permissions;
  "lib/pipelineCore": typeof lib_pipelineCore;
  "lib/repository": typeof lib_repository;
  "lib/storage": typeof lib_storage;
  "lib/storageValidators": typeof lib_storageValidators;
  "lib/taskBranches": typeof lib_taskBranches;
  "lib/validators": typeof lib_validators;
  memberProfiles: typeof memberProfiles;
  members: typeof members;
  meta: typeof meta;
  notifications: typeof notifications;
  org: typeof org;
  pages: typeof pages;
  pagesHttp: typeof pagesHttp;
  pagesTables: typeof pagesTables;
  pipeline: typeof pipeline;
  pipelineCapture: typeof pipelineCapture;
  pipelineInbound: typeof pipelineInbound;
  pipelineSequences: typeof pipelineSequences;
  pipelineTables: typeof pipelineTables;
  planning: typeof planning;
  preferences: typeof preferences;
  projectPresence: typeof projectPresence;
  projects: typeof projects;
  standup: typeof standup;
  standupTables: typeof standupTables;
  storage: typeof storage;
  studio: typeof studio;
  studioTables: typeof studioTables;
  taskPRs: typeof taskPRs;
  tasks: typeof tasks;
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
