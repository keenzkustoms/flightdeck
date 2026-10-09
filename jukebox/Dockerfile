FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app ./app
COPY static ./static
ENV PYTHONUNBUFFERED=1
EXPOSE 4540
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "4540"]
