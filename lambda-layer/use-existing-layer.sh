#!/bin/bash

# Script para usar un layer existente de qpdf
# Más rápido que compilar desde cero

set -e

echo "🔧 Usando Layer existente de qpdf"
echo "=================================="

# Layer ARN público de qpdf (si existe) o crear uno simple
LAYER_NAME="qpdf-layer"
REGION="us-east-2"

echo "📦 Creando layer simple con qpdf..."

# Crear directorio del layer
LAYER_DIR="qpdf-layer"
rm -rf $LAYER_DIR
mkdir -p $LAYER_DIR

# Crear estructura básica
mkdir -p $LAYER_DIR/opt/bin
mkdir -p $LAYER_DIR/opt/lib

# Crear script wrapper que use qpdf del sistema o descargue uno
cat > $LAYER_DIR/opt/bin/qpdf-wrapper << 'EOF'
#!/bin/bash
# Wrapper para qpdf en Lambda Layer

# Intentar usar qpdf del sistema primero
if command -v qpdf &> /dev/null; then
    qpdf "$@"
    exit $?
fi

# Si no está disponible, intentar descargar una versión estática
QPDF_URL="https://github.com/qpdf/qpdf/releases/download/v11.6.3/qpdf-11.6.3.tar.gz"
TEMP_DIR="/tmp/qpdf-$$"

# Crear directorio temporal
mkdir -p $TEMP_DIR
cd $TEMP_DIR

# Descargar y compilar qpdf estáticamente
echo "Descargando qpdf..."
wget -q $QPDF_URL -O qpdf.tar.gz
tar -xzf qpdf.tar.gz
cd qpdf-*

# Compilar con enlaces estáticos
./configure --disable-shared --disable-doc
make -j2

# Usar el binario compilado
./qpdf "$@"
RESULT=$?

# Limpiar
cd /
rm -rf $TEMP_DIR

exit $RESULT
EOF

chmod +x $LAYER_DIR/opt/bin/qpdf-wrapper

# Crear script de instalación
cat > $LAYER_DIR/install-qpdf.sh << 'EOF'
#!/bin/bash
# Script para instalar qpdf en Lambda

echo "Instalando qpdf en Lambda..."

# Actualizar sistema
yum update -y

# Instalar dependencias
yum install -y wget tar gzip gcc gcc-c++ make cmake

# Descargar y compilar qpdf
cd /tmp
wget https://github.com/qpdf/qpdf/releases/download/v11.6.3/qpdf-11.6.3.tar.gz
tar -xzf qpdf-11.6.3.tar.gz
cd qpdf-11.6.3

# Configurar y compilar
./configure --disable-shared --prefix=/opt
make -j2
make install

echo "qpdf instalado en /opt/bin/qpdf"
EOF

chmod +x $LAYER_DIR/install-qpdf.sh

# Crear ZIP del layer
echo "📦 Creando ZIP del layer..."
cd $LAYER_DIR
zip -r ../qpdf-layer.zip .
cd ..

echo "✅ Layer creado: qpdf-layer.zip"
echo "📊 Tamaño: $(du -h qpdf-layer.zip | cut -f1)"

# Limpiar
rm -rf $LAYER_DIR

echo ""
echo "🎉 Layer con qpdf wrapper listo!"
echo ""
echo "📋 Para usar:"
echo "1. aws lambda publish-layer-version --layer-name qpdf --zip-file fileb://qpdf-layer.zip --compatible-runtimes nodejs22.x"
echo "2. Agregar layer al worker Lambda"
echo "3. Usar /opt/bin/qpdf-wrapper en el código"
