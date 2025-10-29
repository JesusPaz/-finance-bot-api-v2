#!/bin/bash

# Script para ver los logs del Worker Lambda en CloudWatch

# Colores
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}📋 Obteniendo logs del Worker Lambda...${NC}\n"

# Obtener el nombre de la función Lambda
STACK_NAME="FinanceBotApiV2Stack"
LAMBDA_NAME=$(aws cloudformation describe-stacks \
  --stack-name $STACK_NAME \
  --query "Stacks[0].Outputs[?OutputKey=='WorkerLambda'].OutputValue" \
  --output text 2>/dev/null)

if [ -z "$LAMBDA_NAME" ]; then
  echo -e "${RED}❌ No se pudo encontrar el Worker Lambda${NC}"
  echo "Asegúrate de que el stack está desplegado"
  exit 1
fi

echo -e "${GREEN}✅ Worker Lambda encontrado: ${LAMBDA_NAME}${NC}\n"

# Nombre del log group
LOG_GROUP="/aws/lambda/${LAMBDA_NAME}"

echo -e "${BLUE}📊 Mostrando logs de los últimos 10 minutos...${NC}\n"
echo -e "${YELLOW}Presiona Ctrl+C para salir${NC}\n"
echo "----------------------------------------"

# Tail de los logs (últimos 10 minutos, con follow)
aws logs tail $LOG_GROUP \
  --follow \
  --since 10m \
  --format short \
  --filter-pattern "[DEBUG]"


