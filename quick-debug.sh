#!/bin/bash

# Script rápido para abrir todas las herramientas de debug

# Colores
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${BLUE}🔧 Quick Debug - Finance Bot API${NC}\n"

# URLs importantes
XRAY_URL="https://console.aws.amazon.com/xray/home?region=us-east-2#/service-map"
TRACES_URL="https://console.aws.amazon.com/xray/home?region=us-east-2#/traces"
LAMBDA_URL="https://console.aws.amazon.com/lambda/home?region=us-east-2#/functions/FinanceBotApiV2Stack-PdfWorkerLambdaB52A647C-eR9Yd26QuvGm"
DYNAMODB_URL="https://console.aws.amazon.com/dynamodbv2/home?region=us-east-2#tables"

echo -e "${GREEN}📊 Herramientas disponibles:${NC}\n"
echo "1) Ver logs en tiempo real (CloudWatch)"
echo "2) Ver X-Ray Service Map (visual)"
echo "3) Ver X-Ray Traces (detallado)"
echo "4) Ver Lambda en consola"
echo "5) Ver DynamoDB tables"
echo "6) Ver estado de un documento específico"
echo "7) Abrir TODO en el navegador"
echo ""
read -p "Selecciona una opción (1-7): " choice

case $choice in
  1)
    echo -e "\n${BLUE}📋 Iniciando logs en tiempo real...${NC}\n"
    ./view-all-logs.sh
    ;;
  2)
    echo -e "\n${BLUE}🗺️  Abriendo X-Ray Service Map...${NC}"
    open "$XRAY_URL" 2>/dev/null || xdg-open "$XRAY_URL" 2>/dev/null || echo "Abre manualmente: $XRAY_URL"
    ;;
  3)
    echo -e "\n${BLUE}🔍 Abriendo X-Ray Traces...${NC}"
    open "$TRACES_URL" 2>/dev/null || xdg-open "$TRACES_URL" 2>/dev/null || echo "Abre manualmente: $TRACES_URL"
    ;;
  4)
    echo -e "\n${BLUE}⚡ Abriendo Lambda Console...${NC}"
    open "$LAMBDA_URL" 2>/dev/null || xdg-open "$LAMBDA_URL" 2>/dev/null || echo "Abre manualmente: $LAMBDA_URL"
    ;;
  5)
    echo -e "\n${BLUE}💾 Abriendo DynamoDB Console...${NC}"
    open "$DYNAMODB_URL" 2>/dev/null || xdg-open "$DYNAMODB_URL" 2>/dev/null || echo "Abre manualmente: $DYNAMODB_URL"
    ;;
  6)
    echo ""
    read -p "User ID (auth0UserId): " user_id
    read -p "Document ID: " doc_id
    
    echo -e "\n${BLUE}🔍 Buscando documento...${NC}\n"
    
    aws dynamodb get-item \
      --table-name document-uploads \
      --key "{\"auth0UserId\":{\"S\":\"$user_id\"},\"documentId\":{\"S\":\"$doc_id\"}}" \
      --output json | jq '.Item'
    ;;
  7)
    echo -e "\n${BLUE}🚀 Abriendo todas las consolas...${NC}"
    open "$XRAY_URL" 2>/dev/null || xdg-open "$XRAY_URL" 2>/dev/null
    sleep 1
    open "$TRACES_URL" 2>/dev/null || xdg-open "$TRACES_URL" 2>/dev/null
    sleep 1
    open "$LAMBDA_URL" 2>/dev/null || xdg-open "$LAMBDA_URL" 2>/dev/null
    
    echo -e "\n${GREEN}✅ Consolas abiertas!${NC}"
    echo -e "${YELLOW}Ahora ejecuta en otra terminal:${NC}"
    echo -e "  ./view-all-logs.sh"
    ;;
  *)
    echo -e "${YELLOW}Opción inválida${NC}"
    ;;
esac


