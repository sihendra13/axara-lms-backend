FROM node:20-slim

# Install LibreOffice (headless + impress) dan poppler-utils untuk konversi PPTX→PDF→PNG
RUN apt-get update && apt-get install -y \
    libreoffice-headless \
    libreoffice-impress \
    libreoffice-draw \
    poppler-utils \
    fonts-liberation \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Buat direktori home untuk LibreOffice (butuh writable HOME)
RUN mkdir -p /tmp/libreoffice-home

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY src ./src

EXPOSE 3000

CMD ["node", "src/server.js"]
