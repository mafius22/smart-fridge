"""Kompresja gzip odpowiedzi JSON (np. pomiary do wykresu: liczby kompresuja sie 4-6x)."""
import gzip

from flask import request

MIN_SIZE = 1024  # mniejszych nie oplaca sie kompresowac


def init_compression(app):
    @app.after_request
    def gzip_json(response):
        if (
            response.mimetype != "application/json"
            or response.direct_passthrough
            or response.status_code < 200
            or response.status_code >= 300
            or "Content-Encoding" in response.headers
            or "gzip" not in request.headers.get("Accept-Encoding", "").lower()
        ):
            return response
        data = response.get_data()
        if len(data) < MIN_SIZE:
            return response
        response.set_data(gzip.compress(data, compresslevel=5))
        response.headers["Content-Encoding"] = "gzip"
        response.vary.add("Accept-Encoding")
        return response
