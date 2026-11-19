from django.urls import include, path

from basic.views import index

urlpatterns = [
    path("", index),
    # The shop demo: /gallery, /product/<slug>, /login, /admin, and its proxy.
    path("", include("shop.urls")),
]
