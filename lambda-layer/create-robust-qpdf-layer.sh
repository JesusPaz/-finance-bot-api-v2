#!/bin/bash

# Script para crear un layer robusto de qpdf
# Usa un enfoque más simple y confiable

set -e

echo "🔧 Creando Layer robusto de qpdf"
echo "================================="

LAYER_DIR="qpdf-robust-layer"
rm -rf $LAYER_DIR
mkdir -p $LAYER_DIR

echo "📁 Creando estructura del layer..."

# Crear directorios
mkdir -p $LAYER_DIR/opt/bin
mkdir -p $LAYER_DIR/opt/lib

# Crear script wrapper que descarga qpdf si no está disponible
cat > $LAYER_DIR/opt/bin/qpdf << 'EOF'
#!/bin/bash
# qpdf wrapper robusto para Lambda

QPDF_BINARY="/opt/bin/qpdf-binary"
QPDF_VERSION="12.2.0"

# Función para descargar qpdf si no existe
download_qpdf() {
    if [ ! -f "$QPDF_BINARY" ]; then
        echo "Descargando qpdf v$QPDF_VERSION..."
        
        # Crear directorio temporal
        TEMP_DIR="/tmp/qpdf-build-$$"
        mkdir -p $TEMP_DIR
        cd $TEMP_DIR
        
        # Descargar qpdf
        wget -q "https://github.com/qpdf/qpdf/releases/download/v$QPDF_VERSION/qpdf-$QPDF_VERSION.tar.gz" -O qpdf.tar.gz
        
        # Extraer
        tar -xzf qpdf.tar.gz
        cd qpdf-$QPDF_VERSION
        
        # Compilar con dependencias mínimas
        ./configure --disable-shared --disable-doc --prefix=/tmp/qpdf-install
        make -j2
        make install
        
        # Copiar binario
        cp /tmp/qpdf-install/bin/qpdf $QPDF_BINARY
        chmod +x $QPDF_BINARY
        
        # Limpiar
        cd /
        rm -rf $TEMP_DIR /tmp/qpdf-install
        
        echo "qpdf descargado y compilado"
    fi
}

# Verificar si qpdf está disponible
if ! command -v qpdf &> /dev/null; then
    download_qpdf
    QPDF_CMD="$QPDF_BINARY"
else
    QPDF_CMD="qpdf"
fi

# Ejecutar qpdf con los argumentos
exec $QPDF_CMD "$@"
EOF

chmod +x $LAYER_DIR/opt/bin/qpdf

# Crear script de prueba
cat > $LAYER_DIR/test-qpdf.sh << 'EOF'
#!/bin/bash
echo "🧪 Probando qpdf en el layer..."
/opt/bin/qpdf --version
echo "✅ Layer funcionando correctamente"
EOF

chmod +x $LAYER_DIR/test-qpdf.sh

# Crear README
cat > $LAYER_DIR/README.md << 'EOF'
# qpdf Lambda Layer

Este layer proporciona qpdf para AWS Lambda.

## Uso

```javascript
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

// Usar qpdf
const { stdout } = await execAsync('/opt/bin/qpdf --version');
```

## Comandos comunes

- `qpdf --version` - Ver versión
- `qpdf --password=PASS --decrypt input.pdf output.pdf` - Desbloquear PDF
- `qpdf --check input.pdf` - Verificar PDF
EOF

# Crear ZIP
echo "📦 Creando ZIP del layer..."
cd $LAYER_DIR
zip -r ../qpdf-robust-layer.zip .
cd ..

echo "✅ Layer creado: qpdf-robust-layer.zip"
echo "📊 Tamaño: $(du -h qpdf-robust-layer.zip | cut -f1)"

# Limpiar
rm -rf $LAYER_DIR

echo ""
echo "🎉 Layer robusto con qpdf listo!"
echo ""
echo "📋 Para publicar:"
echo "aws lambda publish-layer-version \\"
echo "  --layer-name qpdf-robust \\"
echo "  --zip-file fileb://qpdf-robust-layer.zip \\"
echo "  --compatible-runtimes nodejs22.x \\"
echo "  --description 'Robust qpdf for PDF processing'"
