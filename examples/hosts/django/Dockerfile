FROM python:3.14-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
# The host's own tests (shop/tests.py): a failing one stops the build.
RUN python manage.py test --verbosity 1
EXPOSE 8012
CMD ["gunicorn", "config.wsgi", "--bind", "0.0.0.0:8012", "--workers", "2", "--threads", "8", "--access-logfile", "-"]
