#!/usr/bin/env node
/**
 * assign-copilot.mjs
 *
 * 原子化地「创建 Issue（或对一个已存在的 Issue）→ 通过 GraphQL 把 Copilot coding agent
 * 指派为 Assignee → 自检 assignees 是否真的包含 copilot-swe-agent」。
 *
 * 之所以必须走 GraphQL 而不是 `gh issue create --assignee "Copilot"` / REST `assignees`:
 *   - Copilot coding agent 是一个 Bot actor（login: `copilot-swe-agent`），
 *     REST `assignees` 只接受 User，传 "Copilot" 会被 GitHub 静默丢弃，
 *     导致 Issue 建成但无 assignee，Copilot 永远不会接手，链路卡死。
 *   - 官方唯一被保证工作的姿势是：
 *       1) repository.suggestedActors(capabilities:[CAN_BE_ASSIGNED]) 拿 Bot.id
 *       2) replaceActorsForAssignable(assignableId, actorIds:[botId])
 *
 * 用法（作为 workflow step 运行，由环境变量驱动）：
 *   必填：
 *     GH_TOKEN          优先使用的 token（建议传 AGENT_PAT；至少需要 Issues:RW + Metadata:R）
 *     REPO              owner/repo
 *     ISSUE_TITLE       新建 Issue 的标题（当 EXISTING_ISSUE_NUMBER 为空时使用）
 *     ISSUE_BODY        新建 Issue 的 body
 *     ISSUE_LABELS      逗号分隔的 label 列表，例如 "agent-task,agent-sub,role:product"
 *   可选：
 *     EXISTING_ISSUE_NUMBER  若设置，则跳过创建步骤，直接对该 issue 执行指派
 *     ROOT_ISSUE_NUMBER      出错时要留言告警的 root issue 号（没有则跳过留言）
 *     ROOT_COMMENT_PREFIX    留言前缀，用于区分触发来源
 *
 * 输出（通过 $GITHUB_OUTPUT）：
 *   issue_number, issue_node_id, assigned(=true|false), failure_reason
 *
 * 失败时以 exit 1 退出，并尽量区分 3 种根因写入 failure_reason：
 *   - NO_SUGGESTED_COPILOT  仓库级 Copilot Cloud Agent 未启用（suggestedActors 里没有 copilot-swe-agent）
 *   - PAT_PERMISSION        GraphQL mutation 返回 401/403 或 INSUFFICIENT_SCOPES
 *   - BLOCKED_BY_POLICY     mutation 成功但回查 assignees 里没有 copilot-swe-agent（多半 ruleset/安全策略拦下）
 *   - UNKNOWN               其它异常
 */

import { appendFileSync } from 'node:fs';

const COPILOT_LOGIN = 'copilot-swe-agent';
const GH_API = 'https://api.github.com';

function env(name, { required = false, fallback = '' } = {}) {
  const v = process.env[name];
  if (required && (!v || v.trim() === '')) {
    throw new Error(`Missing required env: ${name}`);
  }
  return v ?? fallback;
}

function setOutput(key, value) {
  const f = process.env.GITHUB_OUTPUT;
  if (!f) return;
  const v = String(value).includes('\n')
    ? `${key}<<__EOF__\n${value}\n__EOF__\n`
    : `${key}=${value}\n`;
  appendFileSync(f, v);
}

function logError(msg) {
  // GitHub Actions error annotation
  console.log(`::error::${msg}`);
}

function logWarning(msg) {
  console.log(`::warning::${msg}`);
}

