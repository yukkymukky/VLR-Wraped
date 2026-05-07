import json
import os
import subprocess
import sys
import threading
import uuid

from flask import Flask, jsonify, request, send_from_directory

ROOT = os.path.dirname(__file__)
FRONTEND = os.path.join(ROOT, "frontend")
DATA_DIR = os.path.join(ROOT, "data")

app = Flask(__name__, static_folder=FRONTEND)

# In-memory job store: {job_id: {"status": "running"|"done"|"error", "data": ..., "error": ...}}
_jobs: dict = {}
_jobs_lock = threading.Lock()


def _run_scrape_job(job_id: str, cmd: list, cwd: str, out_file: str) -> None:
    result = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True)
    with _jobs_lock:
        if result.returncode != 0:
            _jobs[job_id] = {"status": "error", "error": result.stderr[-2000:] or "Spider failed"}
            return
        if not os.path.exists(out_file):
            _jobs[job_id] = {"status": "error", "error": "Spider finished but produced no output"}
            return
        try:
            with open(out_file, "r", encoding="utf-8") as f:
                data = json.load(f)
            _jobs[job_id] = {"status": "done", "data": data}
        except Exception as exc:
            _jobs[job_id] = {"status": "error", "error": str(exc)}


# Frontend 
@app.route("/")
def index():
    return send_from_directory(FRONTEND, "index.html")


@app.route("/<path:filename>")
def static_files(filename):
    return send_from_directory(FRONTEND, filename)


# Scrape API
@app.route("/api/scrape")
def scrape():
    username = request.args.get("username", "").strip()
    year     = request.args.get("year", "").strip()

    if not username:
        return jsonify({"error": "username is required"}), 400

    if not username.replace("-", "").replace("_", "").replace(".", "").isalnum():
        return jsonify({"error": "Invalid username"}), 400

    if year and not year.isdigit():
        return jsonify({"error": "Invalid year"}), 400

    out_file = os.path.join(DATA_DIR, f"{username}.json")

    cmd = ["uv", "run", "scrapy", "crawl", "vlr", "-a", f"username={username}"]
    if year:
        cmd += ["-a", f"year={year}"]

    job_id = str(uuid.uuid4())
    with _jobs_lock:
        _jobs[job_id] = {"status": "running"}

    t = threading.Thread(target=_run_scrape_job, args=(job_id, cmd, ROOT, out_file), daemon=True)
    t.start()

    return jsonify({"job_id": job_id})


@app.route("/api/status/<job_id>")
def job_status(job_id):
    with _jobs_lock:
        job = _jobs.get(job_id)
    if job is None:
        return jsonify({"error": "Unknown job"}), 404
    return jsonify(job)


# Main 
if __name__ == "__main__":
    os.makedirs(DATA_DIR, exist_ok=True)
    port = int(os.environ.get("PORT", 5000))
    app.run(debug=True, port=port)
