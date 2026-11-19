from django.urls import path, re_path

from . import views
from .proxy import proxy

urlpatterns = [
    path("index.js", proxy),
    path("env.js", proxy),
    path("index.css", proxy),
    re_path(r"^(?:droplets|assets|api)/", proxy),
    path("shop.css", views.stylesheet),
    path("gallery", views.gallery),
    path("product/<str:slug>", views.product_page),
    path("login", views.login),
    path("admin", views.admin),
]
