# ── ClinAI — Makefile de despliegue ──────────────────────────────────────────
# Uso: make <target>
# Requiere: Docker Engine 24+, Docker Compose v2 (plugin)

COMPOSE  := docker compose
PROJECT  := sistema-clinico-inteligente

.PHONY: help up down build restart logs ps health migrate backup clean

## Ayuda
help:
	@echo "ClinAI — comandos disponibles:"
	@echo ""
	@echo "  make up          Levantar todos los servicios"
	@echo "  make down        Detener todos los servicios"
	@echo "  make build       Reconstruir imágenes y levantar"
	@echo "  make restart     Reiniciar servicios modificados (frontend, backend, orchestrator)"
	@echo "  make logs        Ver logs en tiempo real (todos los servicios)"
	@echo "  make ps          Estado de los contenedores"
	@echo "  make health      Verificar health de servicios clave"
	@echo "  make migrate     Aplicar migraciones de base de datos"
	@echo "  make backup      Backup de PostgreSQL a ./backups/"
	@echo "  make clean       Eliminar imágenes no usadas (no borra volúmenes)"

## Levantar todos los servicios
up:
	$(COMPOSE) up -d
	$(COMPOSE) ps

## Detener todos los servicios
down:
	$(COMPOSE) down

## Reconstruir imágenes modificadas y relanzar
build:
	$(COMPOSE) up -d --build frontend backend orchestrator
	$(COMPOSE) restart nginx

## Reinicio rápido sin rebuild (recarga config nginx, reinicia app containers)
restart:
	$(COMPOSE) restart backend orchestrator rag-agent
	$(COMPOSE) restart nginx

## Logs en tiempo real
logs:
	$(COMPOSE) logs -f --tail=100

## Estado de contenedores
ps:
	$(COMPOSE) ps

## Health check de los servicios principales
health:
	@echo "── Backend ──────────────────────────────────"
	@curl -sk https://clinai.me/health | python3 -m json.tool 2>/dev/null || echo "ERROR"
	@echo "── RAG Agent ────────────────────────────────"
	@$(COMPOSE) exec -T rag-agent curl -s http://localhost:8004/health | python3 -m json.tool 2>/dev/null || echo "ERROR"
	@echo "── Contenedores ─────────────────────────────"
	@$(COMPOSE) ps --format "table {{.Name}}\t{{.Status}}"

## Aplicar migraciones de base de datos
migrate:
	$(COMPOSE) exec backend python -m core.migrations

## Backup de PostgreSQL
backup:
	@mkdir -p ./backups
	@TIMESTAMP=$$(date +%Y%m%d_%H%M%S) && \
	$(COMPOSE) exec -T postgres pg_dump -U clinai clinai_db | \
	gzip > ./backups/clinai_db_$$TIMESTAMP.sql.gz && \
	echo "✅ Backup guardado en ./backups/clinai_db_$$TIMESTAMP.sql.gz"

## Limpiar imágenes no usadas (preserva volúmenes con datos)
clean:
	docker image prune -f
	@echo "✅ Imágenes no usadas eliminadas. Los volúmenes de datos no fueron modificados."
