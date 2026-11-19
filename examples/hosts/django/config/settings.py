"""Settings for the Django host: no database, no sessions, no auth.

The droplets servers' addresses come from the environment. Each comes as a
pair: the internal URL this process fetches from, and the public URL the
browser uses, which goes out as `x-droplet-location`.
"""

import os

from django.core.management.utils import get_random_secret_key

# Django needs a key; this app signs nothing, so one per process does.
SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY") or get_random_secret_key()
DEBUG = False
ALLOWED_HOSTS = os.environ.get("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1").split(",")

INSTALLED_APPS = ["basic", "shop"]

# Django's defaults, less the ones that need a database. CsrfViewMiddleware
# stays for the host's own forms; the shop's proxy opts out (shop/proxy.py).
MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"
TEMPLATES = [{"BACKEND": "django.template.backends.django.DjangoTemplates", "APP_DIRS": True}]
DATABASES = {}
USE_TZ = True

# The most the proxy buffers of a request body. Above the shop's own 3 MiB
# multipart limit, so the shop answers an upload that is too large itself.
DATA_UPLOAD_MAX_MEMORY_SIZE = 4 * 1024 * 1024

# Without it, a production Django prints no error at all.
LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "handlers": {"console": {"class": "logging.StreamHandler"}},
    "root": {"handlers": ["console"], "level": "WARNING"},
    "loggers": {"django.request": {"level": "ERROR"}},
}

# The Svelte example's droplets server, for the basic page (`/`).
DROPLETS_INTERNAL_URL = os.environ.get("DROPLETS_INTERNAL_URL", "http://localhost:8000").rstrip("/")
DROPLETS_PUBLIC_URL = os.environ.get("DROPLETS_PUBLIC_URL", "http://localhost:8000").rstrip("/")

# The shop (`http://shop:8300` in Docker), and this host's own public origin.
SHOP_INTERNAL_URL = os.environ.get("SHOP_INTERNAL_URL", "http://localhost:8300").rstrip("/")
SHOP_PUBLIC_URL = os.environ.get("SHOP_PUBLIC_URL", "http://localhost:8012")
