import {
  getSettings,
  setSettings,
  activeProvider,
  getConversation,
  setConversation,
  getPending,
  setPending,
} from "./lib/storage.js";
import {
  getTree,
  getFileContent,
  listBranches,
  isTextFile,
  commitChanges,
  openPullRequest,
} from "./lib/github.js";
import {
  SYSTEM_PROMPT,
  extractChanges,
  stripChangesBlock,
} from "./lib/prompt.js";
import { ProviderError } from "./lib/providers.js";
import { lineDiff, collapseContext, diffStats } from "./lib/diff.js";

const $ = (id) => document.getElementById(id);

const state = {
  settings: null,
  project: null,
  branch: "",
  tree: [],
  fileCache: new Map(),
  ai: null, // { provider, apiKey, model }
  messages: [],
  pending: [],
  controller: null,
};

function assistantName() {
  return state.ai?.provider?.label || "The model";
}

/** Keeps the header badge showing which provider is actually being used. */
function renderProviderBadge() {
  const el = $("providerBadge");
  if (!el) return;
  if (!state.ai?.provider) {
    el.textContent = "";
    return;
  }
  el.textContent = `${state.ai.provider.label} · ${state.ai.model}${
    state.ai.apiKey ? "" : " · no API key"
  }`;
  el.className = `status ${state.ai.apiKey ? "muted" : "warn"}`;
}

function setStatus(text, kind = "muted") {
  const el = $("status");
  el.className = `status ${kind}`;
  el.textContent = text;
}

function escapeHtml(text) {
  return text.replace(
    /[&<>]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c],
  );
}

/* ---------- rendering ---------- */

function renderChat(streaming = "") {
  const view = $("viewChat");
  view.innerHTML = "";
  if (!state.messages.length && !streaming) {
    view.innerHTML =
      `<p class="muted">Ask a question about the repo, or describe a change. ${assistantName()} replies with full-file edits you can review before pushing.</p>`;
  }
  for (const message of state.messages) {
    const div = document.createElement("div");
    div.className = `msg ${message.role}`;
    div.innerHTML = `<div class="who">${message.role === "user" ? "You" : assistantName()}</div><div class="bubble"></div>`;
    div.querySelector(".bubble").textContent =
      message.role === "assistant"
        ? stripChangesBlock(message.content) ||
          "(proposed file changes — see Changes tab)"
        : message.content;
    view.append(div);
  }
  if (streaming) {
    const div = document.createElement("div");
    div.className = "msg assistant";
    div.innerHTML = `<div class="who">${assistantName()}</div><div class="bubble"></div>`;
    div.querySelector(".bubble").textContent = stripChangesBlock(streaming);
    view.append(div);
  }
  view.scrollIntoView(false);
  $("viewChat").parentElement.scrollTop =
    $("viewChat").parentElement.scrollHeight;
}

function renderFiles() {
  const view = $("viewFiles");
  view.innerHTML = "";
  if (!state.tree.length) {
    view.innerHTML = '<p class="muted">No files loaded.</p>';
    return;
  }
  const byDir = new Map();
  for (const node of state.tree) {
    const dir = node.path.includes("/")
      ? node.path.slice(0, node.path.lastIndexOf("/"))
      : ".";
    if (!byDir.has(dir)) byDir.set(dir, []);
    byDir.get(dir).push(node);
  }
  [...byDir.keys()].sort().forEach((dir) => {
    const head = document.createElement("div");
    head.className = "dir";
    head.textContent = `${dir}/`;
    view.append(head);
    byDir
      .get(dir)
      .sort((a, b) => a.path.localeCompare(b.path))
      .forEach((node) => {
        const row = document.createElement("div");
        row.className = "file";
        row.textContent = node.path.split("/").pop();
        view.append(row);
      });
  });
}

