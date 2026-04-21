"""Flask 应用入口"""
import os

from flask import Flask, send_from_directory

from models import db
from routes.patients import patients_bp


def create_app(db_uri=None):
    app = Flask(__name__, static_folder=None)

    # 数据库配置
    if db_uri is None:
        db_uri = os.environ.get(
            "DATABASE_URL",
            "sqlite:///patients.db",
        )
    app.config["SQLALCHEMY_DATABASE_URI"] = db_uri
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

    db.init_app(app)

    with app.app_context():
        db.create_all()

    # 注册蓝图
    app.register_blueprint(patients_bp)

    # 静态前端文件（开发时从 ../frontend 目录提供）
    frontend_dir = os.path.join(os.path.dirname(__file__), "..", "frontend")
    frontend_dir = os.path.abspath(frontend_dir)

    @app.route("/", defaults={"path": ""})
    @app.route("/<path:path>")
    def serve_frontend(path):
        # send_from_directory uses safe_join internally to prevent path traversal
        try:
            if path:
                return send_from_directory(frontend_dir, path)
        except Exception:
            pass
        return send_from_directory(frontend_dir, "index.html")

    return app


if __name__ == "__main__":
    application = create_app()
    debug = os.environ.get("FLASK_DEBUG", "0") == "1"
    application.run(host="0.0.0.0", port=5000, debug=debug)
