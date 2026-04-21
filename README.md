# autoagents3

基于 **GitHub Copilot Coding Agent** 的多角色自动化开发脚手架。
目标：一个根 Issue → 自动拆分子任务 → 多角色 Agent 串行交付 → PR 自动合并 → 零人工干预。

## 目录结构

```
.
├── .github/
│   ├── labels.yml                       # 标签定义（由 labels-sync workflow 同步）
│   ├── CODEOWNERS
│   ├── PULL_REQUEST_TEMPLATE.md
│   ├── ISSUE_TEMPLATE/
│   │   ├── agent-root-task.yml          # 根任务模板（你只需要创建这一个）
│   │   └── agent-sub-task.yml           # 子任务模板（由协调者/workflow 自动创建）
│   ├── scripts/
│   │   ├── assign-copilot.mjs           # 原子操作：创建 Issue + GraphQL 指派 Copilot + 自检
│   │   └── healthcheck-chain.mjs        # 定时扫描 stuck 子 issue 并重试指派
│   └── workflows/
│       ├── ci.yml                       # 最小 CI（作为分支保护的 required check）
│       ├── labels-sync.yml              # 同步 labels.yml 到仓库标签
│       ├── pr-auto-label.yml            # 根据文件路径/分支名自动打 role:* 与 automerge 标签
│       ├── auto-merge.yml               # 带 automerge 标签的非 Draft PR 自动启用 auto-merge
│       ├── agent-bootstrap.yml          # root issue 一打开就自动创建首个 role:product 子 Issue
│       ├── agent-chain.yml              # 合并后自动创建下一角色的子 Issue 并 assign Copilot
│       └── agent-chain-healthcheck.yml  # 每 30 分钟兜底：卡住的子 Issue 自动重试指派
├── docs/
│   ├── requirements/                    # role:product 交付
│   ├── ui-design/                       # role:uiux     交付
│   └── architecture/                    # role:architect 交付
├── backend/                             # role:backend 交付
├── frontend/                            # role:frontend 交付
└── tests/                               # role:qa      交付
```

## 一次性配置清单（按顺序做）

> 全部在 Web 界面点几下即可，大约 5 分钟。

### 1) 开启 Copilot Coding Agent —— **账号级**
- 打开 <https://github.com/settings/copilot/features>
- 把 **Copilot coding agent** 切为 **Enabled**
- 在 "Repositories" 白名单里添加 `gjyhj1234/autoagents3`（或选 All）

### 2) 开启 Copilot Cloud Agent —— **仓库级**（必须，很多人漏这一步）
- 打开 **仓库 → Settings → Copilot → Cloud agent**
- 把开关切到 **Enabled**

> ⚠️ 只开"账号级"不够。仓库级没开时，GraphQL `repository.suggestedActors(capabilities:[CAN_BE_ASSIGNED])`
> 列表里根本不会出现 `copilot-swe-agent`，自动指派必然失败（workflow 会在 root issue
> 留言：`NO_SUGGESTED_COPILOT`）。

### 3) 仓库 → Settings → Actions → General
- **Actions permissions** = Allow all actions and reusable workflows
- **Workflow permissions** = **Read and write permissions**
- 勾选 **Allow GitHub Actions to create and approve pull requests**
- （可选）**Approval for running fork pull request workflows from contributors** = **Do not require approval**
  - 说明：新版 UI 里该选项就叫这个名字（老名字是 "Fork pull request workflows from outside collaborators"）。
  - 本仓库里 Copilot 直接在主仓库开 `copilot/...` 分支，**不是** fork PR，这个选项其实不影响本链路；
    如果你打算接受外部 fork PR 做联调再调成 Do not require approval 即可。
- Save

### 4) 仓库 → Settings → General
- 勾选 **Allow auto-merge**
- 勾选 **Automatically delete head branches**

