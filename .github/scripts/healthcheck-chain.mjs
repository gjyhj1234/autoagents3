#!/usr/bin/env node
/**
 * healthcheck-chain.mjs
 *
 * 扫描 open 的 `agent-sub` issue：
 *   - 若 assignees 里没有 copilot-swe-agent
 *   - 且 issue 创建时间已超过 STUCK_MINUTES（默认 30 分钟）
 * 则调用 assign-copilot.mjs 对该 issue 重新尝试 GraphQL 指派。
 *
 * 在 issue body 里用隐形标记 `<!-- healthcheck-retries:N -->` 维护重试计数，
 * 连续失败 MAX_RETRIES（默认 3）次后在关联 root issue 留言告警。
 *
 * 环境变量：
 *   GH_TOKEN / AGENT_PAT (至少一个；GraphQL 指派需要 AGENT_PAT)
 *   REPO (owner/repo)
 *   STUCK_MINUTES (可选，默认 30)
 *   MAX_RETRIES   (可选，默认 3)
 */

import { spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';

const REPO = mustEnv('REPO');
const [OWNER, NAME] = REPO.split('/');
const PAT = process.env.AGENT_PAT || '';
const TOKEN = PAT || mustEnv('GH_TOKEN');
const STUCK_MINUTES = parseInt(process.env.STUCK_MINUTES || '30', 10);
const MAX_RETRIES = parseInt(process.env.MAX_RETRIES || '3', 10);
const COPILOT_LOGIN = 'copilot-swe-agent';
const GH_API = 'https://api.github.com';
const RETRIES_RE = /<!--\s*healthcheck-retries:(\d+)\s*-->/;

function mustEnv(n) {
  const v = process.env[n];
  if (!v) throw new Error(`Missing env ${n}`);
  return v;
}

async function gh(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${GH_API}${path}`, {
    method,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${TOKEN}`,
      'content-type': 'application/json',
      'user-agent': 'autoagents3-healthcheck',
      'x-github-api-version': '2022-11-28',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  return { ok: res.ok, status: res.status, data };
}

async function listOpenSubIssues() {
  const out = [];
  let page = 1;
  for (;;) {
    const r = await gh(
      `/repos/${OWNER}/${NAME}/issues?state=open&labels=agent-sub&per_page=100&page=${page}`,
    );
    if (!r.ok) throw new Error(`list issues failed: ${r.status} ${JSON.stringify(r.data)}`);
    const items = r.data.filter((i) => !i.pull_request);
    out.push(...items);
    if (items.length < 100) break;
    page += 1;
    if (page > 10) break;
  }
  return out;
}

function ageMinutes(iso) {
  return (Date.now() - new Date(iso).getTime()) / 60000;
}

function parseRetries(body) {
  const m = (body || '').match(RETRIES_RE);
  return m ? parseInt(m[1], 10) : 0;
}

function bumpRetriesInBody(body, n) {
  const marker = `<!-- healthcheck-retries:${n} -->`;
  if (RETRIES_RE.test(body)) return body.replace(RETRIES_RE, marker);
  return `${body || ''}\n${marker}\n`;
}

async function findRootNumber(issue) {
  // 1) try to parse from body "root #N" / "#N"
  const m = (issue.body || '').match(/root[^#]*#(\d+)/i);
  if (m) return m[1];
  // 2) fallback: single open agent-root
  const r = await gh(`/repos/${OWNER}/${NAME}/issues?state=open&labels=agent-root&per_page=1`);
  if (r.ok && Array.isArray(r.data) && r.data.length) return String(r.data[0].number);
  return '';
}

async function commentOnRoot(rootNumber, body) {
  if (!rootNumber) return;
  await gh(`/repos/${OWNER}/${NAME}/issues/${rootNumber}/comments`, {
    method: 'POST',
    body: { body },
  });
}

async function updateIssueBody(number, body) {
  await gh(`/repos/${OWNER}/${NAME}/issues/${number}`, {
    method: 'PATCH',
    body: { body },
  });
}

function runAssignScript(issueNumber, rootNumber) {
  const res = spawnSync(
    process.execPath,
    ['.github/scripts/assign-copilot.mjs'],
    {
      env: {
        ...process.env,
        GH_TOKEN: PAT || TOKEN,
        REPO,
        EXISTING_ISSUE_NUMBER: String(issueNumber),
        ROOT_ISSUE_NUMBER: rootNumber || '',
        ROOT_COMMENT_PREFIX: '[healthcheck]',
        // Script uses REST POST /issues only when EXISTING_ISSUE_NUMBER is empty,
        // so no ISSUE_TITLE/ISSUE_BODY/ISSUE_LABELS needed here.
      },
      stdio: 'inherit',
    },
  );
  return res.status === 0;
}

function setSummary(line) {
  const f = process.env.GITHUB_STEP_SUMMARY;
  if (f) appendFileSync(f, line + '\n');
  console.log(line);
}

async function main() {
  const issues = await listOpenSubIssues();
  setSummary(`🔎 Scanning ${issues.length} open agent-sub issue(s)...`);
  let retried = 0, skipped = 0, alerted = 0, healthy = 0;

  for (const issue of issues) {
    const assignees = (issue.assignees || []).map((a) => a.login);
    if (assignees.includes(COPILOT_LOGIN)) {
      healthy += 1;
      continue;
    }
    const age = ageMinutes(issue.created_at);
    if (age < STUCK_MINUTES) {
      skipped += 1;
      continue;
    }
    if (!PAT) {
      setSummary(`- #${issue.number}: stuck ${age.toFixed(0)}min, no AGENT_PAT → cannot retry`);
      continue;
    }

    const retries = parseRetries(issue.body);
    if (retries >= MAX_RETRIES) {
      // Already exceeded; alert once (dedup via marker bump to sentinel value)
      if (!/healthcheck-alerted/.test(issue.body || '')) {
        const root = await findRootNumber(issue);
        await commentOnRoot(
          root,
          `🚨 healthcheck：子 issue #${issue.number} 连续 ${MAX_RETRIES} 次自动指派 Copilot 失败，` +
            `请人工检查（仓库级 Copilot Cloud Agent 是否启用 / AGENT_PAT 权限是否足够 / Ruleset bypass 是否包含 Copilot cloud agent）。`,
        );
        const newBody = (issue.body || '') + `\n<!-- healthcheck-alerted -->\n`;
        await updateIssueBody(issue.number, newBody);
        alerted += 1;
      }
      continue;
    }

    const rootNumber = await findRootNumber(issue);
    setSummary(`- #${issue.number}: stuck ${age.toFixed(0)}min, retry ${retries + 1}/${MAX_RETRIES}`);
    const ok = runAssignScript(issue.number, rootNumber);
    const nextRetries = ok ? 0 : retries + 1;
    const newBody = bumpRetriesInBody(issue.body || '', nextRetries);
    try { await updateIssueBody(issue.number, newBody); } catch (e) {
      console.log(`::warning::failed to update retry counter on #${issue.number}: ${e.message}`);
    }
    retried += 1;
  }

  setSummary(`✅ healthy=${healthy} 🔁 retried=${retried} ⏳ skipped=${skipped} 🚨 alerted=${alerted}`);
}

main().catch((e) => {
  console.log(`::error::healthcheck crashed: ${e.stack || e.message}`);
  process.exit(1);
});
