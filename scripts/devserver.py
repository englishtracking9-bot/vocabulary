# -*- coding: utf-8 -*-
"""本機開發用伺服器：threaded + no-store 標頭，避免瀏覽器快取舊版程式（僅供開發測試）。"""
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8143


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        super().end_headers()


if __name__ == '__main__':
    with ThreadingHTTPServer(("", PORT), NoCacheHandler) as httpd:
        print(f"Dev server (threaded, no-cache) on http://localhost:{PORT}")
        httpd.serve_forever()