### 5) 仓库 → Settings → Rules → Rulesets → New branch ruleset
- **Target: `Default`（即 `main`）** —— 只选 Default，**不要**选 All branches；
  否则 Copilot 开的 `copilot/...` 分支也会落进 ruleset，虽然 bypass 里有 Copilot 能绕过，但 required
  status checks 会在那些分支上"找不到"而永远 pending。
- Require a pull request before merging：✅
  - **Required approvals = 0**（让 Copilot 可以自动合并）
  - Require review from Code Owners：❌
- Require status checks to pass before merging：✅
  在列表里勾选：`verify`（以及出现后的 `backend` / `frontend` / `tests`）
- **Bypass list** 必须包含：
  - **Copilot cloud agent**（App）
  - **Copilot code review**（App）
  - `Repository admin` / `Maintain` / `Write`（可选，方便应急）
- Save

### 6) 创建 Fine-grained PAT（**必需** — 用于 bootstrap、agent-chain、healthcheck 把 sub issue assign 给 Copilot）

- 打开 <https://github.com/settings/personal-access-tokens/new>
- Repository access → Only select repositories → `gjyhj1234/autoagents3`
- Permissions（**必须**）：
  - **Metadata: Read**（fine-grained 默认就有，别手动取消）
  - **Issues: Read and write**
  - **Pull requests: Read and write**
  - **Contents: Read and write**
  - **Workflows: Read and write**
- 生成后复制 token
- 仓库 → Settings → Secrets and variables → **Actions** → New repository secret
  名字：`AGENT_PAT`
  值：上面复制的 token

> ⚠️ **没有 `AGENT_PAT` 整条链就停**：默认的 `GITHUB_TOKEN` 无法通过 GraphQL
> `replaceActorsForAssignable` 把 Issue 指派给 Copilot bot。
>
> ⚠️ **REST `assignees=["Copilot"]` 不工作**：Copilot 是 Bot actor（login
> `copilot-swe-agent`），REST issues API 只接受 User login，传 `"Copilot"` 会被
> GitHub 静默丢弃 —— Issue 创建成功但没有 assignee，链路就此卡死。本脚手架统一
> 走 GraphQL `suggestedActors` + `replaceActorsForAssignable`，并在每次指派后
> 回查 assignees 自检。

### 7) 触发第一个标签同步
- Settings 里保存上面的全部开关后，在仓库 Actions 页面选 **Sync Labels** → `Run workflow`，让标签出现在仓库中。
  （或随便改一下 `.github/labels.yml` 推到 main 也会触发。）

### 8) 端到端自检（推荐）
- 在 **Issues → New issue** 随便开一个 `agent-root` 打标签的测试 issue（模块名填"冒烟测试"），
  或
- 在 **Actions → Agent Bootstrap → Run workflow** 里手动触发（`workflow_dispatch`），传入已有的 root issue 号重放；
- 到对应的 run 日志里，确认：
  - `Found Copilot bot id: ...`
  - `assignees after mutation: ["copilot-swe-agent"]`
  - `✅ Copilot coding agent assigned to issue #N`
- UI 上子 Issue 的 Assignees 列应当显示 Copilot 头像，不久 Copilot 会自动在 Issue 下面留 "I'll start working on this..." 的评论并开 Draft PR。

## 使用方式

1. 点 **Issues → New issue → 🤖 Agent 根任务 (Root Task)** 模板
2. 填写模块名（例如"患者管理模块"）等字段 → Submit
3. **不需要做任何事** — 后续完全自动：
   - `agent-bootstrap` workflow 立刻创建首个 `role:product` 子 Issue 并通过 GraphQL 指派 Copilot
   - Copilot 在子 Issue 上自动开 Draft PR、提交代码、转 Ready for review
   - `pr-auto-label` 自动打 `role:*` + `automerge` 标签
   - CI 通过后 `auto-merge` 自动 squash-merge 并删分支
   - `agent-chain` 监听到合并事件，自动创建下一个 `role:*` 子 Issue 并指派 Copilot（标题中的模块名从 root issue 正文动态读取）
   - 6 个角色依次完成，最后一个 PR 合并后 root Issue 被自动关闭
   - 每 30 分钟 `agent-chain-healthcheck` 兜底扫描；若某个子 Issue 超过 30 分钟还没被 Copilot 接手，会自动重试指派，连续失败 3 次在 root Issue 留言告警

