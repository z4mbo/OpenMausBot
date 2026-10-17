"use client";

import { useState } from "react";
import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import {
  CheckCircle2,
  Circle,
  Edit3,
  Flag,
  GitPullRequest,
  Link2,
  Loader2,
  Plus,
  Rocket,
  Trash2,
  X,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { FunctionReturnType } from "convex/server";
import { useWorkspace } from "./workspace-context";
import { Dialog } from "./dialog";
import { ContentSkeleton } from "./content-skeleton";
import { FeatureIssuePicker } from "./feature-issue-picker";

type Milestone = FunctionReturnType<
  typeof api.planning.milestones
>["page"][number];
type Release = FunctionReturnType<typeof api.planning.releases>["page"][number];
type OpenTask = (projectId: Id<"projects">, taskId: Id<"tasks">) => void;

export function RoadmapView({
  sessionToken,
  onOpenTask,
}: {
  sessionToken: string;
  onOpenTask: OpenTask;
}) {
  const workspace = useWorkspace();
  const scope = { sessionToken, teamId: workspace._id };
  const page = usePaginatedQuery(api.planning.milestones, scope, {
    initialNumItems: 10,
  });
  const rows = page.status === "LoadingFirstPage" ? undefined : page.results;
  const assign = useMutation(api.planning.assignMilestone);
  const remove = useMutation(api.planning.removeMilestone);
  const [filter, setFilter] = useState("active");
  const [editing, setEditing] = useState<Milestone | "new" | null>(null);
  const [linking, setLinking] = useState<Id<"milestones"> | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const editable = workspace.role !== "viewer";
  const attempt = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      setNotice("");
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Could not update milestone",
      );
    } finally {
      setBusy(false);
    }
  };
  const visible = rows?.filter(
    (row) =>
      filter === "all" ||
      (filter === "completed"
        ? row.status === "completed"
        : row.status !== "completed"),
  );
  return (
    <section className="feature-page" aria-label="Roadmap">
      <div className="feature-toolbar">
        <div className="segmented-control">
          {["active", "completed", "all"].map((value) => (
            <button
              key={value}
              className={filter === value ? "active" : ""}
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
            >
              {value === "all"
                ? "All milestones"
                : value === "active"
                  ? "Active"
                  : "Completed"}
            </button>
          ))}
        </div>
        <div className="feature-toolbar-spacer" />
        <button
          className="primary-button compact"
          disabled={!editable}
          onClick={() => setEditing("new")}
        >
          <Plus size={15} />
          Milestone
        </button>
      </div>
      {notice && (
        <p className="notice danger" role="alert">
          {notice}
        </p>
      )}
      <div className="roadmap-list">
        {visible === undefined ? (
          <ContentSkeleton rows={6} />
        ) : !visible.length ? (
          <div className="feature-empty">
            <Flag size={28} />
            <strong>No milestones yet</strong>
          </div>
        ) : (
          visible.map((row) => {
            const completed = row.issues.filter((issue) => issue.done).length;
            const percent = row.issues.length
              ? Math.round((completed / row.issues.length) * 100)
              : 0;
            return (
              <article className="milestone-row" key={row._id}>
                <div className="milestone-track">
                  <span className={`milestone-node ${row.status}`} />
                  <span />
                </div>
                <div className="milestone-main">
                  <header>
                    <div>
                      <strong>{row.title}</strong>
                      <time dateTime={row.targetDate}>
                        {new Date(
                          `${row.targetDate}T12:00:00`,
                        ).toLocaleDateString(undefined, {
                          month: "long",
                          day: "numeric",
                          year: "numeric",
                        })}
                      </time>
                    </div>
                    <span className="feature-status">{row.status}</span>
                    {editable && (
                      <>
                        <button
                          className="icon-button"
                          title="Edit milestone"
                          aria-label={`Edit ${row.title}`}
                          onClick={() => setEditing(row)}
                        >
                          <Edit3 size={15} />
                        </button>
                        <button
                          className="icon-button"
                          disabled={busy}
                          title="Delete milestone"
                          aria-label={`Delete ${row.title}`}
                          onClick={() => {
                            if (
                              window.confirm(
                                `Delete "${row.title}"? Linked issues will be kept.`,
                              )
                            )
                              void attempt(() =>
                                remove({ ...scope, milestoneId: row._id }),
                              );
                          }}
                        >
                          <Trash2 size={15} />
                        </button>
                      </>
                    )}
                  </header>
                  {row.description && <p>{row.description}</p>}
                  <div className="milestone-progress">
                    <progress
                      max={100}
                      value={percent}
                      aria-label={`${percent}% completed`}
                    />
                    <small>
                      {completed}/{row.issues.length}
                      {row.truncated ? "+" : ""} completed
                    </small>
                  </div>
                  <div className="milestone-issues">
                    {row.issues.map((issue) => (
                      <div key={issue._id}>
                        <button
                          onClick={() => onOpenTask(issue.projectId, issue._id)}
                        >
                          {issue.done ? (
                            <CheckCircle2 size={15} />
                          ) : (
                            <Circle size={15} />
                          )}
                          <span>{issue.title}</span>
                          <small>{issue.projectName}</small>
                        </button>
                        {editable && (
                          <button
                            className="icon-button"
                            disabled={busy}
                            title="Unlink issue"
                            aria-label={`Unlink ${issue.title}`}
                            onClick={() =>
                              attempt(() =>
                                assign({
                                  ...scope,
                                  taskId: issue._id,
                                  milestoneId: null,
                                }),
                              )
                            }
                          >
                            <X size={13} />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                  {editable && (
                    <button
                      className="ghost-button compact"
                      onClick={() => setLinking(row._id)}
                    >
                      <Link2 size={14} />
                      Link issues
                    </button>
                  )}
                </div>
              </article>
            );
          })
        )}
      </div>
      {page.status !== "Exhausted" && page.status !== "LoadingFirstPage" && (
        <button
          className="ghost-button compact"
          disabled={page.status === "LoadingMore"}
          onClick={() => page.loadMore(10)}
        >
          More milestones
        </button>
      )}
      {editing && (
        <MilestoneForm
          sessionToken={sessionToken}
          row={editing === "new" ? undefined : editing}
          onClose={() => setEditing(null)}
        />
      )}
      {linking && (
        <Dialog title="Link issues" onClose={() => setLinking(null)}>
          <div className="feature-form">
            <FeatureIssuePicker
              sessionToken={sessionToken}
              selected={
                rows
                  ?.find((row) => row._id === linking)
                  ?.issues.map((issue) => issue._id) || []
              }
              onSelect={(taskId) => {
                if (!busy)
                  void attempt(() =>
                    assign({
                      ...scope,
                      taskId,
                      milestoneId: rows
                        ?.find((row) => row._id === linking)
                        ?.issues.some((issue) => issue._id === taskId)
                        ? null
                        : linking,
                    }),
                  );
              }}
            />
            {notice && <p className="notice danger">{notice}</p>}
          </div>
        </Dialog>
      )}
    </section>
  );
}

function MilestoneForm({
  sessionToken,
  row,
  onClose,
}: {
  sessionToken: string;
  row?: Milestone;
  onClose: () => void;
}) {
  const workspace = useWorkspace();
  const [title, setTitle] = useState(row?.title || "");
  const [description, setDescription] = useState(row?.description || "");
  const [targetDate, setTargetDate] = useState(row?.targetDate || "");
  const [status, setStatus] = useState<Milestone["status"]>(
    row?.status || "planned",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const save = useMutation(api.planning.saveMilestone);
  return (
    <Dialog title={row ? "Edit milestone" : "New milestone"} onClose={onClose}>
      <form
        className="feature-form"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await save({
              sessionToken,
              teamId: workspace._id,
              milestoneId: row?._id,
              title,
              description,
              targetDate,
              status,
            });
            onClose();
          } catch (error) {
            setError(error instanceof Error ? error.message : "Could not save");
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Milestone
          <input
            autoFocus
            required
            maxLength={120}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label>
          Description
          <textarea
            rows={4}
            maxLength={12000}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        <div className="feature-form-pair">
          <label>
            Target date
            <input
              required
              type="date"
              value={targetDate}
              onChange={(e) => setTargetDate(e.target.value)}
            />
          </label>
          <label>
            Status
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as typeof status)}
            >
              <option value="planned">Planned</option>
              <option value="active">Active</option>
              <option value="completed">Completed</option>
            </select>
          </label>
        </div>
        {error && (
          <p className="notice danger" role="alert">
            {error}
          </p>
        )}
        <button className="primary-button compact" disabled={busy}>
          {busy ? (
            <Loader2 size={15} className="spin" />
          ) : (
            <CheckCircle2 size={15} />
          )}
          Save milestone
        </button>
      </form>
    </Dialog>
  );
}

export function ReleasesView({
  sessionToken,
  onOpenTask,
}: {
  sessionToken: string;
  onOpenTask: OpenTask;
}) {
  const workspace = useWorkspace();
  const scope = { sessionToken, teamId: workspace._id };
  const page = usePaginatedQuery(api.planning.releases, scope, {
    initialNumItems: 10,
  });
  const rows = page.status === "LoadingFirstPage" ? undefined : page.results;
  const projects = useQuery(api.projects.listForUser, scope);
  const remove = useMutation(api.planning.removeRelease);
  const [editing, setEditing] = useState<Release | "new" | null>(null);
  const [project, setProject] = useState("");
  const [notice, setNotice] = useState("");
  const editable = workspace.role !== "viewer";
  const visible = rows?.filter((row) => !project || row.projectId === project);
  return (
    <section className="feature-page" aria-label="Releases">
      <div className="feature-toolbar">
        <select
          aria-label="Release project"
          value={project}
          onChange={(e) => setProject(e.target.value)}
        >
          <option value="">All projects</option>
          {projects?.map((p) => (
            <option value={p._id} key={p._id}>
              {p.name}
            </option>
          ))}
        </select>
        <div className="feature-toolbar-spacer" />
        <button
          className="primary-button compact"
          disabled={!editable || !projects?.length}
          onClick={() => setEditing("new")}
        >
          <Plus size={15} />
          Release
        </button>
      </div>
      {notice && (
        <p className="notice danger" role="alert">
          {notice}
        </p>
      )}
      <div className="release-list">
        {visible === undefined ? (
          <ContentSkeleton rows={6} />
        ) : !visible.length ? (
          <div className="feature-empty">
            <Rocket size={28} />
            <strong>No releases yet</strong>
          </div>
        ) : (
          visible.map((row) => (
            <article className="release-entry" key={row._id}>
              <header>
                <Rocket size={18} />
                <div>
                  <strong>{row.version}</strong>
                  <small>
                    {row.projectName} ·{" "}
                    {row.publishedAt
                      ? new Date(row.publishedAt).toLocaleDateString()
                      : "Draft"}
                  </small>
                </div>
                <div className="feature-toolbar-spacer" />
                {editable && (
                  <>
                    <button
                      className="icon-button"
                      title="Edit release"
                      aria-label={`Edit ${row.version}`}
                      onClick={() => setEditing(row)}
                    >
                      <Edit3 size={15} />
                    </button>
                    <button
                      className="icon-button"
                      title="Delete release"
                      aria-label={`Delete ${row.version}`}
                      onClick={async () => {
                        if (
                          !window.confirm(
                            `Delete release "${row.version}"? Issues will be kept.`,
                          )
                        )
                          return;
                        try {
                          await remove({ ...scope, releaseId: row._id });
                        } catch (error) {
                          setNotice(
                            error instanceof Error
                              ? error.message
                              : "Could not delete",
                          );
                        }
                      }}
                    >
                      <Trash2 size={15} />
                    </button>
                  </>
                )}
              </header>
              <div className="release-body">{row.body}</div>
              <div className="milestone-issues">
                {row.issues.map((issue) => (
                  <div key={issue._id}>
                    <button
                      onClick={() => onOpenTask(issue.projectId, issue._id)}
                    >
                      <CheckCircle2 size={15} />
                      <span>{issue.title}</span>
                    </button>
                    {issue.githubIssueUrl && (
                      <a
                        className="icon-button"
                        href={issue.githubIssueUrl}
                        target="_blank"
                        rel="noreferrer"
                        title="View GitHub issue"
                        aria-label="View GitHub issue"
                      >
                        <GitPullRequest size={14} />
                      </a>
                    )}
                  </div>
                ))}
              </div>
            </article>
          ))
        )}
      </div>
      {editing && (
        <ReleaseForm
          sessionToken={sessionToken}
          row={editing === "new" ? undefined : editing}
          projects={projects || []}
          defaultProject={project}
          onClose={() => setEditing(null)}
        />
      )}
      {page.status !== "Exhausted" && page.status !== "LoadingFirstPage" && <button className="ghost-button compact" disabled={page.status === "LoadingMore"} onClick={() => page.loadMore(10)}>More releases</button>}
    </section>
  );
}

function ReleaseForm({
  sessionToken,
  row,
  projects,
  defaultProject,
  onClose,
}: {
  sessionToken: string;
  row?: Release;
  projects: { _id: Id<"projects">; name: string }[];
  defaultProject: string;
  onClose: () => void;
}) {
  const workspace = useWorkspace();
  const save = useMutation(api.planning.saveRelease);
  const [project, setProject] = useState(
    row?.projectId || defaultProject || projects[0]?._id || "",
  );
  const [version, setVersion] = useState(row?.version || "");
  const [body, setBody] = useState(row?.body || "");
  const [taskIds, setTasks] = useState<Id<"tasks">[]>(
    row?.issues.map((issue) => issue._id) || [],
  );
  const [publish, setPublish] = useState(Boolean(row?.publishedAt));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [titles, setTitles] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      row?.issues.map((issue) => [issue._id, issue.title]) || [],
    ),
  );
  return (
    <Dialog title={row ? "Edit release" : "New release"} onClose={onClose}>
      <form
        className="feature-form"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await save({
              sessionToken,
              teamId: workspace._id,
              releaseId: row?._id,
              projectId: project as Id<"projects">,
              version,
              body,
              taskIds,
              publish,
            });
            onClose();
          } catch (error) {
            setError(error instanceof Error ? error.message : "Could not save");
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="feature-form-pair">
          <label>
            Project
            <select
              disabled={!!row}
              value={project}
              onChange={(e) => {
                setProject(e.target.value);
                setTasks([]);
                setTitles({});
              }}
            >
              {projects.map((p) => (
                <option value={p._id} key={p._id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Version
            <input
              autoFocus
              required
              maxLength={80}
              placeholder="v1.0.0"
              value={version}
              onChange={(e) => setVersion(e.target.value)}
            />
          </label>
        </div>
        <label>
          Changelog
          <textarea
            rows={5}
            value={body}
            maxLength={60000}
            onChange={(e) => setBody(e.target.value)}
          />
        </label>
        <button
          type="button"
          className="ghost-button compact"
          disabled={!taskIds.length}
          onClick={() =>
            setBody(taskIds.map((id) => `- ${titles[id]}`).join("\n"))
          }
        >
          Generate from selected issues
        </button>
        <FeatureIssuePicker
          key={project}
          sessionToken={sessionToken}
          projectId={project as Id<"projects">}
          done
          selected={taskIds}
          onSelect={(id, title) => {
            setTitles((current) => ({ ...current, [id]: title }));
            setTasks((current) =>
              current.includes(id)
                ? current.filter((task) => task !== id)
                : [...current, id],
            );
          }}
        />
        <label className="feature-checkbox">
          <input
            type="checkbox"
            checked={publish}
            onChange={(e) => setPublish(e.target.checked)}
          />
          Publish to workspace changelog
        </label>
        {error && (
          <p className="notice danger" role="alert">
            {error}
          </p>
        )}
        <button className="primary-button compact" disabled={busy || !project}>
          {busy ? <Loader2 className="spin" size={15} /> : <Rocket size={15} />}
          Save release
        </button>
      </form>
    </Dialog>
  );
}
