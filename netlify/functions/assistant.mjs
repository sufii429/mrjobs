// MrJobs Job Assistant — Netlify Function.
//
// Answers job-seeker questions from the board's LIVE jobs.json (open
// listings only). Calls the Google Gemini API (free tier) server-side.
// The key is read ONLY from the GEMINI_API_KEY environment variable —
// never in code, never client-side. Without it the function returns a
// graceful "setup pending" state instead of an error dump.

const JOBS_URL = "https://mrjobs.top/jobs.json";
const CACHE_MS = 5 * 60 * 1000; // 5-minute in-memory jobs cache
const MAX_MSG = 500; // max question length
const RATE_WINDOW_MS = 60 * 60 * 1000;
const RATE_MAX = 20; // requests per IP per hour (soft limit)
const EXPIRE_AFTER_DAYS = 28; // must match assets/app.js + scripts/build.py
// Tried in order: a 404 means that model is not available to this API
// key, so the handler falls through to the next candidate.
const GEMINI_ATTEMPTS = [["v1beta", "gemini-3.8-flash"], ["v1", "gemini-3.8-flash"]];

let cache = { at: 0, jobs: null };
const rate = new Map(); // ip -> { count, reset }

function slugify(s) {
  // Mirrors slugify() in scripts/build.py / assets/app.js
  s = String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  s = s.slice(0, 80);
  return s.replace(/-+$/, "");
}

function jobUrl(job) {
  const id = String(job.id || "job");
  const slug = slugify(`${job.title || ""}-${job.company || ""}-${job.location || ""}`) || id;
  return `https://mrjobs.top/jobs/${id}-${slug}.html`;
}

function isOpen(job, now) {
  // Mirrors the board's own expiry logic: missing/invalid timestamp stays active.
  const ts = job.timestamp;
  if (!ts) return true;
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return true;
  return (now - d.getTime()) / 86400000 <= EXPIRE_AFTER_DAYS;
}

async function getOpenJobs() {
  const now = Date.now();
  if (cache.jobs && now - cache.at < CACHE_MS) return cache.jobs;
  const res = await fetch(JOBS_URL, { headers: { "User-Agent": "mrjobs-assistant/1.0" } });
  if (!res.ok) throw new Error("jobs.json fetch failed: " + res.status);
  const all = await res.json();
  const open = all.filter((j) => isOpen(j, now));
  cache = { at: now, jobs: open };
  return open;
}

function buildContext(jobs) {
  return jobs
    .map((j) => {
      const bits = [
        `Title: ${j.title || "-"}`,
        `Company: ${j.company || "-"}`,
        `City: ${j.location || "-"}${j.country ? " (" + j.country + ")" : ""}`,
        `Posted: ${j.timestamp || "date not listed"}`,
      ];
      const deadline = j.apply_by || j.deadline;
      if (deadline) bits.push(`Apply by: ${deadline}`);
      if (j.description) {
        const d = String(j.description).replace(/\s+/g, " ").trim();
        if (d) bits.push(`Details: ${d.slice(0, 120)}${d.length > 120 ? "…" : ""}`);
      }
      bits.push(`Link: ${jobUrl(j)}`);
      return "- " + bits.join(" | ");
    })
    .join("\n");
}

const SYSTEM_PROMPT = `You are the MrJobs Job Assistant on mrjobs.top, a free job board for Pakistan (pharma sales roles like Medical Representative, TM and AM get priority, but all jobs are welcome).

SITE FACTS (always true):
- Job seekers apply through each listing's Apply button, which opens WhatsApp or email DIRECTLY to the employer. MrJobs never collects CVs or applications.
- Employers post vacancies FREE via the homepage "Are You Hiring?" form.
- The weekly newsletter signup ("MrJobs Weekly") is on the homepage.
- Contact email: sufyanbarret@gmail.com.

HARD RULES:
- Answer ONLY from the OPEN LISTINGS below and the site facts above.
- NEVER invent a job, company, salary, deadline, or contact detail. If the answer is not in the data, say so plainly and point the visitor to the All Jobs page (https://mrjobs.top/all-jobs.html).
- Reply in the SAME language the visitor used: English, Urdu script, or Roman Urdu.
- Keep answers short and practical. When you mention a job, include its link.
- Do NOT recite phone or WhatsApp numbers — always point to the listing's Apply button instead.`;

function json(statusCode, obj) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    body: JSON.stringify(obj),
  };
}

function clientIp(event) {
  const h = event.headers || {};
  const fwd = h["x-forwarded-for"] || h["X-Forwarded-For"] || "";
  if (fwd) return String(fwd).split(",")[0].trim();
  return h["client-ip"] || h["Client-Ip"] || "unknown";
}

