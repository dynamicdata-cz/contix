# CONTIX – převodní služba: LibreOffice (headless) + poppler (ADR-025)
# Běží v interní síti bez přístupu do internetu; převádí Word/Excel/PowerPoint do PDF a čte text z PDF.
FROM oven/bun:1
# písma metricky shodná s Microsoft Office: Calibri → Carlito, Cambria → Caladea, Arial/Times/Courier → Liberation
RUN apt-get update && apt-get install -y --no-install-recommends \
      libreoffice-writer-nogui libreoffice-calc-nogui libreoffice-impress-nogui \
      poppler-utils fontconfig \
      fonts-crosextra-carlito fonts-crosextra-caladea fonts-liberation fonts-liberation2 fonts-dejavu-core fonts-noto-core \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY infra/converter/server.ts ./server.ts
# vlastní písma organizace (např. Aptos, firemní písmo): ./fonts na serveru → /usr/local/share/fonts/custom
ENV PORT=3100 HOME=/tmp XDG_CACHE_HOME=/tmp/.cache
EXPOSE 3100
USER bun
CMD ["sh", "-c", "fc-cache -f >/dev/null 2>&1; exec bun server.ts"]
