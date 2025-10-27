#!/bin/bash

echo "🔧 Descargando binario real de qpdf para Amazon Linux 2"
echo "======================================================="

LAYER_DIR="qpdf-layer"
BIN_DIR="$LAYER_DIR/bin"

# Limpiar directorio anterior
rm -rf $LAYER_DIR
mkdir -p $BIN_DIR

echo "📁 Creando estructura del layer..."

# Descargar binario pre-compilado de qpdf para Amazon Linux 2
# Usar una versión que sabemos que funciona
QPDF_VERSION="11.1.0"
QPDF_URL="https://github.com/qpdf/qpdf/releases/download/qpdf-${QPDF_VERSION}/qpdf-${QPDF_VERSION}-bin-linux-64.tar.gz"

echo "⬇️ Descargando qpdf desde $QPDF_URL..."

# Descargar y extraer
curl -L "$QPDF_URL" | tar -xz -C "$BIN_DIR" --strip-components=2 "qpdf-${QPDF_VERSION}/bin"

# Verificar que el binario existe y es ejecutable
if [ -f "$BIN_DIR/qpdf" ]; then
    chmod +x "$BIN_DIR/qpdf"
    echo "✅ Binario qpdf descargado exitosamente"
    echo "📊 Tamaño: $(du -sh $BIN_DIR/qpdf | awk '{print $1}')"
    echo "📊 Tipo: $(file $BIN_DIR/qpdf)"
else
    echo "❌ Error: No se pudo descargar el binario de qpdf"
    exit 1
fi

# Crear README
cat > "$LAYER_DIR/README.md" << EOF
# qpdf Lambda Layer

Este layer contiene qpdf versión ${QPDF_VERSION} para AWS Lambda.

## Uso

```javascript
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

// Usar qpdf
const { stdout } = await execAsync('/opt/bin/qpdf --version');
```

## Nota

Este layer contiene un binario real de qpdf compilado para Amazon Linux 2.
EOF

echo "✅ Layer creado: $LAYER_DIR"
echo "📊 Contenido:"
ls -la $LAYER_DIR/
echo ""
echo "📋 Para usar en CDK:"
echo "const qpdfLayer = new lambda.LayerVersion(this, 'QpdfLayer', {"
echo "  code: lambda.Code.fromAsset('lambda-layer/qpdf-layer'),"
echo "  compatibleRuntimes: [lambda.Runtime.NODEJS_22_X],"
echo "  description: 'Layer que contiene qpdf para AWS Lambda',"
echo "});"
