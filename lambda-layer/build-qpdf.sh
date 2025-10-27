#!/bin/bash

# Script para crear Lambda Layer con qpdf
# Basado en: https://github.com/aws-samples/aws-lambda-layers-with-qpdf

set -e

echo "🔧 Construyendo Lambda Layer con qpdf"
echo "====================================="

# Crear directorio para el layer
LAYER_DIR="qpdf-layer"
rm -rf $LAYER_DIR
mkdir -p $LAYER_DIR

echo "📁 Creando estructura del layer..."

# Crear directorios necesarios
mkdir -p $LAYER_DIR/bin
mkdir -p $LAYER_DIR/lib

echo "🐳 Usando Docker para compilar qpdf..."

# Crear Dockerfile para compilar qpdf
cat > Dockerfile.qpdf << 'EOF'
FROM amazonlinux:2

# Instalar dependencias
RUN yum update -y && \
    yum groupinstall -y "Development Tools" && \
    yum install -y \
    cmake \
    wget \
    tar \
    gzip \
    libjpeg-turbo-devel \
    zlib-devel

# Descargar y compilar qpdf
WORKDIR /tmp
RUN wget https://github.com/qpdf/qpdf/releases/download/v11.6.3/qpdf-11.6.3.tar.gz && \
    tar -xzf qpdf-11.6.3.tar.gz && \
    cd qpdf-11.6.3 && \
    ./configure --disable-static --disable-doc && \
    make -j$(nproc) && \
    make install

# Copiar binarios al directorio de salida
RUN mkdir -p /output/bin /output/lib && \
    cp /usr/local/bin/qpdf /output/bin/ && \
    cp /usr/local/lib/libqpdf.so* /output/lib/ && \
    ldd /usr/local/bin/qpdf | grep -v "libc\|ld-linux" | awk '{print $3}' | xargs -I {} cp {} /output/lib/ || true

# Crear script de wrapper
RUN echo '#!/bin/bash\nexport LD_LIBRARY_PATH=/opt/lib:$LD_LIBRARY_PATH\n/opt/bin/qpdf "$@"' > /output/bin/qpdf-wrapper && \
    chmod +x /output/bin/qpdf-wrapper
EOF

echo "🔨 Compilando qpdf con Docker..."
docker build -f Dockerfile.qpdf -t qpdf-builder .

echo "📦 Extrayendo binarios del contenedor..."
docker run --rm -v $(pwd)/$LAYER_DIR:/output qpdf-builder cp -r /output/* /output/

# Verificar que qpdf se compiló correctamente
if [ -f "$LAYER_DIR/bin/qpdf" ]; then
    echo "✅ qpdf compilado exitosamente"
    echo "📊 Tamaño: $(du -h $LAYER_DIR/bin/qpdf | cut -f1)"
else
    echo "❌ Error: qpdf no se compiló"
    exit 1
fi

# Crear estructura final del layer
echo "📁 Organizando layer para Lambda..."
mkdir -p $LAYER_DIR/opt
mv $LAYER_DIR/bin $LAYER_DIR/opt/
mv $LAYER_DIR/lib $LAYER_DIR/opt/

# Crear script de wrapper
cat > $LAYER_DIR/opt/bin/qpdf-wrapper << 'EOF'
#!/bin/bash
export LD_LIBRARY_PATH=/opt/lib:$LD_LIBRARY_PATH
/opt/bin/qpdf "$@"
EOF

chmod +x $LAYER_DIR/opt/bin/qpdf-wrapper

# Crear archivo de prueba
cat > $LAYER_DIR/test-qpdf.sh << 'EOF'
#!/bin/bash
echo "🧪 Probando qpdf en el layer..."
export LD_LIBRARY_PATH=/opt/lib:$LD_LIBRARY_PATH
/opt/bin/qpdf --version
echo "✅ qpdf funcionando correctamente"
EOF

chmod +x $LAYER_DIR/test-qpdf.sh

echo "📦 Creando ZIP del layer..."
cd $LAYER_DIR
zip -r ../qpdf-layer.zip .
cd ..

echo "✅ Layer creado: qpdf-layer.zip"
echo "📊 Tamaño: $(du -h qpdf-layer.zip | cut -f1)"

# Limpiar
rm -rf $LAYER_DIR Dockerfile.qpdf

echo ""
echo "🎉 Lambda Layer con qpdf listo!"
echo "📁 Archivo: qpdf-layer.zip"
echo ""
echo "📋 Próximos pasos:"
echo "1. Subir layer a AWS"
echo "2. Actualizar worker para usar qpdf"
echo "3. Probar con extracto bancario"
