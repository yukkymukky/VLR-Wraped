import json
import os
import subprocess
import sys

from flask import Flask, jsonify, request, send_from_directory

ROOT = os.path.dirname(__file__)
FRONTEND = os.path.join(ROOT, "frontend")
DATA_DIR = os.path.join(ROOT, "data")

app = Flask(__name__, static_folder=FRONTEND)


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

    result = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True)

    if result.returncode != 0:
        # Return scrapy stderr for debugging
        return jsonify({"error": result.stderr[-2000:] or "Spider failed"}), 500

    if not os.path.exists(out_file):
        return jsonify({"error": "Spider finished but produced no output"}), 500

    with open(out_file, "r", encoding="utf-8") as f:
        data = json.load(f)

    return jsonify(data)


# Main 
if __name__ == "__main__":
    os.makedirs(DATA_DIR, exist_ok=True)
    port = int(os.environ.get("PORT", 5000))
    app.run(debug=True, port=port)