> 整个过程的进度可以通过 root Issue 的 timeline 评论实时查看（每次链条推进都会留言）。

## 自动化规则（与根 Issue 模板一致）

1. 严格串行：`role:product → role:uiux → role:architect → role:backend → role:frontend → role:qa`
2. 每个 PR 必须：Ready for review、带 `automerge` 标签、CI 全绿才会 auto-merge
3. CI 失败 Agent 自动读取日志修复，同一子任务最多 3 次，超限自动关闭 PR 并在根 Issue 留言
4. 所有子任务合并后自动关闭根 Issue

## 常见问题

**Q: 我所有开关都开了，`AGENT_PAT` 也配了，根 Issue 建完还是不动？**
A: 旧版脚手架用 REST `gh issue create --assignee Copilot` 指派 Bot，这个方式 GitHub 会**静默丢弃 assignee**，导致子 Issue 无 assignee、Copilot 永远不接手。升级到本仓库最新版的 workflow 即可（内部改用 GraphQL `suggestedActors` + `replaceActorsForAssignable` 并带自检）。同时请确认 **Settings → Copilot → Cloud agent**（仓库级）已 Enabled。

**Q: workflow 日志报 `NO_SUGGESTED_COPILOT`？**
A: `suggestedActors(capabilities:[CAN_BE_ASSIGNED])` 列表里找不到 `copilot-swe-agent`。常见原因：① 仓库级 Copilot Cloud Agent 未启用；② 账号级 Copilot coding agent 未启用；③ 本仓库不在白名单。按配置清单第 1/2 步检查即可。

**Q: workflow 日志报 `PAT_PERMISSION`？**
A: `AGENT_PAT` 权限不足。按第 6 步把 Metadata:Read、Issues:RW、Pull requests:RW、Contents:RW、Workflows:RW 全部勾上并确认已选中本仓库。

**Q: workflow 日志报 `BLOCKED_BY_POLICY`（mutation 成功但 assignees 为空）？**
A: Ruleset / 分支保护 / 组织安全策略把 Copilot 的写操作拦下了。确认 **Settings → Rules → Rulesets** 里该 ruleset 的 Bypass list 含 **Copilot cloud agent** App。

**Q: `Approve and run` 按钮还是弹出来？**
A: 检查 Settings → Actions → General 里：① Workflow permissions 是 **Read and write**；② 勾选了 **Allow GitHub Actions to create and approve pull requests**；③ 如果你确实在接受外部 fork PR，再把 "Approval for running fork pull request workflows from contributors" 调成 Do not require approval。

**Q: PR 没有自动合并？**
A: ① Repo 是否开了 Allow auto-merge；② 分支保护的 required checks 是否已有至少一次成功记录；③ PR 是否 Draft；④ PR 是否带 `automerge` 标签。

**Q: 添加 root Issue 后没有任何后续动作 / 没有自动开子 Issue？**
A: 99% 是 `AGENT_PAT` secret 没配或权限不对。请按上文第 6 步配置；也可以打开仓库 Actions → "Agent Bootstrap" workflow 的运行日志确认是否走了 fallback 分支。

**Q: 下一个子 Issue 没有被 assign 给 Copilot？**
A: 打开 Actions → "Agent Chain Healthcheck" → Run workflow，让兜底脚本重试。日志里会打印每个 stuck 子 Issue 的重试情况。若连续 3 次仍失败，healthcheck 会在 root Issue 留言告警。

**Q: 我想加真实的 backend/frontend 构建？**
A: 直接在 `.github/workflows/ci.yml` 的对应 job 里追加 `npm ci && npm test` / `pytest` / `mvn verify` 等命令，不需要改其他文件。
