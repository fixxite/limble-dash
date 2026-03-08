FROM python:3.12-slim
WORKDIR /app
COPY . .
EXPOSE 3002
CMD ["python", "server.py"]
