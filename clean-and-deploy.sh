#!/bin/bash

# Script para limpiar COMPLETAMENTE todos los recursos y redesplegar

set -e

echo "🔐 Cargando variables de Auth0 desde .env..."
if [ ! -f .env ]; then
  echo "❌ Error: No se encontró archivo .env"
  exit 1
fi

export $(cat .env | grep -v '^#' | xargs)

echo "✅ Variables cargadas:"
echo "   AUTH0_DOMAIN=$AUTH0_DOMAIN"
echo "   AUTH0_AUDIENCE=$AUTH0_AUDIENCE"
echo ""

echo "🗑️  Paso 1: Destruyendo stack si existe..."
cdk destroy --profile personal --force 2>&1 | tail -20 || echo "⚠️  Stack no existe o ya fue destruido"

echo ""
echo "🗑️  Paso 2: Eliminando tablas DynamoDB huerfanas..."
for table in "finance-transactions" "document-passwords" "document-uploads"; do
  echo "Intentando eliminar $table..."
  aws dynamodb delete-table --table-name "$table" --profile personal 2>/dev/null && echo "✅ $table eliminada" || echo "⚠️  $table no existe"
  sleep 2
done

echo ""
echo "🗑️  Paso 3: Eliminando bucket S3 huerfano..."
aws s3 rm s3://finances-data-851725652296 --recursive --profile personal 2>/dev/null && echo "✅ Contenido del bucket eliminado" || echo "⚠️  Bucket no existe o ya está vacío"
aws s3 rb s3://finances-data-851725652296 --profile personal 2>/dev/null && echo "✅ Bucket eliminado" || echo "⚠️  Bucket no existe"

echo ""
echo "⏳ Esperando 30 segundos para que AWS procese las eliminaciones..."
sleep 30

echo ""
echo "🚀 Paso 4: Desplegando stack completo desde cero..."
cdk deploy --require-approval never --profile personal 2>&1 | tee /tmp/cdk-deploy-clean-final.log

echo ""
echo "✅ ¡Despliegue completado!"
echo ""
echo "📋 Verificando el API Gateway desplegado:"
aws cloudformation describe-stacks --stack-name FinanceBotApiV2Stack --profile personal --query "Stacks[0].Outputs[?OutputKey=='ApiUrl'].OutputValue" --output text

