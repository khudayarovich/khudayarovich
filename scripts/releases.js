/**
 * Rewrites the "Latest releases" block in README.md from what GitHub actually
 * published.
 *
 * Self-hosted on purpose. The hosted card services this kind of profile
 * usually leans on answer 503 or 402 often enough that a profile built on
 * them shows broken images within weeks; this asks the API the profile owner
 * already has a token for, and commits plain markdown that cannot break.
 */
const fs = require("fs");

const USER = process.env.PROFILE_USER || "khudayarovich";
const TOKEN = process.env.GITHUB_TOKEN;
const LIMIT = Number(process.env.RELEASE_LIMIT || 5);
const START = "<!-- RELEASES:START -->";
const END = "<!-- RELEASES:END -->";

const api = async (path) => {
  const res = await fetch("https://api.github.com" + path, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": USER + "-profile",
      ...(TOKEN ? { Authorization: "token " + TOKEN } : {}),
    },
  });
  if (!res.ok) throw new Error(path + " → HTTP " + res.status);
  return res.json();
};

const ago = (iso) => {
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return days + " days ago";
  const months = Math.floor(days / 30);
  return months === 1 ? "last month" : months + " months ago";
};

/** The asset a person on this platform actually wants. */
const pickAssets = (assets) => {
  const win = assets.find((a) => /\.exe$/i.test(a.name));
  const mac = assets.find((a) => /arm64\.dmg$/i.test(a.name)) || assets.find((a) => /\.dmg$/i.test(a.name));
  const out = [];
  if (win) out.push(`[Windows](${win.browser_download_url})`);
  if (mac) out.push(`[macOS](${mac.browser_download_url})`);
  return out.join(" · ");
};

(async () => {
  const repos = await api(`/users/${USER}/repos?per_page=100&sort=pushed`);
  const releases = [];

  for (const repo of repos) {
    if (repo.fork || repo.archived) continue;
    let list = [];
    try {
      list = await api(`/repos/${USER}/${repo.name}/releases?per_page=5`);
    } catch {
      continue; // a repo without releases is not an error worth failing on
    }
    for (const r of list) {
      if (r.draft) continue;
      releases.push({
        repo: repo.name,
        name: r.name || r.tag_name,
        tag: r.tag_name,
        url: r.html_url,
        at: r.published_at || r.created_at,
        prerelease: r.prerelease,
        downloads: (r.assets || []).reduce((n, a) => n + a.download_count, 0),
        links: pickAssets(r.assets || []),
      });
    }
  }

  // One row per project: five rows of the same repository is a changelog,
  // not a feed, and a profile wants the second thing.
  releases.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const seen = new Set();
  const latest = releases.filter((r) => !seen.has(r.repo) && seen.add(r.repo)).slice(0, LIMIT);

  let block;
  if (latest.length === 0) {
    block = "_No releases published yet._";
  } else {
    block = [
      "| Project | Latest release | Published | Download |",
      "| --- | --- | --- | --- |",
      ...latest.map(
        (r) =>
          `| [${r.repo}](https://github.com/${USER}/${r.repo}) | [${r.name}](${r.url})${
            r.prerelease ? " _(pre-release)_" : ""
          } | ${ago(r.at)} | ${r.links || "—"} |`
      ),
    ].join("\n");
  }

  const readme = fs.readFileSync("README.md", "utf8");
  const s = readme.indexOf(START);
  const e = readme.indexOf(END);
  if (s < 0 || e < 0) throw new Error("release markers missing from README.md");

  const next = readme.slice(0, s + START.length) + "\n\n" + block + "\n\n" + readme.slice(e);
  if (next === readme) {
    console.log("no change");
    return;
  }
  fs.writeFileSync("README.md", next);
  console.log("updated with", latest.length, "release(s)");
})().catch((e) => {
  console.error("failed:", e.message);
  process.exit(1);
});
