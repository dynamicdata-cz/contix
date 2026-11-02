# CONTIX – služba záloh: pg_dump/pg_restore stejné hlavní verze jako databáze + age (šifrování)
FROM pgvector/pgvector:pg17
RUN apt-get update && apt-get install -y --no-install-recommends age tzdata && rm -rf /var/lib/apt/lists/*
COPY infra/scripts/backup.sh infra/scripts/restore.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/backup.sh /usr/local/bin/restore.sh
ENTRYPOINT []
CMD ["backup.sh", "--loop"]
