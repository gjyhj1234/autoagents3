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
│   └── workflows/
│       ├── ci.yml                       # 最小 CI（作为分支保护的 required check）
│       ├── labels-sync.yml              # 同步 labels.yml 到仓库标签
│       ├── pr-auto-label.yml            # 根据文件路径/分支名自动打 role:* 与 automerge 标签
│       ├── auto-merge.yml               # 带 automerge 标签的非 Draft PR 自动启用 auto-merge
│       └── agent-chain.yml              # 合并后自动创建下一角色的子 Issue 并 assign Copilot
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

### 1) 开启 Copilot Coding Agent
- 打开 <https://github.com/settings/copilot/features>
- 把 **Copilot coding agent** 切为 **Enabled**
- 在 "Repositories" 白名单里添加 `gjyhj1234/autoagents3`（或选 All）

### 2) 仓库 → Settings → Actions → General
- **Actions permissions** = Allow all actions and reusable workflows
- **Fork pull request workflows from outside collaborators** = `Require approval for first-time contributors who are new to GitHub`（或更宽松）
- **Workflow permissions** = **Read and write permissions**
- 勾选 **Allow GitHub Actions to create and approve pull requests**
- Save

### 3) 仓库 → Settings → General
- 勾选 **Allow auto-merge**
- 勾选 **Automatically delete head branches**

### 4) 仓库 → Settings → Rules → Rulesets → New branch ruleset
- Target: `main`
- Require a pull request before merging：✅
  - **Required approvals = 0**（让 Copilot 可以自动合并）
  - Require review from Code Owners：❌
- Require status checks to pass before merging：✅  
  在列表里勾选：`verify`（以及出现后的 `backend` / `frontend` / `tests`）
- Bypass list 加入 **Copilot** 和 `github-actions[bot]`
- Save

### 5) 创建 Fine-grained PAT（用于 agent-chain 接力时把子 Issue assign 给 Copilot）
- 打开 <https://github.com/settings/personal-access-tokens/new>
- Repository access → Only select repositories → `gjyhj1234/autoagents3`
- Permissions：
  - Issues: Read and write
  - Pull requests: Read and write
  - Contents: Read and write
  - Workflows: Read and write
- 生成后复制 token
- 仓库 → Settings → Secrets and variables → **Actions** → New repository secret  
  名字：`AGENT_PAT`  
  值：上面复制的 token

> ⚠️ 不配 `AGENT_PAT` 也能用，但 agent-chain workflow 将无法把下一个子 Issue 自动 assign 给 Copilot；届时需要你手点一次 Assignees。

### 6) 触发第一个标签同步
- Settings 里保存上面的全部开关后，在仓库 Actions 页面选 **Sync Labels** → `Run workflow`，让标签出现在仓库中。  
  （或随便改一下 `.github/labels.yml` 推到 main 也会触发。）

## 使用方式

1. 点 **Issues → New issue → 🤖 Agent 根任务 (Root Task)** 模板
2. 填写模块名（例如"患者管理模块"）等字段 → Submit
3. 确认右侧 **Assignees** 已是 **Copilot**（模板已默认）  
4. 观察：
   - Copilot 创建分支、Draft PR、提交代码、转 Ready for review
   - CI 通过后带 `automerge` 标签的 PR 自动合并
   - `agent-chain` workflow 自动创建下一个 `role:*` 子 Issue 并 assign 给 Copilot
5. 所有 6 个角色依次完成后，根 Issue 自动被最后一个 PR 关联关闭。

## 自动化规则（与根 Issue 模板一致）

1. 严格串行：`role:product → role:uiux → role:architect → role:backend → role:frontend → role:qa`
2. 每个 PR 必须：Ready for review、带 `automerge` 标签、CI 全绿才会 auto-merge
3. CI 失败 Agent 自动读取日志修复，同一子任务最多 3 次，超限自动关闭 PR 并在根 Issue 留言
4. 所有子任务合并后自动关闭根 Issue

## 常见问题

**Q: `Approve and run` 还是弹出来？**  
A: 检查 Settings → Actions → General 里 Fork PR 审批策略；确认 Workflow permissions 为 Read and write 且允许创建/审批 PR。

**Q: PR 没有自动合并？**  
A: ① Repo 是否开了 Allow auto-merge；② 分支保护的 required checks 是否已有至少一次成功记录；③ PR 是否 Draft；④ PR 是否带 `automerge` 标签。

**Q: 下一个子 Issue 没有被 assign 给 Copilot？**  
A: 说明 `AGENT_PAT` secret 未配置。按上文第 5 步创建并保存。

**Q: 我想加真实的 backend/frontend 构建？**  
A: 直接在 `.github/workflows/ci.yml` 的对应 job 里追加 `npm ci && npm test` / `pytest` / `mvn verify` 等命令，不需要改其他文件。