function renderChanges() {
  const view = $("viewChanges");
  view.innerHTML = "";
  $("pendingCount").textContent = state.pending.length
    ? `(${state.pending.length})`
    : "";
  $("pushBar").classList.toggle(
    "hidden",
    !state.pending.length || $("viewChanges").classList.contains("hidden"),
  );

  if (!state.pending.length) {
    view.innerHTML =
      '<p class="muted">No pending changes. Ask the model for a change to see diffs here.</p>';
    return;
  }

  state.pending.forEach((change, index) => {
    const card = document.createElement("div");
    card.className = "change";

    const rows =
      change.action === "delete"
        ? (change.oldContent || "")
            .split("\n")
            .map((text) => ({ type: "del", text }))
        : lineDiff(change.oldContent || "", change.newContent || "");
    const stats = diffStats(rows);

    const head = document.createElement("div");
    head.className = "head";
    head.innerHTML = `<span class="badge ${change.action}">${change.action}</span>
      <span class="path">${escapeHtml(change.path)}</span>
      <span class="muted">+${stats.added}/-${stats.removed}</span>`;
    const discard = document.createElement("button");
    discard.className = "tiny";
    discard.textContent = "Discard";
    discard.onclick = async () => {
      state.pending.splice(index, 1);
      await setPending(state.project.id, state.pending);
      renderChanges();
    };
    head.append(discard);

    const pre = document.createElement("pre");
    pre.className = "diff";
    collapseContext(rows).forEach((row) => {
      const span = document.createElement("span");
      span.className = row.type;
      span.textContent =
        row.type === "add"
          ? `+ ${row.text}`
          : row.type === "del"
            ? `- ${row.text}`
            : row.type === "gap"
              ? row.text
              : `  ${row.text}`;
      pre.append(span);
    });

    card.append(head, pre);
    view.append(card);
  });
}

function switchTab(tab) {
  const tabs = { chat: "viewChat", files: "viewFiles", changes: "viewChanges" };
  Object.entries(tabs).forEach(([name, viewId]) => {
    $(viewId).classList.toggle("hidden", name !== tab);
    $(`tab${name[0].toUpperCase()}${name.slice(1)}`).setAttribute(
      "aria-selected",
      String(name === tab),
    );
  });
  $("chatBar").classList.toggle("hidden", tab === "changes");
  $("pushBar").classList.toggle(
    "hidden",
    tab !== "changes" || !state.pending.length,
  );
}

/* ---------- data loading ---------- */

function buildIndex() {
  return state.tree
    .map((node) => `${node.path} (${node.size ?? 0}B)`)
    .join("\n");
}

async function loadProject() {
  const { githubToken } = state.settings;
  if (!state.project) {
    setStatus("Add a project in settings (⚙) first.", "warn");
    return;
  }
  if (!githubToken) {
    setStatus("Missing GitHub token — open settings (⚙).", "warn");
    return;
  }
  const { owner, repo } = state.project;
  setStatus("Loading repository…");
  try {
    const branches = await listBranches(githubToken, owner, repo);
    const select = $("branchSelect");
    select.innerHTML = "";
    branches.forEach((branch) => {
      const option = document.createElement("option");
      option.value = branch.name;
      option.textContent = branch.name;
      select.append(option);
    });
    state.branch =
      branches.find((b) => b.name === state.branch)?.name ||
      branches.find((b) => b.name === state.project.branch)?.name ||
      branches[0]?.name ||
      "main";
    select.value = state.branch;

    state.tree = await getTree(githubToken, owner, repo, state.branch);
    state.fileCache.clear();
    renderFiles();
    setStatus(
      `✅ ${owner}/${repo} @ ${state.branch} — ${state.tree.length} files`,
      "ok",
    );
  } catch (error) {
    setStatus(`⚠️ ${error.message}`, "err");
  }
}

async function readFile(path) {
  if (state.fileCache.has(path)) return state.fileCache.get(path);
  const content = await getFileContent(
    state.settings.githubToken,
    state.project.owner,
    state.project.repo,
    path,
    state.branch,
  );
  state.fileCache.set(path, content);
  return content;
}

// Picks likely-relevant files for the prompt without shipping the whole repo.
function pickContextFiles(prompt) {
  const words = prompt
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 3);
  const scored = state.tree
    .filter((node) => isTextFile(node.path, node.size ?? 0))
    .map((node) => {
      const lower = node.path.toLowerCase();
      let score = words.reduce(
        (sum, word) => sum + (lower.includes(word) ? 5 : 0),
        0,
      );
      if (/^src\//.test(node.path)) score += 2;
      if (/\.(tsx?|jsx?|css)$/.test(node.path)) score += 1;
      if (/(package\.json|styles\.css|__root|index\.tsx)/.test(node.path))
        score += 2;
      return { node, score };
    })
    .sort((a, b) => b.score - a.score);

  const picked = [];
  let budget = 90_000;
  for (const { node, score } of scored) {
    if (score <= 0 && picked.length >= 6) break;
    if ((node.size ?? 0) > budget) continue;
    picked.push(node.path);
    budget -= node.size ?? 0;
    if (picked.length >= 14 || budget <= 0) break;
  }
  return picked;
}

