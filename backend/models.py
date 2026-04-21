"""患者数据模型"""
from datetime import datetime, timezone
from flask_sqlalchemy import SQLAlchemy

db = SQLAlchemy()


def _now():
    return datetime.now(timezone.utc).replace(tzinfo=None)


class Patient(db.Model):
    __tablename__ = "patients"

    id = db.Column(db.Integer, primary_key=True, autoincrement=True)
    name = db.Column(db.String(100), nullable=False)
    gender = db.Column(db.String(10), nullable=False)
    birth_date = db.Column(db.Date, nullable=False)
    phone = db.Column(db.String(20), nullable=False)
    id_card = db.Column(db.String(18), unique=True, nullable=True)
    address = db.Column(db.Text, nullable=True)
    allergy = db.Column(db.Text, nullable=True)
    remark = db.Column(db.Text, nullable=True)
    is_deleted = db.Column(db.Boolean, nullable=False, default=False)
    created_at = db.Column(db.DateTime, nullable=False, default=_now)
    updated_at = db.Column(db.DateTime, nullable=False, default=_now, onupdate=_now)

    VALID_GENDERS = ("男", "女", "其他")

    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "gender": self.gender,
            "birth_date": self.birth_date.isoformat() if self.birth_date else None,
            "phone": self.phone,
            "id_card": self.id_card,
            "address": self.address,
            "allergy": self.allergy,
            "remark": self.remark,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }
