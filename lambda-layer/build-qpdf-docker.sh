#!/bin/bash

echo "🔧 Construyendo layer de qpdf con Docker"
echo "======================================="

# Verificar que Docker esté ejecutándose
if ! docker info > /dev/null 2>&1; then
    echo "❌ Error: Docker no está ejecutándose"
    echo "Por favor, inicia Docker Desktop y vuelve a intentar"
    exit 1
fi

# Crear directorio de salida
mkdir -p lambda-layer

# Construir la imagen de Docker
echo "🐳 Construyendo imagen de Docker..."
docker build -t qpdf-layer-builder .

# Extraer el layer
echo "📦 Extrayendo layer..."
docker run --rm -v "$(pwd)/lambda-layer:/out" qpdf-layer-builder

# Verificar que el archivo se creó
if [ -f "lambda-layer/qpdf-layer.zip" ]; then
    echo "✅ Layer creado exitosamente: lambda-layer/qpdf-layer.zip"
    echo "📊 Tamaño: $(du -sh lambda-layer/qpdf-layer.zip | awk '{print $1}')"
    
    # Verificar contenido del ZIP
    echo "📋 Contenido del layer:"
    unzip -l lambda-layer/qpdf-layer.zip | head -20
else
    echo "❌ Error: No se pudo crear el layer"
    exit 1
fi

echo ""
echo "🎉 Layer de qpdf listo!"
echo "📋 Para usar en CDK:"
echo "const qpdfLayer = new lambda.LayerVersion(this, 'QpdfLayer', {"
echo "  code: lambda.Code.fromAsset('lambda-layer/qpdf-layer.zip'),"
echo "  compatibleRuntimes: [lambda.Runtime.NODEJS_22_X],"
echo "  description: 'Layer que contiene qpdf para AWS Lambda',"
echo "});"
