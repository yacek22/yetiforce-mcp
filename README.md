# YetiForce MCP Server

MCP (Model Context Protocol) server dla integracji YetiForce CRM z Claude, n8n i innymi narzędziami AI.

## Instalacja

1. Sklonuj repozytorium:
```bash
git clone https://github.com/TWOJ_USERNAME/yetiforce-mcp.git
cd yetiforce-mcp
```

2. Zainstaluj zależności:
```bash
npm install
```

3. Skopiuj `.env.example` do `.env` i uzupełnij własnymi danymi:
```bash
cp .env.example .env
# Edytuj .env i wpisz swoje dane dostępowe
```

4. Uruchom serwer:
```bash
npm start
```

## Deployment w Coolify

Zmienne środowiskowe ustaw w panelu Coolify (zakładka Environment).

## Endpointy API

- `GET /health` - Health check
- `GET /tools` - Lista dostępnych narzędzi
- `GET /contacts?limit=10&search=Jan` - Pobierz kontakty
- `GET /accounts?limit=10` - Pobierz kontrahenty
- `GET /opportunities?status=Prospecting` - Pobierz szanse sprzedaży
- `POST /query` - Wykonaj niestandardowe zapytanie SQL

## Bezpieczeństwo

⚠️ **WAŻNE:** Nigdy nie commituj pliku `.env` do repozytorium!
