# Atelier Marée – boutique de vêtements

Structure :
- `frontend/` : le site (HTML, CSS, JS, produits en JSON) servi par nginx
- `docker-compose.yml` : lance le site sur http://localhost:8080

Lancer :      docker compose up -d --build
Arrêter :     docker compose down
Logs :        docker compose logs -f

Modifier les produits : `frontend/data/products.json`
