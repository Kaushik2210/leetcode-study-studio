'use strict';
// Keeps the toolbar badge equal to the number of problems due for review today.
importScripts('srs.js');

async function updateBadge() {
  const all = await chrome.storage.local.get(null);
  const problems = Object.entries(all).filter(([k]) => k.startsWith('p:')).map(([, v]) => v);
  const due = LCS.dueCards(problems, Date.now()).length;
  await chrome.action.setBadgeText({ text: due ? String(due) : '' });
  await chrome.action.setBadgeBackgroundColor({ color: '#0a64d6' });
  await chrome.action.setTitle({ title: due ? `LeetCode Study Studio: ${due} due for review` : 'LeetCode Study Studio' });
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('lcs-badge', { periodInMinutes: 60 });
  updateBadge();
});
chrome.runtime.onStartup.addListener(updateBadge);
chrome.alarms.onAlarm.addListener((a) => { if (a.name === 'lcs-badge') updateBadge(); });
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && Object.keys(changes).some((k) => k.startsWith('p:'))) updateBadge();
});
