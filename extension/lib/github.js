const API = "https://api.github.com";

/** Turns raw GitHub auth/permission failures into actionable guidance. */
function explain(status, path, body) {
  const write = /\/git\/(blobs|trees|commits|refs)|\/contents\/|\/pulls/.test(
    path,
  );
  if (status === 401) {
    return "GitHub 401: the token is invalid or expired. Open Settings (⚙) and paste a fresh token.";
  }
  if (status === 403 && /not accessible by personal access token/i.test(body)) {
    return (
      "GitHub 403: your token lacks the required repository permission" +
      (write ? " to write code" : "") +
      ".\n\nFix it on the token page (Settings → Developer settings → Personal access tokens → Fine-grained tokens):\n" +
      "• Repository access: include this exact repository\n" +
      "• Permissions → Repository → Contents: Read and write\n" +
      "• Permissions → Repository → Pull requests: Read and write (needed for PR mode)\n" +
      "• Permissions → Repository → Metadata: Read-only (auto-required)\n\n" +
      "If the repo belongs to an organization, an owner must also approve the token " +
      "(Org → Settings → Personal access tokens → Pending requests).\n" +
      "Classic tokens need the full `repo` scope instead. Save the new token in Settings (⚙)."
    );
  }
  if (status === 403 && /rate limit/i.test(body)) {
    return "GitHub 403: API rate limit exceeded. Wait a few minutes and retry.";
  }
  if (status === 404 && write) {
    return "GitHub 404: repository not found or the token can't see it. Check owner/repo in Settings and that the token grants access to this repository.";
  }
  return `GitHub ${status}: ${body.slice(0, 400)}`;
}

async function gh(token, path, options = {}) {
  const res = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(explain(res.status, path, body));
  }
  return res.json();
}

/** Reports which write permissions the stored token actually has on a repo. */
export async function checkTokenAccess(token, owner, repo) {
  const res = await fetch(`${API}/repos/${owner}/${repo}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!res.ok) {
    const body = await res.text();
    return { ok: false, message: explain(res.status, "/contents/", body) };
  }
  const data = await res.json();
  const perms = data.permissions || {};
  if (!perms.push) {
    return {
      ok: false,
      message: explain(
        403,
        "/git/blobs",
        "Resource not accessible by personal access token",
      ),
    };
  }
  return { ok: true, message: `✅ Write access confirmed on ${data.full_name}` };
}


export function getRepo(token, owner, repo) {
  return gh(token, `/repos/${owner}/${repo}`);
}

export function listBranches(token, owner, repo) {
  return gh(token, `/repos/${owner}/${repo}/branches?per_page=100`);
}

export async function getTree(token, owner, repo, branch) {
  const data = await gh(
    token,
    `/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
  );
  return (data.tree || []).filter((n) => n.type === "blob");
}

const BINARY_RE =
  /\.(png|jpe?g|gif|webp|avif|ico|svg|woff2?|ttf|otf|mp[34]|mov|pdf|zip|lock)$/i;

export function isTextFile(path, size = 0) {
  return !BINARY_RE.test(path) && size < 120_000;
}

export async function getFileContent(token, owner, repo, path, branch) {
  const data = await gh(
    token,
    `/repos/${owner}/${repo}/contents/${path
      .split("/")
      .map(encodeURIComponent)
      .join("/")}?ref=${encodeURIComponent(branch)}`,
  );
  if (Array.isArray(data)) throw new Error(`${path} is a directory`);
  const binary = atob((data.content || "").replace(/\n/g, ""));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function toBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary);
}

/**
 * Commits multiple file changes as a single commit using the Git Data API.
 * changes: [{ path, action: "edit"|"create"|"delete", newContent }]
 */
export async function commitChanges(
  token,
  { owner, repo, baseBranch, targetBranch, message, changes },
) {
  const baseRef = await gh(
    token,
    `/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(baseBranch)}`,
  );
  const baseSha = baseRef.object.sha;
  const baseCommit = await gh(
    token,
    `/repos/${owner}/${repo}/git/commits/${baseSha}`,
  );

  const treeItems = [];
  for (const change of changes) {
    if (change.action === "delete") {
      treeItems.push({
        path: change.path,
        mode: "100644",
        type: "blob",
        sha: null,
      });
      continue;
    }
    const blob = await gh(token, `/repos/${owner}/${repo}/git/blobs`, {
      method: "POST",
      body: JSON.stringify({
        content: toBase64(change.newContent ?? ""),
        encoding: "base64",
      }),
    });
    treeItems.push({
      path: change.path,
      mode: "100644",
      type: "blob",
      sha: blob.sha,
    });
  }

  const tree = await gh(token, `/repos/${owner}/${repo}/git/trees`, {
    method: "POST",
    body: JSON.stringify({ base_tree: baseCommit.tree.sha, tree: treeItems }),
  });

  const commit = await gh(token, `/repos/${owner}/${repo}/git/commits`, {
    method: "POST",
    body: JSON.stringify({ message, tree: tree.sha, parents: [baseSha] }),
  });

  if (targetBranch === baseBranch) {
    await gh(
      token,
      `/repos/${owner}/${repo}/git/refs/heads/${encodeURIComponent(baseBranch)}`,
      { method: "PATCH", body: JSON.stringify({ sha: commit.sha }) },
    );
    return { commit, branch: baseBranch, pr: null };
  }

  await gh(token, `/repos/${owner}/${repo}/git/refs`, {
    method: "POST",
    body: JSON.stringify({
      ref: `refs/heads/${targetBranch}`,
      sha: commit.sha,
    }),
  });
  return { commit, branch: targetBranch, pr: null };
}

export function openPullRequest(
  token,
  { owner, repo, head, base, title, body },
) {
  return gh(token, `/repos/${owner}/${repo}/pulls`, {
    method: "POST",
    body: JSON.stringify({ head, base, title, body }),
  });
}