# 患者管理模块 — 架构设计、DB Schema 与接口定义

## 1. 技术选型

| 层次     | 技术                  |
|----------|-----------------------|
| 后端框架 | Python 3.11 + Flask   |
| 数据库   | SQLite（开发/测试）   |
| 前端     | HTML5 + CSS3 + 原生 JS |
| 测试     | pytest + requests     |

## 2. 系统架构

```
┌────────────────────────────────────────┐
│           Browser (Frontend)           │
│  HTML / CSS / JavaScript               │
└───────────────┬────────────────────────┘
                │  HTTP/JSON (REST)
┌───────────────▼────────────────────────┐
│           Flask REST API               │
│  /api/patients   CRUD endpoints        │
└───────────────┬────────────────────────┘
                │  SQLAlchemy ORM
┌───────────────▼────────────────────────┐
│           SQLite Database              │
│  patients table                        │
└────────────────────────────────────────┘
```

## 3. 数据库 Schema

### 3.1 `patients` 表

| 列名         | 类型         | 约束                              | 说明             |
|--------------|--------------|-----------------------------------|------------------|
| id           | INTEGER      | PRIMARY KEY AUTOINCREMENT         | 患者 ID          |
| name         | VARCHAR(100) | NOT NULL                          | 姓名             |
| gender       | VARCHAR(10)  | NOT NULL CHECK(gender IN ('男','女','其他')) | 性别   |
| birth_date   | DATE         | NOT NULL                          | 出生日期         |
| phone        | VARCHAR(20)  | NOT NULL                          | 联系电话         |
| id_card      | VARCHAR(18)  | UNIQUE                            | 身份证号（可空） |
| address      | TEXT         |                                   | 地址             |
| allergy      | TEXT         |                                   | 过敏史           |
| remark       | TEXT         |                                   | 备注             |
| is_deleted   | BOOLEAN      | NOT NULL DEFAULT 0                | 软删除标志       |
| created_at   | DATETIME     | NOT NULL DEFAULT CURRENT_TIMESTAMP| 创建时间         |
| updated_at   | DATETIME     | NOT NULL DEFAULT CURRENT_TIMESTAMP| 最后修改时间     |

### 3.2 索引

```sql
CREATE INDEX idx_patients_name       ON patients(name)       WHERE is_deleted = 0;
CREATE INDEX idx_patients_phone      ON patients(phone)      WHERE is_deleted = 0;
CREATE INDEX idx_patients_created_at ON patients(created_at) WHERE is_deleted = 0;
```

## 4. RESTful 接口定义

### 统一响应格式

```json
{
  "code": 0,        // 0 = 成功，非 0 = 业务错误
  "message": "ok",
  "data": { ... }   // 或 null
}
```

### 4.1 创建患者

```
POST /api/patients
Content-Type: application/json
```

**请求体**

```json
{
  "name":       "张三",
  "gender":     "男",
  "birth_date": "1990-05-20",
  "phone":      "13800001234",
  "id_card":    "110101199005200011",
  "address":    "北京市朝阳区",
  "allergy":    "青霉素",
  "remark":     ""
}
```

**响应 201**

```json
{ "code": 0, "message": "ok", "data": { "id": 1, ... } }
```

**响应 400**（校验失败）

```json
{ "code": 4001, "message": "手机号格式不正确", "data": null }
```

**响应 409**（身份证重复）

```json
{ "code": 4091, "message": "该身份证号已存在", "data": null }
```

---

### 4.2 查询患者列表

```
GET /api/patients?page=1&page_size=20&name=张&gender=男&phone=138
```

**查询参数**

| 参数      | 类型   | 必填 | 说明              |
|-----------|--------|------|-------------------|
| page      | int    | 否   | 页码，默认 1       |
| page_size | int    | 否   | 每页数量，默认 20  |
| name      | string | 否   | 姓名模糊搜索       |
| gender    | string | 否   | 性别精确筛选       |
| phone     | string | 否   | 手机号精确筛选     |

**响应 200**

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "total": 100,
    "page": 1,
    "page_size": 20,
    "items": [ { "id": 1, "name": "张三", ... }, ... ]
  }
}
```

---

### 4.3 获取患者详情

```
GET /api/patients/:id
```

**响应 200**

```json
{ "code": 0, "message": "ok", "data": { "id": 1, "name": "张三", ... } }
```

**响应 404**

```json
{ "code": 4041, "message": "患者不存在", "data": null }
```

---

### 4.4 修改患者信息

```
PUT /api/patients/:id
Content-Type: application/json
```

请求体同创建接口（所有字段可选，仅更新传入字段）。

**响应 200**

```json
{ "code": 0, "message": "ok", "data": { "id": 1, ... } }
```

---

### 4.5 删除患者（软删除）

```
DELETE /api/patients/:id
```

**响应 200**

```json
{ "code": 0, "message": "ok", "data": null }
```

## 5. 目录结构

```
backend/
├── app.py              # Flask 应用入口
├── models.py           # SQLAlchemy 模型
├── routes/
│   └── patients.py     # 患者 CRUD 路由
└── requirements.txt    # Python 依赖

frontend/
├── index.html          # 应用入口（SPA）
├── css/
│   └── style.css       # 样式
└── js/
    └── app.js          # 前端逻辑

tests/
└── test_patients.py    # API 集成测试
```
