"""
患者管理 API 集成测试
运行方式：
  cd /path/to/repo
  pip install flask flask-sqlalchemy pytest
  pytest tests/test_patients.py -v
"""
import sys
import os
import json
import pytest

# 将 backend 目录加入 path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

from app import create_app
from models import db as _db


# ─── Fixtures ─────────────────────────────────────────────────────────────────

@pytest.fixture()
def app():
    """每个测试用内存 SQLite，互相隔离。"""
    application = create_app(db_uri="sqlite:///:memory:")
    application.config["TESTING"] = True
    yield application


@pytest.fixture()
def client(app):
    return app.test_client()


def post_patient(client, overrides=None):
    """辅助函数：新增一个合法患者，支持覆盖字段。"""
    data = {
        "name": "张三",
        "gender": "男",
        "birth_date": "1990-05-20",
        "phone": "13800001234",
        "id_card": "110101199005200011",
        "address": "北京市朝阳区",
        "allergy": "青霉素",
        "remark": "无",
    }
    if overrides:
        data.update(overrides)
    return client.post("/api/patients", json=data)


# ─── 创建患者 ──────────────────────────────────────────────────────────────────

class TestCreatePatient:
    def test_create_success(self, client):
        r = post_patient(client)
        assert r.status_code == 201
        body = r.get_json()
        assert body["code"] == 0
        assert body["data"]["name"] == "张三"
        assert body["data"]["id"] is not None

    def test_missing_name(self, client):
        r = post_patient(client, {"name": ""})
        assert r.status_code == 400
        assert r.get_json()["code"] != 0

    def test_invalid_gender(self, client):
        r = post_patient(client, {"gender": "未知"})
        assert r.status_code == 400

    def test_invalid_phone(self, client):
        r = post_patient(client, {"phone": "123"})
        assert r.status_code == 400

    def test_invalid_birth_date(self, client):
        r = post_patient(client, {"birth_date": "not-a-date"})
        assert r.status_code == 400

    def test_duplicate_id_card(self, client):
        post_patient(client)
        r = post_patient(client, {"name": "李四", "phone": "13900009999"})
        assert r.status_code == 409


# ─── 查询列表 ──────────────────────────────────────────────────────────────────

class TestListPatients:
    def test_empty_list(self, client):
        r = client.get("/api/patients")
        assert r.status_code == 200
        body = r.get_json()
        assert body["data"]["total"] == 0
        assert body["data"]["items"] == []

    def test_list_one(self, client):
        post_patient(client)
        r = client.get("/api/patients")
        body = r.get_json()
        assert body["data"]["total"] == 1
        assert len(body["data"]["items"]) == 1

    def test_pagination(self, client):
        for i in range(5):
            post_patient(client, {
                "name": f"患者{i}",
                "phone": f"1380000{i:04d}",
                "id_card": None,
            })
        r = client.get("/api/patients?page=1&page_size=2")
        body = r.get_json()
        assert body["data"]["total"] == 5
        assert len(body["data"]["items"]) == 2

    def test_filter_by_name(self, client):
        post_patient(client, {"name": "张三", "id_card": None})
        post_patient(client, {"name": "李四", "phone": "13900009999", "id_card": None})
        r = client.get("/api/patients?name=张")
        body = r.get_json()
        assert body["data"]["total"] == 1
        assert body["data"]["items"][0]["name"] == "张三"

    def test_filter_by_gender(self, client):
        post_patient(client, {"gender": "男", "id_card": None})
        post_patient(client, {"name": "王芳", "gender": "女", "phone": "13900009999", "id_card": None})
        r = client.get("/api/patients?gender=女")
        body = r.get_json()
        assert body["data"]["total"] == 1

    def test_filter_by_phone(self, client):
        post_patient(client)
        r = client.get("/api/patients?phone=13800001234")
        body = r.get_json()
        assert body["data"]["total"] == 1

    def test_deleted_patient_not_in_list(self, client):
        r = post_patient(client)
        pid = r.get_json()["data"]["id"]
        client.delete(f"/api/patients/{pid}")
        r = client.get("/api/patients")
        assert r.get_json()["data"]["total"] == 0


# ─── 患者详情 ──────────────────────────────────────────────────────────────────

class TestGetPatient:
    def test_get_existing(self, client):
        pid = post_patient(client).get_json()["data"]["id"]
        r = client.get(f"/api/patients/{pid}")
        assert r.status_code == 200
        assert r.get_json()["data"]["id"] == pid

    def test_get_nonexistent(self, client):
        r = client.get("/api/patients/9999")
        assert r.status_code == 404

    def test_get_deleted_returns_404(self, client):
        pid = post_patient(client).get_json()["data"]["id"]
        client.delete(f"/api/patients/{pid}")
        r = client.get(f"/api/patients/{pid}")
        assert r.status_code == 404


# ─── 修改患者 ──────────────────────────────────────────────────────────────────

class TestUpdatePatient:
    def test_update_name(self, client):
        pid = post_patient(client).get_json()["data"]["id"]
        r = client.put(f"/api/patients/{pid}", json={"name": "张三三"})
        assert r.status_code == 200
        assert r.get_json()["data"]["name"] == "张三三"

    def test_update_phone_invalid(self, client):
        pid = post_patient(client).get_json()["data"]["id"]
        r = client.put(f"/api/patients/{pid}", json={"phone": "abc"})
        assert r.status_code == 400

    def test_update_nonexistent(self, client):
        r = client.put("/api/patients/9999", json={"name": "新名"})
        assert r.status_code == 404

    def test_update_id_card_duplicate(self, client):
        pid1 = post_patient(client).get_json()["data"]["id"]
        post_patient(client, {"name": "李四", "phone": "13900009999", "id_card": "110101199005200012"})
        r = client.put(f"/api/patients/{pid1}", json={"id_card": "110101199005200012"})
        assert r.status_code == 409


# ─── 删除患者 ──────────────────────────────────────────────────────────────────

class TestDeletePatient:
    def test_delete_success(self, client):
        pid = post_patient(client).get_json()["data"]["id"]
        r = client.delete(f"/api/patients/{pid}")
        assert r.status_code == 200
        assert r.get_json()["code"] == 0

    def test_delete_nonexistent(self, client):
        r = client.delete("/api/patients/9999")
        assert r.status_code == 404

    def test_delete_twice(self, client):
        pid = post_patient(client).get_json()["data"]["id"]
        client.delete(f"/api/patients/{pid}")
        r = client.delete(f"/api/patients/{pid}")
        assert r.status_code == 404
