import { ComposerSendButton } from "./ComposerSendButton";
import { track } from "@/lib/analytics";
import { useCallback, useEffect, useMemo, useRef, useState, type SetStateAction } from "react";
import { Mic, Paperclip, Target, X } from "lucide-react";
import { useStore, visibleMessages, currentTaskBot, type Bot, type Group, type Message } from "@/state/store";
import { cn } from "@/lib/cn";
import { COMPOSER_TOOL } from "@/lib/composer-tool";
import { useMenuMotion } from "./MenuMotion";
import { activeLocale, t } from "@/lib/i18n";
import { useOwnerOrAdmin } from "@/lib/use-owner-or-admin";
import { useAdvancedMode } from "@/lib/interface-mode";
import { imeComposing, sendKeyLabel, sendsMessage, useSendKey } from "@/lib/send-key";
import {
  draftRevision,
  appendDraftAttachments,
  changeDraftAttachmentPending,
  forgetFailedComposerSend,
  markDraftEdited,
  prependComposerDraft,
  recoverFailedComposerSend,
  rememberFailedComposerSend,
  replaceDraftAttachment,
  restoredSendId,
  restoredRequestText,
  useComposerDraft,
  useComposerChannelMode,
  useDraftAttachmentPending,
  useFailedComposerSends,
  type ComposerSendSnapshot,
  type FailedComposerSend,
} from "@/lib/drafts";
import { ComposerCommandList, ComposerMentionList, type MentionChoice, type MentionTeammate } from "./ComposerSuggestions";
import { ModelPicker } from "./ModelPicker";
import { ChatUsagePopover } from "./ChatUsagePopover";
import { AgentBudgetPill } from "./AgentBudgetPill";
import { MentionTextarea } from "./MentionTextarea";
import { ComposerAttachments, pathForFile } from "./ComposerAttachments";
import { splitTranscriptCitations, type CitationAttachment } from "@/lib/citations";
import { LocalComputerAutoWarning } from "./LocalComputerAutoWarning";
import { PlaceChip } from "./PlaceChip";
import { ApprovalModeSelector } from "./ApprovalModeSelector";
import { CommandAllowlistDialog } from "./CommandAllowlistDialog";
import { approvalModeFor, type ApprovalMode } from "../../shared/approval-mode";
import {
  appendPastedText,
  handoffAttachmentImagePreview,
  clipboardHasImages,
  clipboardImageFiles,
  composeMessage,
  dataContextFor,
  composerShouldRefocus,
  composerTakesFocusOnOpen,
  imageAttachmentFromFile,
  replyTargetTakesFocus,
  intakeFiles,
  isLongPaste,
  optimisticImageAttachment,
  pasteAttachment,
  releaseAttachmentImagePreview,
  type Attachment,
  type PasteAttachment,
} from "@/lib/composer-attachments";
import { goalCoordinatorForComposer, groupComposerHint, jevRoomRoutingOn, openTaskWorking, roomRespondersForComposer } from "@/lib/group-routing";
import { PendingApprovalActions, PendingApprovalPanel, pendingApprovals } from "./PendingApproval";
import { CallButton } from "./CallView";
import { useDesktopCapabilities } from "./DesktopCapabilities";
import { ComposerReplyStrip } from "./ReplyQuote";
import { escapeCancelsReply } from "@/lib/replies";
import { useThreadRefs } from "./ThreadRefs";
import {
  QueuedComposerMessages,
  composerCanSteerQueuedMessages,
  doubleEnterSteerWindowExpiresAt,
  doubleEnterSteersQueue,
} from "./ComposerQueuedMessages";
import { skillAuthoringEnabled } from "@/lib/feature-flags";
import { mentionChoicesForQuery, mentionedPeople, mentionQueryAt, type MentionPeer } from "@/lib/mentions";
import { serializeThreadRefs, threadTokenFromPaste, threadTokenSpacing } from "@/lib/thread-refs";
import {
  composerSlashTrigger,
  goalTextFromComposer,
  replaceComposerSlashTrigger,
  skillSlashCommands,
  slashCommandMatches,
  type ComposerSlashCommand,
} from "@/lib/composer-commands";
import { useSlashSkills } from "@/lib/use-slash-skills";

export type { MentionTeammate };

interface ComposerDraftSnapshot extends ComposerSendSnapshot {
  reply: Message | null;
}

