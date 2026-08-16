// Opens the side panel when the toolbar icon is clicked and keeps the
// active Lovable project id in sync so the panel can auto-detect it.
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((err) => console.error("sidePanel behavior", err));
});

const LOVABLE_PROJECT_RE =
  /^https:\/\/lovable\.dev\/projects\/([0-9a-zA-Z-]+)/;

async function detectFromTab(tab) {
  if (!tab?.url) return;
  const match = LOVABLE_PROJECT_RE.exec(tab.url);
  if (!match) return;
  await chrome.storage.local.set({
    detectedProject: { id: match[1], url: match[0], at: Date.now() },
  });
}

chrome.tabs.onUpdated.addListener((_id, info, tab) => {
  if (info.status === "complete") detectFromTab(tab);
});
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    detectFromTab(await chrome.tabs.get(tabId));
  } catch {
    /* tab gone */
  }
});