/* ---------- chat ---------- */

async function send() {
  const prompt = $("prompt").value.trim();
  if (!prompt) return;
  state.settings = await getSettings();
  state.ai = activeProvider(state.settings);
  renderProviderBadge();
  if (!state.ai.apiKey) {
    setStatus(
      `Missing ${state.ai.provider.label} API key — open settings (⚙).`,
      "warn",
    );
    return;
  }
  if (!state.tree.length) {
    setStatus("Load a repository first.", "warn");
    return;
  }

  $("prompt").value = "";
  state.messages.push({ role: "user", content: prompt });
  renderChat();
  $("send").disabled = true;
  $("stop").classList.remove("hidden");
  setStatus("Collecting context…");

  try {
    const paths = pickContextFiles(prompt);
    const files = [];
    for (const path of paths) {
      try {
        files.push(`--- FILE: ${path} ---\n${await readFile(path)}`);
      } catch {
        /* skip unreadable file */
      }
    }

    const system = `${SYSTEM_PROMPT}

REPOSITORY: ${state.project.owner}/${state.project.repo} @ ${state.branch}
${state.project.lovableUrl ? `LOVABLE PROJECT: ${state.project.lovableUrl}` : ""}

FILE INDEX:
${buildIndex()}

FILE CONTENTS PROVIDED THIS TURN:
${files.join("\n\n") || "(none)"}`;

    state.controller = new AbortController();
    setStatus(`${state.ai.provider.label} is thinking…`);

    const full = await state.ai.provider.streamChatCompletion({
      apiKey: state.ai.apiKey,
      model: state.ai.model,
      system,
      messages: state.messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      signal: state.controller.signal,
      onDelta: (_delta, text) => renderChat(text),
    });

    state.messages.push({ role: "assistant", content: full });
    await setConversation(state.project.id, state.messages);
    renderChat();

    const proposal = extractChanges(full);
    if (proposal) {
      for (const change of proposal.changes) {
        let oldContent = "";
        if (change.action !== "create") {
          try {
            oldContent = await readFile(change.path);
          } catch {
            oldContent = "";
          }
        }
        const entry = {
          path: change.path,
          action: change.action,
          newContent: change.newContent ?? "",
          oldContent,
        };
        const existing = state.pending.findIndex(
          (p) => p.path === entry.path,
        );
        if (existing >= 0) state.pending[existing] = entry;
        else state.pending.push(entry);
      }
      if (proposal.summary) $("commitMessage").value = proposal.summary;
      await setPending(state.project.id, state.pending);
      renderChanges();
      switchTab("changes");
      setStatus(`${state.pending.length} file(s) pending review.`, "warn");
    } else {
      setStatus(
        `✅ ${state.project.owner}/${state.project.repo} @ ${state.branch}`,
        "ok",
      );
    }
  } catch (error) {
    if (error.name === "AbortError") setStatus("Stopped.", "warn");
    else if (error instanceof ProviderError)
      setStatus(
        `⚠️ ${error.message}`,
        error.kind === "rate_limit" || error.kind === "quota" ? "warn" : "err",
      );
    else setStatus(`⚠️ ${error.message}`, "err");
  } finally {
    state.controller = null;
    $("send").disabled = false;
    $("stop").classList.add("hidden");
  }
}

/* ---------- push ---------- */

function updatePushWarning() {
  const mode = $("pushMode").value;
  $("pushWarning").textContent =
    mode === "direct"
      ? `⚠️ Committing straight to "${state.branch}" — Lovable will sync this within seconds.`
      : `A new branch and PR will be created from "${state.branch}". Lovable syncs only after you merge.`;
}