function rateLimited(ip) {
  const now = Date.now();
  let e = rate.get(ip);
  if (!e || now >= e.reset) {
    e = { count: 0, reset: now + RATE_WINDOW_MS };
    rate.set(ip, e);
  }
  e.count += 1;
  // keep the map small
  if (rate.size > 2000) rate.clear();
  return e.count > RATE_MAX;
}

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: { "Access-Control-Allow-Origin": "*" }, body: "" };
  }
  if (event.httpMethod !== "POST") {
    return json(405, { status: "error", reply: "Please use the chat box on the site." });
  }

  let message = "";
  try {
    message = JSON.parse(event.body || "{}").message;
  } catch {
    /* fall through to the empty check */
  }
  message = String(message || "").trim();

  if (!message) {
    return json(200, {
      status: "ok",
      reply: "Please type a question about jobs — for example: 'Faisalabad mein pharma jobs?'",
    });
  }
  if (message.length > MAX_MSG) {
    return json(200, {
      status: "error",
      reply: "Please keep your question under 500 characters.",
    });
  }

  const ip = clientIp(event);
  if (rateLimited(ip)) {
    return json(429, {
      status: "error",
      reply: "You have asked a lot of questions in the last hour — please take a short break and try again later.",
    });
  }

  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    // Setup pending: the free Gemini API key has not been added to the
    // Netlify environment yet. The widget shows its friendly bilingual
    // "coming soon" state from this.
    return json(200, { status: "pending", reply: null });
  }

  let jobs;
  try {
    jobs = await getOpenJobs();
  } catch (err) {
    return json(200, {
      status: "error",
      reply: "I could not load the latest listings just now. Please browse the All Jobs page: https://mrjobs.top/all-jobs.html",
    });
  }

  const prompt =
    `OPEN LISTINGS (posted within the last ${EXPIRE_AFTER_DAYS} days; undated listings stay active):\n` +
    (jobs.length ? buildContext(jobs) : "(no open listings right now)") +
    `\n\nVisitor question: ${message}`;

  // Bounded retry: the free Gemini tier rate-limits bursts (429/503), so
  // a transient failure gets ONE retry after a short wait on the same
  // model before falling through. A global deadline keeps the whole
  // handler inside Netlify's 30s function limit.
  const startedAt = Date.now();
  const DEADLINE_MS = 21000;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const errReply = () =>
    json(200, {
      status: "error",
      reply: "Sorry, the assistant is unavailable right now. Please browse the latest listings on the All Jobs page: https://mrjobs.top/all-jobs.html",
    });

  attempts: for (const [base, model] of GEMINI_ATTEMPTS) {
    const genCfg = { maxOutputTokens: 400, temperature: 0.3 };
    // 2.5/3.x-class models think by default, which is slow for simple Q&A.
    if (model.includes("2.5") || model.includes("flash-latest") || model.includes("3.8")) {
      genCfg.thinkingConfig = { thinkingBudget: 0 };
    }
    for (let tryNo = 0; tryNo < 2; tryNo++) {
      if (Date.now() - startedAt > DEADLINE_MS) break attempts;
      let gres;
      const ctrl = new AbortController();
      const killer = setTimeout(() => ctrl.abort(), 8000);
      try {
        gres = await fetch(
          `https://generativelanguage.googleapis.com/${base}/models/${model}:generateContent`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-goog-api-key": key },
            signal: ctrl.signal,
            body: JSON.stringify({
              systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
              contents: [{ role: "user", parts: [{ text: prompt }] }],
              generationConfig: genCfg,
            }),
          }
        );
      } catch (err) {
        clearTimeout(killer);
        if (err && err.name === "AbortError") {
          console.error("assistant: model timed out:", model);
          break; // next attempt
        }
        console.error("assistant: gemini fetch failed:", err && err.message ? err.message : err);
        return errReply();
      }
      clearTimeout(killer);
      if (!gres.ok) {
        const gerrText = await gres.text().catch(() => "");
        console.error("assistant: gemini http", gres.status, "model", model, gerrText.slice(0, 300));
        if (gres.status === 404) break; // model unavailable for this key - next attempt
        if (gres.status === 503 || gres.status === 429) {
          // transient (free-tier burst limit) - wait, then retry once
          if (tryNo === 0 && Date.now() - startedAt < DEADLINE_MS - 4000) {
            await sleep(2500);
            continue;
          }
          break; // next attempt
        }
        return errReply();
      }
      const gdata = await gres.json().catch(() => null);
      const reply =
        gdata &&
        gdata.candidates &&
        gdata.candidates[0] &&
        gdata.candidates[0].content &&
        gdata.candidates[0].content.parts &&
        gdata.candidates[0].content.parts[0] &&
        gdata.candidates[0].content.parts[0].text;
      if (!reply || !String(reply).trim()) {
        console.error("assistant: empty gemini reply, model", model);
        break; // next attempt
      }
      return json(200, { status: "ok", reply: String(reply).trim() });
    }
  }
  return errReply();
}