export function Composer({
  bot: profile,
  group,
  members,
  people,
  onEditLast,
  replyTo,
  onClearReply,
  onConsumeReply,
  onRestoreReply,
  locked: setupLocked = false,
}: {
  bot?: Bot;
  group?: Group;
  members?: Bot[];
  people?: readonly MentionTeammate[];
  onEditLast?: () => void;
  replyTo?: Message | null;
  onClearReply?: () => void;
  onConsumeReply?: () => void;
  onRestoreReply?: (message: Message, threadId: string) => void;
  locked?: boolean;
}) {
  const bot = profile ? currentTaskBot(profile) : undefined;
  const locked = setupLocked || Boolean(bot?.awaitingThreadSnapshot);
  const { state, dispatch } = useStore();
  const ownerOrAdmin = useOwnerOrAdmin();
  const { threads, currentBotId } = useThreadRefs();
  const { capabilities } = useDesktopCapabilities();
  const advanced = useAdvancedMode();
  const sendKey = useSendKey();
  const sendLabel = sendKeyLabel(sendKey);
  const remoteClient = window.ogb?.remoteClient?.active === true;
  const threadId = group?.threadId ?? bot?.threadId ?? "";
  const currentGroupTask = group?.tasks?.find((task) => task.threadId === threadId);
  const groupBusyBotId = currentGroupTask?.busyBotId ?? (currentGroupTask?.working ? group?.busyBotId : (group?.threadId === threadId ? group?.busyBotId : null));
  const groupWorking = group ? openTaskWorking(group) : false;
  const busy = group ? Boolean(groupWorking || groupBusyBotId) : Boolean(bot?.busy);
  const steerInstanceId = group
    ? members?.find((member) => member.id === groupBusyBotId)?.modelSelection.instanceId
    : bot?.modelSelection.instanceId;
  const canSteer =
    state.instances.find((i) => i.instanceId === steerInstanceId)?.capabilities?.queueing === true;
  const composerTask = profile?.tasks?.find((task) => task.threadId === threadId);
  // Visible branch only: an approval left on an abandoned branch must not block the composer.
  const transcript = group ? group.messages : bot ? visibleMessages(bot) : [];
  const approvals = pendingApprovals(transcript);
  const approval = approvals[0];
  const approvalBot = group
    ? members?.find((member) => member.id === approval?.message.from?.botId) ??
      members?.find((member) => member.id === groupBusyBotId)
    : bot;
  const busyName = group
    ? (members?.find((b) => b.id === groupBusyBotId)?.name ??
      (groupWorking ? t("composer.busy.team") : t("composer.busy.aBot")))
    : (bot?.name ?? t("composer.busy.theBot"));
  const draftId = group
    ? `group:${group.id}:${group.threadId}`
    : `bot:${bot?.id ?? ""}:${bot?.threadId ?? ""}`;
  const [text, setText, attachments, setAttachments] = useComposerDraft(
    draftId,
    !group && bot ? `bot:${bot.id}` : undefined,
  );
  const attachmentPending = useDraftAttachmentPending(draftId);
  const failedSends = useFailedComposerSends(draftId);
  const [channelMode, setChannelMode] = useComposerChannelMode(draftId);
  const editText = useCallback(
    (next: string) => {
      markDraftEdited(draftId);
      setText(next);
    },
    [draftId, setText],
  );
  const editAttachments = useCallback(
    (next: SetStateAction<Attachment[]>) => {
      markDraftEdited(draftId);
      setAttachments(next);
    },
    [draftId, setAttachments],
  );
  const restoreDraft = useCallback(
    (sent: ComposerDraftSnapshot) => {
      if (recoverFailedComposerSend(sent) === "restored") {
        if (sent.reply) onRestoreReply?.(sent.reply, sent.threadId);
      }
    },
    [onRestoreReply],
  );
  const addAttachments = useCallback(
    (next: Attachment[]) => appendDraftAttachments(draftId, next),
    [draftId],
  );
  const removeAttachment = useCallback(
    (id: string) => {
      const removed = attachments.find((attachment) => attachment.id === id);
      if (removed?.kind === "image") releaseAttachmentImagePreview(removed);
      editAttachments((prev) => prev.filter((attachment) => attachment.id !== id));
    },
    [attachments, editAttachments],
  );
  const displayPasteInChatBox = useCallback(
    function displayPasteInChatBox(attachment: PasteAttachment) {
      const nextText = appendPastedText(text, attachment.text);
      editText(nextText);
      editAttachments((prev) => prev.filter((a) => a.id !== attachment.id));
      setCaret(nextText.length);
      setDismissedAt(null);
      requestAnimationFrame(() => {
        const input = inputRef.current;
        if (!input) return;
        input.focus();
        input.setSelectionRange(nextText.length, nextText.length);
      });
    },
    [text, editText, editAttachments],
  );
  const [recording, setRecording] = useState(false);
  const [speechError, setSpeechError] = useState<string | null>(null);
  const [caret, setCaret] = useState(0);
  const [highlight, setHighlight] = useState(0);
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const [dismissedSlashAt, setDismissedSlashAt] = useState<number | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const draftIdRef = useRef(draftId);
  draftIdRef.current = draftId;
  const caretRef = useRef(0);
  caretRef.current = caret;
  const refocusInput = useCallback(() => {
    requestAnimationFrame(() => {
      const input = inputRef.current;
      if (!input || input.disabled || !composerShouldRefocus(document.activeElement, input)) return;
      const at = Math.min(caretRef.current, input.value.length);
      input.focus();
      input.setSelectionRange(at, at);
    });
  }, []);
  // Touch screens are skipped: focusing there pops the on-screen keyboard over the conversation.
  useEffect(() => {
    if (window.matchMedia?.("(hover: none) and (pointer: coarse)").matches) return;
    const frame = requestAnimationFrame(() => {
      const input = inputRef.current;
      if (!input || input.disabled || !composerTakesFocusOnOpen(document.activeElement, input)) return;
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    });
    return () => cancelAnimationFrame(frame);
  }, []);
  const replyToId = replyTo?.id ?? null;
  const focusedReplyRef = useRef(replyToId);
  useEffect(() => {
    const previous = focusedReplyRef.current;
    focusedReplyRef.current = replyToId;
    if (!replyTargetTakesFocus(previous, replyToId)) return;
    if (window.matchMedia?.("(hover: none) and (pointer: coarse)").matches) return;
    const frame = requestAnimationFrame(() => {
      const input = inputRef.current;
      if (!input || input.disabled || !composerTakesFocusOnOpen(document.activeElement, input)) return;
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    });
    return () => cancelAnimationFrame(frame);
  }, [replyToId]);
  const mentionListRef = useRef<HTMLDivElement>(null);
  const commandListRef = useRef<HTMLDivElement>(null);
  const baseText = useRef("");

  const botSupportsImages = (candidate?: Bot) =>
    Boolean(
      candidate &&
        state.instances.find((i) => i.instanceId === candidate.modelSelection.instanceId)?.capabilities?.images,
    );
  const imageTargetsSupport = (message: string, mode: "chat" | "goal") => {
    if (!group) return botSupportsImages(bot);
    if (mode === "goal") {
      return botSupportsImages(goalCoordinatorForComposer(message, members ?? [], group) ?? undefined);
    }
    const responders = roomRespondersForComposer(message, members ?? [], group);
    return responders.length > 0 && responders.every(botSupportsImages);
  };
  const typedGoalText = group && !group.dm ? goalTextFromComposer(text) : null;
  const effectiveText = typedGoalText ?? text;
  const effectiveChannelMode = typedGoalText !== null ? "goal" : channelMode;
  const engineSupportsImages = imageTargetsSupport(effectiveText, effectiveChannelMode);
  const botTakesCommands = Boolean(!group && bot && state.instances.find((instance) => instance.instanceId === bot.modelSelection.instanceId)?.capabilities?.agentsMcp);

  const slash = composerSlashTrigger(text, caret);
  const locale = activeLocale();
  const slashSkills = useSlashSkills(group ? undefined : bot?.id, Boolean(slash) && slash?.start !== dismissedSlashAt);
  const commandCandidates = useMemo(() => {
    if (!slash || slash.start === dismissedSlashAt) return [];
    const supportsAgents = (candidate?: Bot) =>
      Boolean(
        candidate &&
          state.instances.find(
            (instance) => instance.instanceId === candidate.modelSelection.instanceId,
          )?.capabilities?.agentsMcp,
      );
    const available: ComposerSlashCommand[] = [];
    if (group && !group.dm) available.push({
      kind: "command",
      id: "goal",
      label: "/goal",
      description: t("composer.command.goalDesc"),
    });
    if (
      skillAuthoringEnabled(state.config) &&
      (group ? (members ?? []).some(supportsAgents) : supportsAgents(bot))
    ) {
      available.push({
        kind: "command",
        id: "learn",
        label: "/learn",
        description: t("composer.command.learnDesc"),
      });
    }
    if (!group && supportsAgents(bot)) available.push({
      kind: "command",
      id: "setup",
      label: "/setup",
      description: t("composer.command.setupDesc"),
    });
    available.push(...skillSlashCommands(slashSkills));
    return available.filter((command) => slashCommandMatches(command, slash.query));
  }, [slash, dismissedSlashAt, group, members, bot, state.config, state.instances, locale, slashSkills]);
  const commandPickerOpen = commandCandidates.length > 0;

  const mention = mentionQueryAt(text, caret);
  const candidates = useMemo(() => {
    if (!mention || mention.start === dismissedAt) return [];
    const pool: MentionChoice[] = group
      ? [
          ...(!group.dm ? [{ id: "__everyone__", name: "everyone" }] : []),
          ...(members ?? []).map((member) => ({ id: member.id, name: member.name, bot: member })),
          ...(people ?? []).map((teammate) => ({ id: `person:${teammate.id}`, name: teammate.name, teammate })),
        ]
      : [
          ...(people ?? []).map((teammate) => ({ id: `person:${teammate.id}`, name: teammate.name, teammate })),
          ...state.bots
            .filter((member) => member.id !== bot?.id && !member.hidden)
            .map((member) => ({ id: member.id, name: member.name, bot: member })),
        ];
    return mentionChoicesForQuery(pool, mention.query);
  }, [mention, dismissedAt, state.bots, bot?.id, group, members, people]);
  const mentionPeers = useMemo<MentionPeer[]>(
    () => [...(group ? members ?? [] : state.bots.filter((member) => member.id !== bot?.id)), ...(people ?? [])],
    [group, members, state.bots, bot?.id, people],
  );
  const mentionEveryoneCount = (members ?? []).filter((member) => !member.hidden).length;
  const mentionPickerOpen = candidates.length > 0;
  const commandMotion = useMenuMotion(commandPickerOpen);
  const mentionMotion = useMenuMotion(mentionPickerOpen);

  useEffect(
    () => setHighlight(0),
    [mention?.start, mention?.query, slash?.start, slash?.query],
  );

  useEffect(() => {
    if (!commandPickerOpen) return;
    setHighlight((current) => Math.min(current, commandCandidates.length - 1));
  }, [commandCandidates.length, commandPickerOpen]);

  useEffect(() => {
    if (!commandPickerOpen) return;
    commandListRef.current
      ?.querySelector<HTMLElement>(`[data-command-index="${highlight}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [highlight, commandPickerOpen]);

  useEffect(() => {
    if (!mentionPickerOpen) return;
    mentionListRef.current
      ?.querySelector<HTMLElement>(`[data-mention-index="${highlight}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [highlight, mentionPickerOpen]);

  const pickMention = (peer: MentionChoice) => {
    if (!mention) return;
    const after = text.slice(caret);
    const next = `${text.slice(0, mention.start)}@${peer.name} ${after}`;
    editText(next);
    const newCaret = mention.start + peer.name.length + 2;
    setCaret(newCaret);
    setDismissedAt(mention.start);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(newCaret, newCaret);
    });
  };

  const pickCommand = (command: ComposerSlashCommand | undefined) => {
    if (!slash || !command) return;
    const replacement = command.kind === "skill" ? `${command.label} `
      : command.id === "learn" ? "/learn " : command.id === "setup" ? "/setup " : "";
    const next = replaceComposerSlashTrigger(text, slash, replacement);
    editText(next.text);
    setCaret(next.caret);
    setDismissedSlashAt(slash.start);
    setChannelMode(command.kind === "command" && command.id === "goal" ? "goal" : "chat");
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(next.caret, next.caret);
    });
  };

  const pendingCount = (state.pendingQueued[threadId] ?? []).length;
  const queuedMessages = state.pendingQueued[threadId] ?? [];
  const canSteerQueued = composerCanSteerQueuedMessages(
    busy,
    locked,
    pendingCount,
    Boolean(approval),
  );
  const [steering, setSteering] = useState(false);
  const interruptTurn = () => {
    if (group) dispatch({ type: "interruptGroup", groupId: group.id, threadId });
    else if (bot) dispatch({ type: "interrupt", botId: bot.id, threadId });
  };
  const queueHeadId = queuedMessages[0]?.queueId;
  const steerQueued = () => {
    if (!queueHeadId) return;
    setSteering(true);
    const settle = () => setSteering(false);
    if (group && canSteer) {
      dispatch({ type: "steerGroupQueued", groupId: group.id, threadId, queueId: queueHeadId, onError: settle, onSettled: settle });
    } else if (group) {
      dispatch({ type: "interruptGroup", groupId: group.id, threadId, onError: settle });
    } else if (bot && canSteer) {
      dispatch({ type: "steerQueued", botId: bot.id, threadId, queueId: queueHeadId, onError: settle, onSettled: settle });
    } else if (bot) {
      dispatch({ type: "interrupt", botId: bot.id, threadId, onError: settle });
    }
  };
  useEffect(() => setSteering(false), [threadId, queueHeadId]);
  // Only a confirmed removal hands the words back, so a message that already drained into a turn is never resent.
  const editQueued = (queueId: string) => {
    const queued = queuedMessages.find((item) => item.queueId === queueId);
    if (!queued) return;
    const targetDraftId = draftId;
    const onCancelled = () => {
      const cited = splitTranscriptCitations(queued.text);
      if (cited.display) prependComposerDraft(targetDraftId, cited.display);
      appendDraftAttachments(targetDraftId, cited.citations);
      if (targetDraftId !== draftIdRef.current) return;
      requestAnimationFrame(() => {
        const input = inputRef.current;
        if (!input) return;
        input.focus();
        input.setSelectionRange(cited.display.length, cited.display.length);
      });
    };
    if (group) dispatch({ type: "cancelGroupQueued", groupId: group.id, threadId, queueId, onCancelled });
    else if (bot) dispatch({ type: "cancelQueued", botId: bot.id, threadId, queueId, onCancelled });
  };
  const steerAgainUntilRef = useRef(0);
  const prevPendingCountRef = useRef(pendingCount);
  useEffect(() => {
    const expiresAt = doubleEnterSteerWindowExpiresAt(
      prevPendingCountRef.current,
      pendingCount,
      busy,
      canSteer,
    );
    if (expiresAt !== null) steerAgainUntilRef.current = expiresAt;
    prevPendingCountRef.current = pendingCount;
  }, [pendingCount, busy, canSteer]);
  useEffect(() => {
    if (!busy || pendingCount === 0) {
      setSteering(false);
      return;
    }
    if (!steering) return;
    const timeout = window.setTimeout(() => setSteering(false), 20_000);
    return () => window.clearTimeout(timeout);
  }, [busy, pendingCount, steering]);
  const fileInput = useRef<HTMLInputElement>(null);
  const [approvalWarning, setApprovalWarning] = useState<{
    mode: "auto";
    botId: string;
    threadId: string;
  } | null>(null);
  const [attachmentNotice, setAttachmentNotice] = useState<string | null>(null);
  const [commandAllowlistTarget, setCommandAllowlistTarget] = useState<{ botId: string; botName: string; threadId: string } | null>(null);
  const modeBot = group ? undefined : bot;
  const approvalEngine = modeBot
    ? state.instances.find((instance) => instance.instanceId === modeBot.modelSelection.instanceId)
    : undefined;
  const trustedThreadAccess = Boolean(!remoteClient && window.ogb?.approvals && capabilities.host.packaged);
  const uploadImage = useCallback(async (file: File): Promise<Attachment | null> => {
    const optimistic = optimisticImageAttachment(file);
    if (!optimistic) return null;
    appendDraftAttachments(draftId, [optimistic]);
    try {
      const completed = await imageAttachmentFromFile(file, optimistic);
      if (!completed) {
        replaceDraftAttachment(draftId, optimistic.id, null);
        releaseAttachmentImagePreview(optimistic);
        return null;
      }
      handoffAttachmentImagePreview(completed.path, completed.previewUrl);
      if (!replaceDraftAttachment(draftId, optimistic.id, completed)) {
        releaseAttachmentImagePreview(completed);
      }
      return null;
    } catch (error) {
      replaceDraftAttachment(draftId, optimistic.id, null);
      releaseAttachmentImagePreview(optimistic);
      throw error;
    }
  }, [draftId]);
  const pickFiles = async (picked: FileList | null) => {
    if (!picked?.length) return;
    changeDraftAttachmentPending(draftId, true);
    try {
      const { attachments: added, notice } = await intakeFiles(Array.from(picked), {
        allowImages: engineSupportsImages,
        getPath: pathForFile,
        uploadImage,
      });
      if (added.length) addAttachments(added);
      if (notice) setAttachmentNotice(notice);
    } finally {
      changeDraftAttachmentPending(draftId, false);
    }
    refocusInput();
  };
  const setApprovalMode = (mode: ApprovalMode) => {
    if (!modeBot || modeBot.busy || mode === approvalModeFor(modeBot)) return;
    if (mode === "custom" && !trustedThreadAccess) return;
    if (mode === "auto" && modeBot.computer === "local") {
      setApprovalWarning({ mode: "auto", botId: modeBot.id, threadId: modeBot.threadId });
      return;
    }
    dispatch({ type: "updateTask", botId: modeBot.id, threadId: modeBot.threadId, patch: { approvalMode: mode } });
  };

  const hasContent = Boolean(effectiveText.trim()) || attachments.length > 0;
  const retryFailedSend = (failed: FailedComposerSend) => {
    const failedMode = failed.channelMode ?? "chat";
    if (failed.requestText.includes("<attached-image ") && !imageTargetsSupport(failed.requestText, failedMode)) {
      dispatch({ type: "error", message: t("composer.error.noImages") });
      return;
    }
    forgetFailedComposerSend(draftId, failed.id);
    const retry = {
      sendId: failed.sendId,
      text: failed.requestText,
      replyToId: failed.replyToId,
      threadId: failed.threadId,
      onError: () => {
        rememberFailedComposerSend(draftId, {
          sendId: failed.sendId,
          text: failed.text,
          requestText: failed.requestText,
          replyToId: failed.replyToId,
          threadId: failed.threadId,
          channelMode: failed.channelMode,
        });
      },
    };
    if (group) {
      dispatch({ type: "sendGroup", groupId: group.id, mode: failedMode, ...retry });
    } else if (bot) {
      dispatch({ type: "send", botId: bot.id, ...retry });
    }
  };
  const send = () => {
    if (locked || attachmentPending) return;
    if (
      attachments.some((attachment) => attachment.kind === "image") &&
      !imageTargetsSupport(effectiveText, effectiveChannelMode)
    ) {
      dispatch({ type: "error", message: t("composer.error.noImages") });
      return;
    }
    const composed = composeMessage(serializeThreadRefs(effectiveText, threads, currentBotId), attachments);
    if (!composed) return;
    const body = restoredRequestText(draftId) ?? composed;
    const dataContext = dataContextFor(body, state.computerOpen ? state.dataView : null, !group && bot ? { botId: bot.id, threadId } : undefined);
    const sentDraft: ComposerDraftSnapshot = {
      draftId,
      revision: draftRevision(draftId),
      sendId: restoredSendId(draftId) ?? crypto.randomUUID(),
      text,
      requestText: body,
      attachments: [...attachments],
      reply: replyTo ?? null,
      replyToId: replyTo?.id,
      threadId,
      channelMode: group ? effectiveChannelMode : undefined,
    };
    if (group) {
      dispatch({
        type: "sendGroup",
        groupId: group.id,
        text: body,
        sendId: sentDraft.sendId,
        replyToId: replyTo?.id,
        threadId,
        mode: effectiveChannelMode,
        onError: () => restoreDraft(sentDraft),
      });
      track("message_sent", { room: true, mode: effectiveChannelMode, queued: busy });
    } else if (bot) {
      dispatch({
        type: "send",
        botId: bot.id,
        text: body,
        sendId: sentDraft.sendId,
        replyToId: replyTo?.id,
        threadId,
        dataContext,
        ...(people?.length ? { mentionUserIds: mentionedPeople(body, people).map((teammate) => teammate.id) } : {}),
        onError: () => restoreDraft(sentDraft),
      });
      track("message_sent", { driver: bot.modelSelection?.instanceId, queued: busy && !canSteer });
    }
    setText("");
    setAttachments([]);
    onConsumeReply?.();
    if (group) setChannelMode("chat");
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const imageFiles = clipboardImageFiles(e.clipboardData);
    if (imageFiles.length > 0 || clipboardHasImages(e.clipboardData)) {
      e.preventDefault();
      if (!engineSupportsImages) {
        dispatch({
          type: "error",
          message: t("composer.error.noImages"),
        });
        return;
      }
      if (!imageFiles.length) {
        dispatch({ type: "error", message: t("composer.error.clipboardImage") });
        return;
      }
      if (imageFiles.length > 0) {
        changeDraftAttachmentPending(draftId, true);
        void (async () => {
          try {
            const results = await Promise.allSettled(imageFiles.map(uploadImage));
            for (const result of results) {
              if (result.status === "rejected") {
                dispatch({
                  type: "error",
                  message: result.reason instanceof Error ? result.reason.message : "image upload failed",
                });
              }
            }
          } finally {
            changeDraftAttachmentPending(draftId, false);
          }
        })();
        return;
      }
    }
    const pasted = e.clipboardData.getData("text/plain");
    const reference = threadTokenFromPaste(pasted, threads, currentBotId);
    if (reference) {
      e.preventDefault();
      const start = e.currentTarget.selectionStart ?? text.length;
      const end = e.currentTarget.selectionEnd ?? start;
      const { lead, trail } = threadTokenSpacing(text, start, end);
      const token = lead + reference.token + trail;
      editText(text.slice(0, start) + token + text.slice(end));
      const at = start + token.length;
      setCaret(at);
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.setSelectionRange(at, at);
      });
      return;
    }
    if (!isLongPaste(pasted)) return;
    e.preventDefault();
    const start = e.currentTarget.selectionStart;
    const end = e.currentTarget.selectionEnd;
    if (start !== end) {
      editText(`${text.slice(0, start)}${text.slice(end)}`);
      setCaret(start);
    }
    editAttachments((prev) => [...prev, pasteAttachment(pasted)]);
  };

  useEffect(() => {
    if (!recording) return;
    const bridge = window.ogb;
    if (!bridge) {
      setRecording(false);
      return;
    }
    setSpeechError(null);
    const offTranscript = bridge.onSpeechTranscript((line) => {
      if (typeof line.text === "string") {
        const base = baseText.current;
        editText(base ? `${base} ${line.text}` : line.text);
      }
    });
    const offEnd = bridge.onSpeechEnd(({ code, reason }) => {
      setRecording(false);
      if (code === 2) {
        setSpeechError(t("composer.dictation.macOnly"));
      } else if (code === 1) {
        setSpeechError(t(
          reason === "dictation-disabled"
            ? "composer.dictation.disabled"
            : reason === "speech-not-authorized"
              ? "composer.dictation.permission"
              : "composer.dictation.failed",
        ));
      }
    });
    void bridge.speechStart();
    return () => {
      offTranscript();
      offEnd();
      void bridge.speechStop();
    };
  }, [recording, editText]);

  const toggleMic = () => {
    if (!capabilities.dictation.available || !window.ogb) {
      setSpeechError(t("composer.dictation.unavailable"));
      return;
    }
    baseText.current = text.trim();
    setRecording((r) => !r);
  };

  const stopTurn = !locked && (busy || Boolean(!group && bot?.waitingForTeammates)) ? interruptTurn : undefined;

  return (
    <div className="pointer-events-none relative px-5 pb-3">
      {speechError && (
        <div role="status" className="pointer-events-auto mb-2 w-full rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-[12px] text-warning">
          {speechError}
        </div>
      )}
      <div className="pointer-events-auto relative w-full">
        {failedSends.map((failed) => (
          <div
            key={failed.id}
            className="mb-2 flex items-center gap-2 rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-[12.5px] text-danger"
          >
            <span className="min-w-0 flex-1 truncate">
              {t("composer.failed.notSent", {
                text: failed.text.trim() || t("composer.failed.attachment"),
              })}
            </span>
            <button
              type="button"
              onClick={() => retryFailedSend(failed)}
              className="shrink-0 rounded px-2 py-1 font-medium hover:bg-danger/10"
            >
              {t("chat.retry")}
            </button>
            <button
              type="button"
              onClick={() => forgetFailedComposerSend(draftId, failed.id)}
              aria-label={t("composer.failed.dismissAria")}
              title={t("composer.failed.dismiss")}
              className="flex size-5 shrink-0 items-center justify-center rounded hover:bg-danger/10"
            >
              <X size={13} strokeWidth={2.5} />
            </button>
          </div>
        ))}
        <ComposerCommandList listRef={commandListRef} motion={commandMotion} commands={commandCandidates} highlight={highlight} onPick={pickCommand} onHighlight={setHighlight} />
        <ComposerMentionList listRef={mentionListRef} motion={mentionMotion} candidates={candidates} highlight={highlight} everyoneCount={mentionEveryoneCount} onPick={pickMention} onHighlight={setHighlight} />
        {approval && (
          <div className="mb-2 overflow-hidden rounded-[20px] border border-hairline/50 bg-composer ring-1 ring-composer-ring">
            <PendingApprovalPanel
              key={approval.requestId}
              pending={approval}
              botName={approvalBot?.name}
              count={approvals.length}
              index={0}
              locale={activeLocale()}
              actions={<PendingApprovalActions part="primary" pending={approval} threadId={threadId} bot={approvalBot} onCancelTurn={interruptTurn} />}
              more={<PendingApprovalActions part="more" pending={approval} threadId={threadId} bot={approvalBot} onCancelTurn={interruptTurn} />}
            />
          </div>
        )}
        <QueuedComposerMessages
          items={queuedMessages}
          onSteer={canSteerQueued ? steerQueued : undefined}
          steerInterrupts={!canSteer}
          steerMode={group ? "next" : "all"}
          steering={steering}
          onCancel={(queueId) => {
            if (group) dispatch({ type: "cancelGroupQueued", groupId: group.id, threadId, queueId });
            else if (bot) dispatch({ type: "cancelQueued", botId: bot.id, threadId, queueId });
          }}
          onEdit={locked ? undefined : editQueued}
        />
        <div className="relative">
          <div
            aria-hidden
            data-composer-backdrop
            className="pointer-events-none absolute -inset-x-5 -bottom-3 -top-6 bg-[linear-gradient(to_bottom,transparent,var(--color-app)_1.5rem)]"
          />
        <div
          data-tour="composer"
          data-composer-card
          className="@container/composer relative z-[1] flex flex-col rounded-[20px] border border-hairline/50 bg-composer shadow-[var(--composer-shadow)] ring-1 ring-composer-ring transition-[border-color,box-shadow] has-[textarea:focus]:border-focus/70 has-[textarea:focus]:shadow-[var(--composer-shadow),0_0_0_3px_color-mix(in_srgb,var(--color-focus)_16%,transparent)]"
        >
        {replyTo && <div className="px-2 pt-2"><ComposerReplyStrip message={replyTo} fallbackName={bot?.name} onClear={onClearReply} /></div>}
        <ComposerAttachments
          items={attachments}
          onAdd={addAttachments}
          onRemove={removeAttachment}
          onChangeCitation={(citation: CitationAttachment) => editAttachments((current) => current.map((attachment) => attachment.id === citation.id ? citation : attachment))}
          onDisplayInChatBox={displayPasteInChatBox}
          allowImages={engineSupportsImages}
          notice={attachmentNotice}
          onNotice={setAttachmentNotice}
          onPendingChange={(pending) => changeDraftAttachmentPending(draftId, pending)}
          uploadImage={uploadImage}
        />
          <MentionTextarea
          wrapperClassName="self-stretch [--mention-editor-pad:12px_14px_6px]"
          inputRef={inputRef}
          peers={mentionPeers}
          everyone={Boolean(group && !group.dm)}
          dir="auto"
          rows={1}
          value={text}
          onChange={(e) => {
            editText(e.target.value);
            setCaret(e.target.selectionStart ?? e.target.value.length);
            setDismissedAt(null);
            setDismissedSlashAt(null);
          }}
          onPaste={handlePaste}
          onKeyUp={(e) => setCaret((e.target as HTMLTextAreaElement).selectionStart ?? 0)}
          onClick={(e) => setCaret((e.target as HTMLTextAreaElement).selectionStart ?? 0)}
          onKeyDown={(e) => {
            // An input method's confirming Enter and arrows pick its own candidates, not a mention or command.
            if (imeComposing(e.nativeEvent)) return;
            if (commandPickerOpen) {
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                const delta = e.key === "ArrowDown" ? 1 : -1;
                setHighlight((current) =>
                  (current + delta + commandCandidates.length) % commandCandidates.length,
                );
                return;
              }
              if (e.key === "Enter" || e.key === "Tab") {
                e.preventDefault();
                pickCommand(commandCandidates[highlight]);
                return;
              }
              if (e.key === "Escape") {
                e.preventDefault();
                setDismissedSlashAt(slash?.start ?? null);
                return;
              }
            }
            if (mentionPickerOpen) {
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                const delta = e.key === "ArrowDown" ? 1 : -1;
                setHighlight((h) => (h + delta + candidates.length) % candidates.length);
                return;
              }
              if (e.key === "Enter" || e.key === "Tab") {
                e.preventDefault();
                pickMention(candidates[highlight]);
                return;
              }
              if (e.key === "Escape") {
                e.preventDefault();
                setDismissedAt(mention?.start ?? null);
                return;
              }
            }
            if (onClearReply && escapeCancelsReply(e.nativeEvent, { replying: Boolean(replyTo), recording })) {
              e.preventDefault();
              onClearReply();
              return;
            }
            if (e.key === "ArrowUp" && !hasContent && onEditLast) {
              e.preventDefault();
              onEditLast();
              return;
            }
            if (sendsMessage(e.nativeEvent, sendKey)) {
              e.preventDefault();
              if (
                canSteer &&
                doubleEnterSteersQueue(steerAgainUntilRef.current, Date.now(), pendingCount, hasContent)
              ) {
                steerAgainUntilRef.current = 0;
                steerQueued();
                return;
              }
              send();
            }
            if (e.key === "Escape" && recording) setRecording(false);
          }}
          // Not disabled during an upload: a disabled element drops keyboard focus for good. send() refuses while one
          // is pending.
          disabled={Boolean(approval) || locked}
          aria-busy={bot?.awaitingThreadSnapshot || undefined}
          placeholder={
            setupLocked
              ? t("composer.placeholder.locked")
              : approval
              ? t("composer.placeholder.approval")
              : attachmentPending
              ? t("composer.placeholder.attaching")
              : recording
              ? t("composer.placeholder.listening")
              : replyTo && !busy
              ? t("composer.placeholder.reply")
              : busy && canSteer
                ? pendingCount > 0
                  ? t("composer.placeholder.steerQueued", { name: busyName, key: sendLabel })
                  : t("composer.placeholder.steer", { name: busyName, key: sendLabel })
              : busy
                ? group
                  ? t("composer.placeholder.queueGroup", { name: busyName, key: sendLabel })
                  : t("composer.placeholder.queue", { name: busyName })
                : group
                  ? channelMode === "goal"
                    ? t("composer.placeholder.goal", { name: group.name })
                    : t("composer.placeholder.group", {
                        name: group.name,
                        hint: groupComposerHint(group, members ?? [], { jevOn: jevRoomRoutingOn(state.config) }),
                      })
                  : t(botTakesCommands ? "composer.placeholder.botCommands" : "composer.placeholder.bot", { name: bot?.name ?? "" })
          }
          aria-label={t("composer.placeholder.bot", { name: group ? group.name : (bot?.name ?? "") })}
            className="block max-h-[13rem] min-h-11 w-full resize-none overflow-y-auto bg-transparent text-[15px] leading-6 placeholder:text-ink-tertiary focus:outline-none"
          />
        <div data-composer-row className="flex min-w-0 items-center gap-1 px-2 pb-2 pt-1">
          <input
            ref={fileInput}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              void pickFiles(e.target.files);
              // Reset so picking the same file again still fires onChange.
              e.target.value = "";
            }}
          />
          <div data-composer-tools className="flex min-w-0 flex-1 items-center gap-0.5">
          {!locked && (
            <>
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                aria-label={t("composer.attach")}
                title={t("composer.attach")}
                className={COMPOSER_TOOL}
              >
                <Paperclip size={17} aria-hidden="true" />
              </button>
              {bot && !group && !remoteClient && <ModelPicker key={bot.threadId} bot={bot} threadId={bot.threadId} className="min-w-0" />}
              {group && !group.dm && (
                <button
                  type="button"
                  aria-pressed={effectiveChannelMode === "goal"}
                  aria-label={t("composer.goal.aria")}
                  title={t("composer.goal.title")}
                  onClick={() => {
                    markDraftEdited(draftId);
                    if (typedGoalText !== null) {
                      const nextCaret = Math.max(0, caret - (text.length - typedGoalText.length));
                      editText(typedGoalText);
                      setCaret(nextCaret);
                      setChannelMode("chat");
                      requestAnimationFrame(() => {
                        inputRef.current?.focus();
                        inputRef.current?.setSelectionRange(nextCaret, nextCaret);
                      });
                      return;
                    }
                    setChannelMode((current) => current === "goal" ? "chat" : "goal");
                  }}
                  className={cn(
                    "flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-[13px] font-medium transition-colors",
                    effectiveChannelMode === "goal"
                      ? "bg-accent/12 text-accent-text"
                      : "text-ink-secondary hover:bg-ink/[0.07] hover:text-ink",
                  )}
                >
                  <Target size={15} aria-hidden="true" />
                  {effectiveChannelMode === "goal" ? "/goal" : t("composer.goal.chip")}
                </button>
              )}
              {modeBot && approvalEngine && !remoteClient && (
                <ApprovalModeSelector
                  approvalMode={modeBot.approvalMode}
                  autoApprove={modeBot.autoApprove}
                  providerName={approvalEngine.displayName}
                  driverKind={approvalEngine.driverKind}
                  onSelect={setApprovalMode}
                  disabled={Boolean(modeBot.busy)}
                  trustedModesAvailable={trustedThreadAccess}
                  onManageCommandAllowlist={ownerOrAdmin === true ? () => setCommandAllowlistTarget({ botId: modeBot.id, botName: modeBot.name, threadId: modeBot.threadId }) : undefined}
                />
              )}
              {modeBot && !remoteClient && advanced && (
                <PlaceChip
                  bot={modeBot}
                  task={composerTask}
                  live={Boolean(modeBot.busy)}
                  disabled={Boolean(modeBot.busy)}
                  onPin={(surface) => dispatch({ type: "updateTask", botId: modeBot.id, threadId: modeBot.threadId, patch: { surface } })}
                />
              )}
            </>
          )}
          </div>
          <div data-composer-actions className="flex shrink-0 items-center gap-0.5">
            {bot && !group && <AgentBudgetPill shared={bot.shared} placement="composer" />}
            {bot && !group && <ChatUsagePopover bot={bot} messages={transcript} />}
            {!locked && !busy && !hasContent && capabilities.dictation.available && (
              <button
                type="button"
                onClick={toggleMic}
                aria-label={recording ? t("composer.dictation.stop") : t("composer.dictation.start")}
                className={cn(COMPOSER_TOOL, recording && "animate-pulse bg-danger/15 text-danger hover:bg-danger/20 hover:text-danger")}
                title={recording ? t("composer.dictation.stopHint") : t("composer.dictation.hint")}
              >
                <Mic size={17} aria-hidden="true" />
              </button>
            )}
            {bot && !group && <CallButton bot={bot} placement="composer" />}
            {!locked && (
              <ComposerSendButton busy={busy} canSteer={canSteer} hasContent={hasContent} attachmentPending={attachmentPending} sendLabel={sendLabel} onSend={send} onStop={stopTurn} />
            )}
          </div>
        </div>
        </div>
        </div>
      </div>
      <div className="pointer-events-auto">
      {commandAllowlistTarget && <CommandAllowlistDialog
        key={`${commandAllowlistTarget.botId}:${commandAllowlistTarget.threadId}`}
        {...commandAllowlistTarget}
        onClose={() => setCommandAllowlistTarget(null)}
      />}
      <LocalComputerAutoWarning
        open={approvalWarning?.mode === "auto"}
        onCancel={() => setApprovalWarning(null)}
        onConfirm={() => {
          if (approvalWarning?.mode === "auto") {
            dispatch({
              type: "updateTask",
              botId: approvalWarning.botId,
              threadId: approvalWarning.threadId,
              patch: { approvalMode: "auto", acknowledgeLocalAuto: true },
            });
          }
          setApprovalWarning(null);
        }}
      />
      </div>
    </div>
  );
}
