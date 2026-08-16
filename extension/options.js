import {
  getSettings,
  setSettings,
  parseRepoUrl,
  parseLovableUrl,
  PROVIDERS,
  getProvider,
} from "./lib/storage.js";
import { testProvider, ProviderError } from "./lib/providers.js";
import { checkTokenAccess } from "./lib/github.js";


const $ = (id) => document.getElementById(id);
let projects = [];
let providerKeys = {};
let providerModels = {};
let currentProviderId = "";

function renderProjects() {
  const list = $("projectList");
  list.innerHTML = "";
  if (!projects.length) {
    list.innerHTML = '<li class="muted">No projects paired yet.</li>';
    return;
  }
  projects.forEach((project) => {
    const li = document.createElement("li");
    const label = document.createElement("div");
    label.className = "grow";
    label.innerHTML = `<strong>${project.owner}/${project.repo}</strong> <span class="muted">@ ${project.branch}</span>${
      project.lovableUrl
        ? `<div class="muted" style="font-size:11px">${project.lovableUrl}</div>`
        : ""
    }`;
    const remove = document.createElement("button");
    remove.className = "tiny";
    remove.textContent = "Remove";
    remove.onclick = async () => {
      projects = projects.filter((p) => p.id !== project.id);
      await setSettings({ projects });
      renderProjects();
    };
    li.append(label, remove);
    list.append(li);
  });
}

/** Persists whatever is currently typed for the provider being left. */
function captureProviderFields() {
  if (!currentProviderId) return;
  providerKeys[currentProviderId] = $("apiKey").value.trim();
  providerModels[currentProviderId] = $("model").value.trim();
}

function renderProviderFields(providerId) {
  const provider = getProvider(providerId);
  currentProviderId = provider.id;
  $("provider").value = provider.id;
  $("providerNotes").textContent = `${provider.notes} · ${provider.baseUrl}`;
  $("apiKey").value = providerKeys[provider.id] || "";
  $("apiKey").placeholder = provider.keyPlaceholder;
  $("model").value = providerModels[provider.id] || provider.defaultModel;
  $("signupLink").href = provider.signupUrl;
  $("testResult").textContent = "";
  $("testResult").className = "status muted";
}

async function init() {
  const settings = await getSettings();
  providerKeys = { ...settings.providerKeys };
  providerModels = { ...settings.providerModels };

  const select = $("provider");
  select.innerHTML = "";
  PROVIDERS.forEach((provider) => {
    const option = document.createElement("option");
    option.value = provider.id;
    option.textContent = provider.label;
    select.append(option);
  });
  renderProviderFields(settings.provider);

  $("githubToken").value = settings.githubToken;
  $("pushMode").value = settings.pushMode;
  projects = settings.projects;
  renderProjects();
}

$("provider").onchange = () => {
  captureProviderFields();
  renderProviderFields($("provider").value);
};

$("test").onclick = async () => {
  captureProviderFields();
  const provider = getProvider(currentProviderId);
  const result = $("testResult");
  const apiKey = providerKeys[provider.id];
  if (!apiKey) {
    result.className = "status warn";
    result.textContent = `Enter an API key for ${provider.label} first.`;
    return;
  }
  $("test").disabled = true;
  result.className = "status muted";
  result.textContent = `Testing ${provider.label}…`;
  try {
    const { reply } = await testProvider({
      providerId: provider.id,
      apiKey,
      model: providerModels[provider.id] || provider.defaultModel,
    });
    result.className = "status ok";
    result.textContent = `✅ ${provider.label} responded: "${reply}"`;
  } catch (error) {
    result.className = "status err";
    result.textContent = `⚠️ ${error instanceof ProviderError ? error.message : `${provider.label}: ${error.message}`}`;
  } finally {
    $("test").disabled = false;
  }
};

$("testGithub").onclick = async () => {
  const result = $("githubResult");
  const token = $("githubToken").value.trim();
  const repo =
    parseRepoUrl($("repoUrl").value) ||
    (projects[projects.length - 1]
      ? {
          owner: projects[projects.length - 1].owner,
          repo: projects[projects.length - 1].repo,
        }
      : null);
  if (!token) {
    result.className = "status warn";
    result.textContent = "Enter a GitHub token first.";
    return;
  }
  if (!repo) {
    result.className = "status warn";
    result.textContent = "Add a project (or paste a repo URL) to test against.";
    return;
  }
  $("testGithub").disabled = true;
  result.className = "status muted";
  result.textContent = `Checking ${repo.owner}/${repo.repo}…`;
  try {
    const check = await checkTokenAccess(token, repo.owner, repo.repo);
    result.className = `status ${check.ok ? "ok" : "err"}`;
    result.textContent = check.message;
  } catch (error) {
    result.className = "status err";
    result.textContent = `⚠️ ${error.message}`;
  } finally {
    $("testGithub").disabled = false;
  }
};

$("addProject").onclick = async () => {

  const repo = parseRepoUrl($("repoUrl").value);
  if (!repo) {
    alert("Enter a GitHub repo URL or owner/repo.");
    return;
  }
  const branch = $("branch").value.trim() || "main";
  const lovableUrl = $("lovableUrl").value.trim();
  const project = {
    id: `${repo.owner}/${repo.repo}@${branch}`,
    owner: repo.owner,
    repo: repo.repo,
    branch,
    lovableUrl,
    lovableId: parseLovableUrl(lovableUrl),
  };
  projects = [...projects.filter((p) => p.id !== project.id), project];
  await setSettings({ projects, activeProjectId: project.id });
  $("repoUrl").value = "";
  $("lovableUrl").value = "";
  $("branch").value = "";
  renderProjects();
};

$("save").onclick = async () => {
  captureProviderFields();
  await setSettings({
    provider: currentProviderId,
    providerKeys,
    providerModels,
    githubToken: $("githubToken").value.trim(),
    pushMode: $("pushMode").value,
    projects,
  });
  const saved = $("saved");
  saved.classList.remove("hidden");
  setTimeout(() => saved.classList.add("hidden"), 1800);
};

init();
