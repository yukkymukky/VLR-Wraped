import os
from dotenv import load_dotenv

load_dotenv()

# spider/middlewares.py
class ProxyMiddleware:
    def process_request(self, request, spider):
        username = os.getenv('PROXY_USERNAME')
        password = os.getenv('PROXY_PASSWORD')
        proxy_url = f"http://{username}:{password}@gate.decodo.com:7000"
        request.meta['proxy'] = proxy_url