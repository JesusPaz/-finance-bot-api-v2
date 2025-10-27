#!/bin/bash

# Script para compilar qpdf estáticamente para Amazon Linux 2
set -e

echo "🔧 Compilando qpdf estáticamente para Amazon Linux 2"
echo "====================================================="

# Crear directorio de trabajo
WORK_DIR="/tmp/qpdf-build-$$"
mkdir -p $WORK_DIR
cd $WORK_DIR

echo "📁 Directorio de trabajo: $WORK_DIR"

# Extraer qpdf
echo "📦 Extrayendo qpdf..."
tar -xzf /Users/jesus/personal/finance-bot-api-v2/lambda-layer/qpdf-12.2.0.tar.gz
cd qpdf-12.2.0

# Configurar para compilación estática
echo "⚙️  Configurando qpdf para compilación estática..."
./configure \
  --disable-shared \
  --enable-static \
  --disable-doc \
  --disable-examples \
  --disable-tests \
  --prefix=/tmp/qpdf-install

# Compilar
echo "🔨 Compilando qpdf..."
make -j$(nproc)

# Instalar
echo "📦 Instalando qpdf..."
make install

# Verificar que el binario funciona
echo "🧪 Verificando binario..."
/tmp/qpdf-install/bin/qpdf --version

# Copiar binario al layer
echo "📋 Copiando binario al layer..."
mkdir -p /Users/jesus/personal/finance-bot-api-v2/lambda-layer/qpdf-layer/bin
cp /tmp/qpdf-install/bin/qpdf /Users/jesus/personal/finance-bot-api-v2/lambda-layer/qpdf-layer/bin/qpdf
chmod +x /Users/jesus/personal/finance-bot-api-v2/lambda-layer/qpdf-layer/bin/qpdf

# Verificar que el binario del layer funciona
echo "🧪 Verificando binario del layer..."
/Users/jesus/personal/finance-bot-api-v2/lambda-layer/qpdf-layer/bin/qpdf --version

# Limpiar
echo "🧹 Limpiando archivos temporales..."
cd /Users/jesus/personal/finance-bot-api-v2
rm -rf $WORK_DIR /tmp/qpdf-install

echo "✅ qpdf compilado exitosamente para Amazon Linux 2"
echo "📁 Binario ubicado en: lambda-layer/qpdf-layer/bin/qpdf"
