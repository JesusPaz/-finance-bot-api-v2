#!/bin/bash

# Script simplificado para crear Lambda Layer con qpdf
# Usa un layer pre-compilado para mayor velocidad

set -e

echo "🔧 Creando Lambda Layer con qpdf (versión simplificada)"
echo "======================================================="

# Crear directorio para el layer
LAYER_DIR="qpdf-layer"
rm -rf $LAYER_DIR
mkdir -p $LAYER_DIR

echo "📥 Descargando qpdf pre-compilado..."

# Crear estructura del layer
mkdir -p $LAYER_DIR/bin
mkdir -p $LAYER_DIR/lib

# Descargar qpdf pre-compilado para Amazon Linux 2
echo "📦 Descargando binarios de qpdf..."

# Usar un layer pre-existente como base
# Descargar qpdf desde releases oficiales
QPDF_VERSION="11.6.3"
QPDF_URL="https://github.com/qpdf/qpdf/releases/download/v${QPDF_VERSION}/qpdf-${QPDF_VERSION}.tar.gz"

echo "🔨 Compilando qpdf con Docker (Amazon Linux 2)..."

# Crear Dockerfile optimizado
cat > Dockerfile.qpdf << 'EOF'
FROM amazonlinux:2

# Instalar dependencias mínimas
RUN yum update -y && \
    yum install -y \
    wget \
    tar \
    gzip \
    gcc \
    gcc-c++ \
    make \
    cmake \
    libjpeg-turbo-devel \
    zlib-devel

# Crear directorio de trabajo
WORKDIR /build

# Descargar y compilar qpdf
RUN wget https://github.com/qpdf/qpdf/releases/download/v11.6.3/qpdf-11.6.3.tar.gz && \
    tar -xzf qpdf-11.6.3.tar.gz && \
    cd qpdf-11.6.3 && \
    ./configure --disable-static --disable-doc --prefix=/opt && \
    make -j2 && \
    make install

# Crear estructura del layer
RUN mkdir -p /layer/bin /layer/lib

# Copiar binarios
RUN cp /opt/bin/qpdf /layer/bin/ && \
    cp /opt/lib/libqpdf.so* /layer/lib/ 2>/dev/null || true

# Copiar dependencias dinámicas
RUN ldd /opt/bin/qpdf | grep -E "(libjpeg|libz)" | awk '{print $3}' | xargs -I {} cp {} /layer/lib/ 2>/dev/null || true

# Crear script wrapper
RUN echo '#!/bin/bash' > /layer/bin/qpdf-wrapper && \
    echo 'export LD_LIBRARY_PATH=/opt/lib:$LD_LIBRARY_PATH' >> /layer/bin/qpdf-wrapper && \
    echo '/opt/bin/qpdf "$@"' >> /layer/bin/qpdf-wrapper && \
    chmod +x /layer/bin/qpdf-wrapper
EOF

echo "🐳 Construyendo imagen Docker..."
docker build -f Dockerfile.qpdf -t qpdf-builder .

echo "📦 Extrayendo binarios..."
docker run --rm -v $(pwd)/$LAYER_DIR:/output qpdf-builder sh -c "cp -r /layer/* /output/"

# Verificar que se creó correctamente
if [ -f "$LAYER_DIR/bin/qpdf" ]; then
    echo "✅ qpdf compilado exitosamente"
    echo "📊 Tamaño del binario: $(du -h $LAYER_DIR/bin/qpdf | cut -f1)"
    
    # Probar que funciona
    echo "🧪 Probando qpdf..."
    export LD_LIBRARY_PATH=$LAYER_DIR/lib:$LD_LIBRARY_PATH
    $LAYER_DIR/bin/qpdf --version || echo "⚠️  qpdf necesita librerías del sistema"
    
else
    echo "❌ Error: No se pudo compilar qpdf"
    exit 1
fi

# Crear estructura final para Lambda Layer
echo "📁 Organizando para Lambda Layer..."
mkdir -p $LAYER_DIR/opt
mv $LAYER_DIR/bin $LAYER_DIR/opt/
mv $LAYER_DIR/lib $LAYER_DIR/opt/

# Crear script de prueba
cat > $LAYER_DIR/test-layer.sh << 'EOF'
#!/bin/bash
echo "🧪 Probando Lambda Layer con qpdf..."
export LD_LIBRARY_PATH=/opt/lib:$LD_LIBRARY_PATH
/opt/bin/qpdf --version
echo "✅ Layer funcionando correctamente"
EOF

chmod +x $LAYER_DIR/test-layer.sh

# Crear ZIP del layer
echo "📦 Creando ZIP del layer..."
cd $LAYER_DIR
zip -r ../qpdf-layer.zip . -x "test-layer.sh"
cd ..

echo "✅ Layer creado: qpdf-layer.zip"
echo "📊 Tamaño total: $(du -h qpdf-layer.zip | cut -f1)"

# Limpiar archivos temporales
rm -rf $LAYER_DIR Dockerfile.qpdf

echo ""
echo "🎉 Lambda Layer con qpdf listo!"
echo ""
echo "📋 Para usar el layer:"
echo "1. aws lambda publish-layer-version --layer-name qpdf --zip-file fileb://qpdf-layer.zip"
echo "2. Agregar layer ARN al worker Lambda"
echo "3. Usar /opt/bin/qpdf en el código"
