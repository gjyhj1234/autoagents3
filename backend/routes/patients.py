"""患者 CRUD 路由"""
import re
from datetime import date, datetime, timezone

from flask import Blueprint, jsonify, request

from models import Patient, db

patients_bp = Blueprint("patients", __name__, url_prefix="/api/patients")

_PHONE_RE = re.compile(r"^\d{11}$")


def _ok(data=None, status=200):
    return jsonify({"code": 0, "message": "ok", "data": data}), status


def _err(code, message, status=400):
    return jsonify({"code": code, "message": message, "data": None}), status


def _parse_date(s):
    try:
        return date.fromisoformat(s)
    except (ValueError, TypeError):
        return None


# ---------------------------------------------------------------------------
# POST /api/patients  — 创建患者
# ---------------------------------------------------------------------------
@patients_bp.route("", methods=["POST"])
def create_patient():
    body = request.get_json(silent=True) or {}

    name = (body.get("name") or "").strip()
    gender = (body.get("gender") or "").strip()
    birth_date_str = (body.get("birth_date") or "").strip()
    phone = (body.get("phone") or "").strip()
    id_card = (body.get("id_card") or "").strip() or None

    if not name:
        return _err(4001, "姓名不能为空")
    if gender not in Patient.VALID_GENDERS:
        return _err(4001, f"性别必须为 {'、'.join(Patient.VALID_GENDERS)} 之一")
    birth_date = _parse_date(birth_date_str)
    if birth_date is None:
        return _err(4001, "出生日期格式不正确（YYYY-MM-DD）")
    if not _PHONE_RE.match(phone):
        return _err(4001, "手机号格式不正确（11 位数字）")

    if id_card:
        existing = Patient.query.filter_by(id_card=id_card, is_deleted=False).first()
        if existing:
            return _err(4091, "该身份证号已存在", status=409)

    patient = Patient(
        name=name,
        gender=gender,
        birth_date=birth_date,
        phone=phone,
        id_card=id_card,
        address=(body.get("address") or "").strip() or None,
        allergy=(body.get("allergy") or "").strip() or None,
        remark=(body.get("remark") or "").strip() or None,
    )
    db.session.add(patient)
    db.session.commit()
    return _ok(patient.to_dict(), status=201)


# ---------------------------------------------------------------------------
# GET /api/patients  — 查询列表（分页 + 筛选）
# ---------------------------------------------------------------------------
@patients_bp.route("", methods=["GET"])
def list_patients():
    try:
        page = max(1, int(request.args.get("page", 1)))
        page_size = min(100, max(1, int(request.args.get("page_size", 20))))
    except (ValueError, TypeError):
        return _err(4001, "page 和 page_size 必须为整数")

    name_q = (request.args.get("name") or "").strip()
    gender_q = (request.args.get("gender") or "").strip()
    phone_q = (request.args.get("phone") or "").strip()

    query = Patient.query.filter_by(is_deleted=False)
    if name_q:
        query = query.filter(Patient.name.contains(name_q))
    if gender_q:
        query = query.filter_by(gender=gender_q)
    if phone_q:
        query = query.filter_by(phone=phone_q)

    total = query.count()
    items = (
        query.order_by(Patient.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )

    return _ok(
        {
            "total": total,
            "page": page,
            "page_size": page_size,
            "items": [p.to_dict() for p in items],
        }
    )


# ---------------------------------------------------------------------------
# GET /api/patients/:id  — 患者详情
# ---------------------------------------------------------------------------
@patients_bp.route("/<int:patient_id>", methods=["GET"])
def get_patient(patient_id):
    patient = Patient.query.filter_by(id=patient_id, is_deleted=False).first()
    if patient is None:
        return _err(4041, "患者不存在", status=404)
    return _ok(patient.to_dict())


# ---------------------------------------------------------------------------
# PUT /api/patients/:id  — 修改患者
# ---------------------------------------------------------------------------
@patients_bp.route("/<int:patient_id>", methods=["PUT"])
def update_patient(patient_id):
    patient = Patient.query.filter_by(id=patient_id, is_deleted=False).first()
    if patient is None:
        return _err(4041, "患者不存在", status=404)

    body = request.get_json(silent=True) or {}

    if "name" in body:
        name = body["name"].strip()
        if not name:
            return _err(4001, "姓名不能为空")
        patient.name = name

    if "gender" in body:
        gender = body["gender"].strip()
        if gender not in Patient.VALID_GENDERS:
            return _err(4001, f"性别必须为 {'、'.join(Patient.VALID_GENDERS)} 之一")
        patient.gender = gender

    if "birth_date" in body:
        birth_date = _parse_date(body["birth_date"])
        if birth_date is None:
            return _err(4001, "出生日期格式不正确（YYYY-MM-DD）")
        patient.birth_date = birth_date

    if "phone" in body:
        phone = body["phone"].strip()
        if not _PHONE_RE.match(phone):
            return _err(4001, "手机号格式不正确（11 位数字）")
        patient.phone = phone

    if "id_card" in body:
        id_card = (body["id_card"] or "").strip() or None
        if id_card and id_card != patient.id_card:
            existing = Patient.query.filter_by(id_card=id_card, is_deleted=False).first()
            if existing:
                return _err(4091, "该身份证号已存在", status=409)
        patient.id_card = id_card

    for field in ("address", "allergy", "remark"):
        if field in body:
            setattr(patient, field, (body[field] or "").strip() or None)

    patient.updated_at = datetime.now(timezone.utc).replace(tzinfo=None)

    db.session.commit()
    return _ok(patient.to_dict())


# ---------------------------------------------------------------------------
# DELETE /api/patients/:id  — 软删除患者
# ---------------------------------------------------------------------------
@patients_bp.route("/<int:patient_id>", methods=["DELETE"])
def delete_patient(patient_id):
    patient = Patient.query.filter_by(id=patient_id, is_deleted=False).first()
    if patient is None:
        return _err(4041, "患者不存在", status=404)

    patient.is_deleted = True
    patient.updated_at = datetime.now(timezone.utc).replace(tzinfo=None)
    db.session.commit()
    return _ok(None)
