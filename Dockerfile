FROM python:3.12-slim

WORKDIR /app

# Only copy what the server needs — excludes config.env, cache.db, etc.
COPY server.py app.js index.html styles.css demo.html config.env.example ./

# Volume mount point for persistent SQLite cache
RUN mkdir -p /data

EXPOSE 3002

# Override DB path so it lands on the mounted volume
ENV DB_PATH=/data/cache.db

CMD ["python", "server.py"]
