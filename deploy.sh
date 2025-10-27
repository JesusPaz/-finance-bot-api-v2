#!/bin/bash

# Script para desplegar el stack con variables de Auth0 desde .env

set -e

echo "🔐 Cargando variables de Auth0 desde .env..."

# Verificar que existe .env
if [ ! -f .env ]; then
  echo "❌ Error: No se encontró archivo .env"
  echo "Crea un archivo .env con:"
  echo "AUTH0_DOMAIN=tu-domain.us.auth0.com"
  echo "AUTH0_AUDIENCE=https://tu-audience.com"
  exit 1
fi

# Cargar variables de .env
export $(cat .env | grep -v '^#' | xargs)

# Verificar que las variables estén cargadas
if [ -z "$AUTH0_DOMAIN" ]; then
  echo "❌ Error: AUTH0_DOMAIN no está definido en .env"
  exit 1
fi

if [ -z "$AUTH0_AUDIENCE" ]; then
  echo "❌ Error: AUTH0_AUDIENCE no está definido en .env"
  exit 1
fi

echo "✅ Variables cargadas:"
echo "   AUTH0_DOMAIN=$AUTH0_DOMAIN"
echo "   AUTH0_AUDIENCE=$AUTH0_AUDIENCE"
echo ""
echo "🚀 Desplegando stack..."

cdk deploy --require-approval never --profile personal

echo ""
echo "✅ ¡Despliegue completo!"