async function push() {
  if (!state.pending.length) return;
  const mode = $("pushMode").value;
  const message = $("commitMessage").value.trim() || "Update project files";
  const target =
    mode === "direct"
      ? state.branch
      : `claude/${Date.now().toString(36)}-${message
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "")
          .slice(0, 40)}`;

  $("push").disabled = true;
  $("pushResult").className = "status muted";
  $("pushResult").textContent = "Pushing…";

  try {
    const result = await commitChanges(state.settings.githubToken, {
      owner: state.project.owner,
      repo: state.project.repo,
      baseBranch: state.branch,
      targetBranch: target,
      message,
      changes: state.pending,
    });

    let link = `https://github.com/${state.project.owner}/${state.project.repo}/commit/${result.commit.sha}`;
    let note = "Lovable will sync this branch within a few seconds.";

    if (mode === "pr") {
      const pr = await openPullRequest(state.settings.githubToken, {
        owner: state.project.owner,
        repo: state.project.repo,
        head: target,
        base: state.branch,
        title: message,
        body: `Generated with ${state.ai?.provider?.label || "AI"} via the Lovable ⇄ GitHub extension.\n\nFiles:\n${state.pending
          .map((c) => `- \`${c.path}\` (${c.action})`)
          .join("\n")}`,
      });
      link = pr.html_url;
      note = "Merge the PR and Lovable will pick up the change automatically.";
    }

    state.pending = [];
    await setPending(state.project.id, state.pending);
    state.fileCache.clear();
    renderChanges();

    $("pushResult").className = "status ok";
    $("pushResult").innerHTML = `✅ Pushed. <a href="${link}" target="_blank" rel="noreferrer">Open on GitHub</a><br /><span class="muted">${note}</span>`;
  } catch (error) {
    $("pushResult").className = "status err";
    $("pushResult").textContent = `⚠️ ${error.message}`;
  } finally {
    $("push").disabled = false;
  }
}

/* ---------- init ---------- */

async function selectProject(id) {
  state.settings = await getSettings();
  state.ai = activeProvider(state.settings);
  renderProviderBadge();
  state.project = state.settings.projects.find((p) => p.id === id) || null;
  if (!state.project) {
    setStatus("Add a project in settings (⚙) first.", "warn");
    renderChat();
    renderChanges();
    return;
  }
  state.branch = state.project.branch;
  await setSettings({ activeProjectId: id });
  state.messages = await getConversation(id);
  state.pending = await getPending(id);
  renderChat();
  renderChanges();
  await loadProject();
  updatePushWarning();
}

async function init() {
  state.settings = await getSettings();
  state.ai = activeProvider(state.settings);
  renderProviderBadge();
  $("pushMode").value = state.settings.pushMode;

  const select = $("projectSelect");
  select.innerHTML = "";
  if (!state.settings.projects.length) {
    const option = document.createElement("option");
    option.textContent = "No project — open settings ⚙";
    select.append(option);
  }
  state.settings.projects.forEach((project) => {
    const option = document.createElement("option");
    option.value = project.id;
    option.textContent = `${project.owner}/${project.repo}`;
    select.append(option);
  });

  // Auto-detect: prefer the project matching the open lovable.dev tab.
  const { detectedProject } = await chrome.storage.local.get("detectedProject");
  const detected = state.settings.projects.find(
    (p) => detectedProject?.id && p.lovableId === detectedProject.id,
  );
  const initial =
    detected?.id ||
    state.settings.activeProjectId ||
    state.settings.projects[0]?.id;
  if (initial) {
    select.value = initial;
    await selectProject(initial);
  } else {
    renderChat();
    renderChanges();
  }

  select.onchange = () => selectProject(select.value);
  $("branchSelect").onchange = async () => {
    state.branch = $("branchSelect").value;
    await loadProject();
    updatePushWarning();
  };
  $("reload").onclick = () => loadProject();
  $("openOptions").onclick = () => chrome.runtime.openOptionsPage();
  $("tabChat").onclick = () => switchTab("chat");
  $("tabFiles").onclick = () => switchTab("files");
  $("tabChanges").onclick = () => switchTab("changes");
  $("send").onclick = send;
  $("stop").onclick = () => state.controller?.abort();
  $("push").onclick = push;
  $("pushMode").onchange = async () => {
    updatePushWarning();
    await setSettings({ pushMode: $("pushMode").value });
  };
  $("prompt").addEventListener("keydown", (event) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) send();
  });
}

init();