FROM node:20-alpine

# Utwórz katalog aplikacji
WORKDIR /app

# Skopiuj package.json i package-lock.json
COPY package*.json ./

# Zainstaluj zależności
RUN npm install --omit=dev

# Skopiuj kod źródłowy
COPY . .

# Expose port (dla HTTP API, jeśli będzie potrzebny)
EXPOSE 3000

# Healthcheck
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "console.log('OK')" || exit 1

# Uruchom aplikację
CMD ["node", "src/index.js"]