async function gh(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(`${GH_API}${path}`, {
    method,
    headers: {
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'user-agent': 'autoagents3-assign-copilot',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  return { ok: res.ok, status: res.status, data };
}

async function gql(query, variables, token) {
  const res = await fetch(`${GH_API}/graphql`, {
    method: 'POST',
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'user-agent': 'autoagents3-assign-copilot',
    },
    body: JSON.stringify({ query, variables }),
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  return { ok: res.ok, status: res.status, data };
}

async function commentOnRoot(token, repo, rootNumber, message) {
  if (!rootNumber) return;
  const [owner, name] = repo.split('/');
  try {
    await gh(`/repos/${owner}/${name}/issues/${rootNumber}/comments`, {
      method: 'POST',
      token,
      body: { body: message },
    });
  } catch (e) {
    logWarning(`Failed to comment on root issue #${rootNumber}: ${e.message}`);
  }
}

async function main() {
  const token = env('GH_TOKEN', { required: true });
  const repo = env('REPO', { required: true });
  const [owner, name] = repo.split('/');
  if (!owner || !name) throw new Error(`Invalid REPO: ${repo}`);

  const rootNumber = env('ROOT_ISSUE_NUMBER');
  const rootPrefix = env('ROOT_COMMENT_PREFIX', { fallback: '' });

  // --- Step 1: create or load the issue --------------------------------------
  let issueNumber, issueNodeId;
  const existing = env('EXISTING_ISSUE_NUMBER');
  if (existing) {
    const r = await gh(`/repos/${owner}/${name}/issues/${existing}`, { token });
    if (!r.ok) {
      throw new Error(`Failed to fetch existing issue #${existing}: ${r.status} ${JSON.stringify(r.data)}`);
    }
    issueNumber = r.data.number;
    issueNodeId = r.data.node_id;
  } else {
    const title = env('ISSUE_TITLE', { required: true });
    const body = env('ISSUE_BODY', { fallback: '' });
    const labels = env('ISSUE_LABELS', { fallback: '' })
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const r = await gh(`/repos/${owner}/${name}/issues`, {
      method: 'POST',
      token,
      body: { title, body, labels },
    });
    if (!r.ok) {
      throw new Error(`Failed to create issue: ${r.status} ${JSON.stringify(r.data)}`);
    }
    issueNumber = r.data.number;
    issueNodeId = r.data.node_id;
  }
  console.log(`Issue #${issueNumber} (node_id=${issueNodeId}) ready.`);
  setOutput('issue_number', String(issueNumber));
  setOutput('issue_node_id', issueNodeId);

  // --- Step 2: look up Copilot Bot id via suggestedActors --------------------
  const suggestedQuery = `
    query($owner:String!,$name:String!){
      repository(owner:$owner,name:$name){
        suggestedActors(capabilities:[CAN_BE_ASSIGNED], first:100){
          nodes{
            __typename
            login
            ... on Bot { id }
            ... on User { id }
          }
        }
      }
    }`;
  const sug = await gql(suggestedQuery, { owner, name }, token);
  if (!sug.ok || sug.data.errors) {
    const reason = describeGraphqlError(sug);
    await failWith({
      token,
      repo,
      rootNumber,
      rootPrefix,
      issueNumber,
      reason,
      message: `suggestedActors query failed: ${JSON.stringify(sug.data)}`,
    });
    return;
  }
  const nodes = sug.data?.data?.repository?.suggestedActors?.nodes || [];
  const copilot = nodes.find((n) => n && n.login === COPILOT_LOGIN);
  if (!copilot || !copilot.id) {
    await failWith({
      token,
      repo,
      rootNumber,
      rootPrefix,
      issueNumber,
      reason: 'NO_SUGGESTED_COPILOT',
      message:
        `suggestedActors 列表中没有 "${COPILOT_LOGIN}"。最常见原因：` +
        `仓库级 Settings → Copilot → Cloud agent 未启用，或账号级 Copilot coding agent 未启用，` +
        `或该仓库不在 Copilot coding agent 的仓库白名单内。`,
    });
    return;
  }
  console.log(`Found Copilot bot id: ${copilot.id}`);

  // --- Step 3: replaceActorsForAssignable -----------------------------------
  const mutation = `
    mutation($assignableId:ID!,$actorIds:[ID!]!){
      replaceActorsForAssignable(input:{assignableId:$assignableId, actorIds:$actorIds}){
        assignable{
          ... on Issue {
            number
            assignees(first:10){ nodes{ login } }
          }
        }
      }
    }`;
  const mut = await gql(
    mutation,
    { assignableId: issueNodeId, actorIds: [copilot.id] },
    token,
  );
  if (!mut.ok || mut.data.errors) {
    const reason = describeGraphqlError(mut);
    await failWith({
      token,
      repo,
      rootNumber,
      rootPrefix,
      issueNumber,
      reason,
      message: `replaceActorsForAssignable failed: ${JSON.stringify(mut.data)}`,
    });
    return;
  }

  // --- Step 4: self-check ----------------------------------------------------
  const verifyQuery = `
    query($owner:String!,$name:String!,$number:Int!){
      repository(owner:$owner,name:$name){
        issue(number:$number){
          assignees(first:10){ nodes{ login } }
        }
      }
    }`;
  const ver = await gql(verifyQuery, { owner, name, number: issueNumber }, token);
  const assignees =
    ver.data?.data?.repository?.issue?.assignees?.nodes?.map((n) => n.login) || [];
  console.log(`assignees after mutation: ${JSON.stringify(assignees)}`);
  setOutput('assignees', assignees.join(','));

  if (!assignees.includes(COPILOT_LOGIN)) {
    await failWith({
      token,
      repo,
      rootNumber,
      rootPrefix,
      issueNumber,
      reason: 'BLOCKED_BY_POLICY',
      message:
        `replaceActorsForAssignable 调用已成功，但回查 assignees=${JSON.stringify(
          assignees,
        )} 里没有 ${COPILOT_LOGIN}。常见原因：仓库的 Ruleset / 分支保护 / 组织级安全策略把 Copilot 的写操作拦下。`,
    });
    return;
  }

  setOutput('assigned', 'true');
  setOutput('failure_reason', '');
  console.log(`✅ Copilot coding agent assigned to issue #${issueNumber}.`);
}

function describeGraphqlError(resp) {
  if (resp.status === 401 || resp.status === 403) return 'PAT_PERMISSION';
  const msg = JSON.stringify(resp.data || {});
  if (
    /INSUFFICIENT_SCOPES|insufficient_scopes|Resource not accessible|Must have admin|not authorized/i.test(
      msg,
    )
  ) {
    return 'PAT_PERMISSION';
  }
  return 'UNKNOWN';
}

async function failWith({ token, repo, rootNumber, rootPrefix, issueNumber, reason, message }) {
  setOutput('assigned', 'false');
  setOutput('failure_reason', reason);
  logError(`[${reason}] ${message}`);
  const hint =
    reason === 'NO_SUGGESTED_COPILOT'
      ? '请启用 Settings → Copilot → Cloud agent（仓库级），并确认账号级 Copilot coding agent 已开启且本仓库在白名单。'
      : reason === 'PAT_PERMISSION'
        ? '请检查 AGENT_PAT 是否具备 Issues: Read & Write、Pull requests: Read & Write、Contents: Read & Write、Metadata: Read（Workflows: Read & Write 若涉及跨 workflow 场景）。'
        : reason === 'BLOCKED_BY_POLICY'
          ? '请检查仓库 Ruleset / 分支保护的 Bypass list 是否包含「Copilot cloud agent」App。'
          : '请查看本 workflow run 的日志定位原因。';
  const body =
    `${rootPrefix ? rootPrefix + ' ' : ''}` +
    `⚠️ 自动指派 Copilot 失败（issue #${issueNumber}，原因：\`${reason}\`）。\n\n` +
    `${message}\n\n👉 ${hint}\n\n` +
    `（修复后可在 Actions 里手动 re-run 对应 workflow，或触发 \`Agent Chain Healthcheck\` workflow 重试。）`;
  await commentOnRoot(token, repo, rootNumber, body);
  process.exit(1);
}

main().catch((e) => {
  logError(`assign-copilot.mjs crashed: ${e.stack || e.message}`);
  setOutput('assigned', 'false');
  setOutput('failure_reason', 'UNKNOWN');
  process.exit(1);
});
