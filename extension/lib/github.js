const API = "https://api.github.com";

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
    throw new Error(`GitHub ${res.status}: ${body.slice(0, 400)}`);
  }
  return res.json();
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