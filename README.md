# VLR Wrapped!!!!!!!!!!!!!!!!

Generate a wrapped-style stats card for any vlr.gg forum user.

<img src = "/image.png" >

## Requirements

- [uv](https://docs.astral.sh/uv/getting-started/installation/)
- A SmartProxy (or compatible) rotating residential proxy.

## Setup

**1. Clone and install dependencies**

```bash
# clone however u wanat

cd "vlr card"
uv sync
```

**2. Create a `.env` file in the repo root**

Set up your proxy. This is how I did it. You can use any proxy, I used decodo, but if you change it up make sure you edit `spider/middlewares.py`

```env
PROXY_USERNAME=your_proxy_username
PROXY_PASSWORD=your_proxy_password
```

> A proxy is **required**. Without it the spider will get quickly blocked.

## Running the web app

```bash
uv run python server.py
```

Then open [http://localhost:5000](http://localhost:5000).

Enter a vlr.gg username, pick a year (or Lifetime), and click **Generate**.

## Running the scraper directly

```bash
uv run scrapy crawl vlr -a username=<username> -a year=<year>
# e.g.
uv run scrapy crawl vlr -a username=yukky -a year=2026
uv run scrapy crawl vlr -a username=yukky          # lifetime
```

Output is saved to `data/<username>.json`.

## Loading a JSON file

Instead of scraping, you can drag-and-drop or upload an existing `data/<username>.json` directly in the UI using the upload button.
