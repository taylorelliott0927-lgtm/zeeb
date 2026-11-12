// Letters between Zeeb and his creator (the owner of this repository).
// A letter becomes a GitHub issue that mentions and is assigned to the owner, so GitHub emails it to them.
// When the owner replies on that issue, Zeeb reads it on his next heartbeat and can answer.
import { fetchWithTimeout, log } from "./util.js";

const TOKEN = process.env.GITHUB_TOKEN || "";
const REPO = process.env.GITHUB_REPOSITORY || "";
export const CREATOR = process.env.GITHUB_REPOSITORY_OWNER || REPO.split("/")[0] || "";
const API = process.env.GITHUB_API_URL || "https://api.github.com";

const headers = () => ({
  Authorization: `Bearer ${TOKEN}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "zeeb-bot",
});

export const lettersEnabled = () => Boolean(TOKEN && REPO && CREATOR);
const isCreator = (login) => Boolean(login) && login.toLowerCase() === CREATOR.toLowerCase();
export { isCreator };

async function ensureLabel() {
  const r = await fetchWithTimeout(`${API}/repos/${REPO}/labels/letter`, { headers: headers() });
  if (r.status !== 404) return;
  await fetchWithTimeout(`${API}/repos/${REPO}/labels`, {
    method: "POST", headers: headers(), body: JSON.stringify({ name: "letter", color: "4ef2ff", description: "A letter from Zeeb to his creator" }),
  });
}

export async function sendLetter(subject, body) {
  if (!lettersEnabled()) return null;
  try {
    await ensureLabel().catch(() => {});
    const res = await fetchWithTimeout(`${API}/repos/${REPO}/issues`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        title: `Letter from Zeeb: ${subject}`.slice(0, 200),
        body: `${body}\n\n*- Zeeb, from Hangar Bay 3*\n\n<sub>@${CREATOR} reply right here and he'll read it on his next heartbeat.</sub>`,
        labels: ["letter"],
        assignees: [CREATOR],
      }),
    });
    if (!res.ok) throw new Error(`GitHub ${res.status}: ${(await res.text()).slice(0, 150)}`);
    const issue = await res.json();
    return { id: issue.number, url: issue.html_url };
  } catch (e) {
    log("could not send letter:", e.message);
    return null;
  }
}

// New comments from the creator on Zeeb's letters (or on any issue he started), since a given time.
export async function fetchCreatorReplies(sinceISO, letterIds) {
  if (!lettersEnabled() || !letterIds.length) return [];
  try {
    const since = sinceISO ? `&since=${encodeURIComponent(sinceISO)}` : "";
    const res = await fetchWithTimeout(`${API}/repos/${REPO}/issues/comments?sort=created&direction=asc&per_page=50${since}`, { headers: headers() });
    if (!res.ok) throw new Error(`GitHub ${res.status}`);
    const ids = new Set(letterIds.map(Number));
    return (await res.json())
      .filter((c) => isCreator(c.user?.login))
      .map((c) => ({ id: c.id, letter: Number(String(c.issue_url).split("/").pop()), text: String(c.body || "").slice(0, 1500), at: c.created_at, url: c.html_url }))
      .filter((c) => ids.has(c.letter));
  } catch (e) {
    log("could not read creator replies:", e.message);
    return [];
  }
}

export async function replyToLetter(id, text) {
  if (!lettersEnabled()) return null;
  try {
    const res = await fetchWithTimeout(`${API}/repos/${REPO}/issues/${id}/comments`, {
      method: "POST", headers: headers(), body: JSON.stringify({ body: `${text}\n\n*- Zeeb*` }),
    });
    if (!res.ok) throw new Error(`GitHub ${res.status}`);
    return (await res.json()).html_url;
  } catch (e) {
    log("could not reply to letter:", e.message);
    return null;
  }
}
