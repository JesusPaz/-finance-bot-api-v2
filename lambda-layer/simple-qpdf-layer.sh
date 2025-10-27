#!/bin/bash

# Solución simplificada: Layer con script que descarga qpdf en runtime
# No requiere Docker, funciona en Lambda

set -e

echo "🔧 Creando Layer simple con qpdf"
echo "================================="

LAYER_DIR="qpdf-layer"
rm -rf $LAYER_DIR
mkdir -p $LAYER_DIR

echo "📁 Creando estructura del layer..."

# Crear directorios
mkdir -p $LAYER_DIR/opt/bin
mkdir -p $LAYER_DIR/opt/lib

# Crear script principal de qpdf
cat > $LAYER_DIR/opt/bin/qpdf << 'EOF'
#!/bin/bash
# qpdf wrapper para Lambda
# Descarga y usa qpdf en runtime si no está disponible

QPDF_BINARY="/tmp/qpdf"
QPDF_VERSION="11.6.3"

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
echo "🧪 Probando qpdf en Lambda Layer..."
/opt/bin/qpdf --version
echo "✅ qpdf funcionando"
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
zip -r ../qpdf-layer.zip .
cd ..

echo "✅ Layer creado: qpdf-layer.zip"
echo "📊 Tamaño: $(du -h qpdf-layer.zip | cut -f1)"

# Limpiar
rm -rf $LAYER_DIR

echo ""
echo "🎉 Layer con qpdf listo!"
echo ""
echo "📋 Para publicar:"
echo "aws lambda publish-layer-version \\"
echo "  --layer-name qpdf \\"
echo "  --zip-file fileb://qpdf-layer.zip \\"
echo "  --compatible-runtimes nodejs22.x \\"
echo "  --description 'qpdf for PDF processing'"
