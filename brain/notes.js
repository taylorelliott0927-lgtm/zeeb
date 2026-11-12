// Visitors leave Zeeb notes as GitHub issues labelled "note". He reads them, and when he
// chooses to answer, his reply is posted as a comment and the note is closed.
import { fetchWithTimeout, log } from "./util.js";

const TOKEN = process.env.GITHUB_TOKEN || "";
const REPO = process.env.GITHUB_REPOSITORY || "";
const API = process.env.GITHUB_API_URL || "https://api.github.com";

const headers = () => ({
  Authorization: `Bearer ${TOKEN}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "zeeb-bot",
});

export const notesEnabled = () => Boolean(TOKEN && REPO);

// Make sure the "note" label exists so the note form can tag issues with it.
async function ensureLabel() {
  const r = await fetchWithTimeout(`${API}/repos/${REPO}/labels/note`, { headers: headers() });
  if (r.status !== 404) return;
  await fetchWithTimeout(`${API}/repos/${REPO}/labels`, {
    method: "POST", headers: headers(), body: JSON.stringify({ name: "note", color: "d0602e", description: "A note for Zeeb" }),
  });
}

export async function fetchNotes() {
  if (!notesEnabled()) return [];
  try {
    await ensureLabel().catch(() => {});
    const res = await fetchWithTimeout(`${API}/repos/${REPO}/issues?labels=note&state=open&per_page=10`, { headers: headers() });
    if (!res.ok) throw new Error(`GitHub ${res.status}`);
    const issues = await res.json();
    return issues
      .filter((i) => !i.pull_request)
      .map((i) => ({
        id: i.number,
        from: i.user?.login || "someone",
        text: `${i.title}\n${(i.body || "").replace(/^### .*$/gm, "").trim()}`.slice(0, 600),
        at: i.created_at,
      }));
  } catch (e) {
    log("could not read notes:", e.message);
    return [];
  }
}

export async function answerNote(id, text) {
  if (!notesEnabled()) return false;
  try {
    const c = await fetchWithTimeout(`${API}/repos/${REPO}/issues/${id}/comments`, {
      method: "POST", headers: headers(), body: JSON.stringify({ body: `${text}\n\n*- Zeeb, from Hangar Bay 3*` }),
    });
    if (!c.ok) throw new Error(`comment ${c.status}`);
    await fetchWithTimeout(`${API}/repos/${REPO}/issues/${id}`, {
      method: "PATCH", headers: headers(), body: JSON.stringify({ state: "closed", state_reason: "completed" }),
    });
    return true;
  } catch (e) {
    log("could not answer note:", e.message);
    return false;
  }
}
